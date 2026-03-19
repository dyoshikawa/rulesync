// oxlint-disable no-console

import { createOpencode } from "@opencode-ai/sdk";
import { z } from "zod/mini";

import { formatError } from "../src/utils/error.js";
import {
  MAX_REVIEW_FIX_RETRIES,
  parseJsonResponse,
  sendPrompt,
  sendPromptWithJsonParse,
  stepCheckMergeBlockers,
  stepCreateScrapIssue,
  stepFixAndCommitPush,
  stepReviewPr,
} from "./opencode-helpers.js";
import type { SessionContext } from "./opencode-helpers.js";

const InvestigationResultSchema = z.looseObject({
  plan: z.string(),
  filesInvolved: z.array(z.string()),
  summary: z.string(),
});
type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

const ImplementationResultSchema = z.looseObject({
  completed: z.boolean(),
  summary: z.string(),
  remainingWork: z.optional(z.string()),
});
type ImplementationResult = z.infer<typeof ImplementationResultSchema>;

type StepName = "investigate" | "implement" | "continue" | "commit" | "review" | "merge";

type ImplementationProgress = {
  sessionId: string;
  instruction: string;
  startedAt: string;
  updatedAt: string;
  stage: StepName;
  investigation?: InvestigationResult;
  implementation?: ImplementationResult;
  retries: number;
};

const PROGRESS_LOG_PREFIX = "[implement-loop]";

const step1Investigate = async ({
  client,
  sessionId,
  instruction,
}: SessionContext & { instruction: string }): Promise<InvestigationResult> => {
  console.log("\n=== Step 1: Investigation and Planning ===");
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: InvestigationResultSchema,
    text: `You are given the following task/issue to work on:

<user-task>
${instruction}
</user-task>

Investigate the codebase to understand the relevant code, dependencies, and context needed to complete this task.
Then create an implementation plan.

Respond ONLY with a JSON block in the following format:
\`\`\`json
{
  "plan": "detailed step-by-step implementation plan",
  "filesInvolved": ["list", "of", "relevant", "file", "paths"],
  "summary": "brief summary of the investigation findings"
}
\`\`\``,
  });
};

const step2Implement = async ({
  client,
  sessionId,
  instruction,
  investigation,
}: SessionContext & {
  instruction: string;
  investigation: InvestigationResult;
}): Promise<ImplementationResult> => {
  console.log("\n=== Step 2: Implementation ===");
  const raw = await sendPrompt({
    client,
    sessionId,
    text: `Based on the following task and investigation plan, implement the changes.

## Task
<user-task>
${instruction}
</user-task>

## Investigation Summary
${investigation.summary}

## Plan
${investigation.plan}

## Files Involved
${investigation.filesInvolved.join("\n")}

Implement the changes now. After implementation, respond ONLY with a JSON block:
\`\`\`json
{
  "completed": true or false,
  "summary": "what was implemented",
  "remainingWork": "description of remaining work if not completed, omit if completed"
}
\`\`\``,
  });
  return parseJsonResponse({ raw, schema: ImplementationResultSchema, label: "implementation" });
};

const step3ContinueImplementation = async ({
  client,
  sessionId,
  previousResult,
}: SessionContext & { previousResult: ImplementationResult }): Promise<ImplementationResult> => {
  console.log("\n=== Step 3: Continue Implementation ===");
  const raw = await sendPrompt({
    client,
    sessionId,
    text: `The previous implementation was not completed.

## Previous Summary
${previousResult.summary}

## Remaining Work
${previousResult.remainingWork ?? "Unknown - please review and complete the implementation."}

Continue and complete the implementation. Respond ONLY with a JSON block:
\`\`\`json
{
  "completed": true or false,
  "summary": "what was implemented in this round",
  "remainingWork": "description of remaining work if not completed, omit if completed"
}
\`\`\``,
  });
  return parseJsonResponse({
    raw,
    schema: ImplementationResultSchema,
    label: "continue implementation",
  });
};

const step4CommitPushPr = async ({ client, sessionId }: SessionContext): Promise<string> => {
  console.log("\n=== Step 4: Commit, Push, and Create PR ===");
  return sendPrompt({
    client,
    sessionId,
    text: `Execute the /commit-push-pr skill now. Commit all current changes, push to remote, and create a pull request. Report back the PR URL when done.`,
  });
};

const MAX_IMPLEMENTATION_RETRIES = 3;

const progressStore = new Map<string, ImplementationProgress>();

const createProgress = (instruction: string, sessionId: string): ImplementationProgress => {
  const timestamp = new Date().toISOString();
  return {
    sessionId,
    instruction,
    startedAt: timestamp,
    updatedAt: timestamp,
    stage: "investigate",
    retries: 0,
  };
};

const updateProgress = (
  progress: ImplementationProgress,
  patch: Partial<ImplementationProgress>,
): ImplementationProgress => {
  const updated: ImplementationProgress = {
    ...progress,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  Object.assign(progress, updated);
  progressStore.set(progress.sessionId, progress);
  const message = {
    stage: progress.stage,
    retries: progress.retries,
    updatedAt: progress.updatedAt,
  };
  console.log(`${PROGRESS_LOG_PREFIX} progress ${JSON.stringify(message)}`);
  return progress;
};

const logStageError = (stage: StepName, error: unknown): void => {
  console.error(`${PROGRESS_LOG_PREFIX} ${stage} failed: ${formatError(error)}`);
};

const logProgressSnapshot = (progress: ImplementationProgress): void => {
  const snapshot = {
    sessionId: progress.sessionId,
    stage: progress.stage,
    retries: progress.retries,
    updatedAt: progress.updatedAt,
    investigation: progress.investigation
      ? {
          summary: progress.investigation.summary,
          plan: progress.investigation.plan,
          filesInvolved: progress.investigation.filesInvolved,
        }
      : undefined,
    implementation: progress.implementation
      ? {
          completed: progress.implementation.completed,
          summary: progress.implementation.summary,
          remainingWork: progress.implementation.remainingWork,
        }
      : undefined,
  };
  console.error(`${PROGRESS_LOG_PREFIX} last progress ${JSON.stringify(snapshot, null, 2)}`);
};

const main = async () => {
  const instruction = process.argv.slice(2).join(" ");
  if (!instruction) {
    console.error("Usage: tsx scripts/implement-loop.ts <issue-or-instruction>");
    console.error("  Example: tsx scripts/implement-loop.ts Fix the login bug described in #123");
    process.exit(1);
  }

  console.log("Starting implement-review loop...");
  console.log(`Instruction: ${instruction}`);

  const { client, server } = await createOpencode();

  let sessionId: string | undefined;
  try {
    const session = await client.session.create();
    if (!session.data) {
      throw new Error("Failed to create session");
    }
    sessionId = session.data.id;
    console.log(`Session created: ${sessionId}`);

    const progress = createProgress(instruction, sessionId);
    progressStore.set(sessionId, progress);

    // Step 1: Investigate
    let investigation: InvestigationResult;
    try {
      investigation = await step1Investigate({ client, sessionId, instruction });
      updateProgress(progress, { stage: "investigate", investigation });
    } catch (error) {
      logStageError("investigate", error);
      throw error;
    }
    console.log(`Investigation summary: ${investigation.summary}`);
    console.log(`Plan: ${investigation.plan}`);

    // Step 2: Implement
    let implementationResult: ImplementationResult;
    try {
      updateProgress(progress, { stage: "implement" });
      implementationResult = await step2Implement({
        client,
        sessionId,
        instruction,
        investigation,
      });
      updateProgress(progress, { stage: "implement", implementation: implementationResult });
      console.log(`Implementation completed: ${implementationResult.completed}`);
    } catch (error) {
      logStageError("implement", error);
      throw error;
    }

    // Step 3: Retry implementation if not completed
    let retries = 0;
    updateProgress(progress, { retries });
    while (!implementationResult.completed && retries < MAX_IMPLEMENTATION_RETRIES) {
      retries++;
      console.log(
        `Implementation not completed, retrying (${retries}/${MAX_IMPLEMENTATION_RETRIES})...`,
      );
      updateProgress(progress, { stage: "continue", retries });
      try {
        implementationResult = await step3ContinueImplementation({
          client,
          sessionId,
          previousResult: implementationResult,
        });
        updateProgress(progress, {
          stage: "continue",
          retries,
          implementation: implementationResult,
        });
        console.log(`Implementation completed: ${implementationResult.completed}`);
      } catch (error) {
        logStageError("continue", error);
        throw error;
      }
    }

    if (!implementationResult.completed) {
      updateProgress(progress, { stage: "continue", implementation: implementationResult });
      const remainingWork = implementationResult.remainingWork ?? "Unknown remaining work";
      throw new Error(
        `Implementation did not complete after max retries. Remaining work: ${remainingWork}`,
      );
    }

    // Step 4: Commit, push, and create PR
    let prResult: string;
    try {
      updateProgress(progress, { stage: "commit" });
      prResult = await step4CommitPushPr({ client, sessionId });
      console.log(`PR result: ${prResult}`);
    } catch (error) {
      logStageError("commit", error);
      throw error;
    }

    // Step 5: Review PR
    let reviewResult;
    try {
      updateProgress(progress, { stage: "review" });
      reviewResult = await stepReviewPr({ client, sessionId });
      console.log(`Review summary: ${reviewResult.overallSummary}`);
      console.log(`Findings: ${reviewResult.findings.length}`);
    } catch (error) {
      logStageError("review", error);
      throw error;
    }

    // Step 6: Check merge blockers and fix if needed
    let mergeBlockerCheck;
    try {
      updateProgress(progress, { stage: "merge" });
      mergeBlockerCheck = await stepCheckMergeBlockers({
        client,
        sessionId,
        reviewResult,
      });
    } catch (error) {
      logStageError("merge", error);
      throw error;
    }

    let reviewFixRetries = 0;
    while (mergeBlockerCheck.hasMergeBlockers && reviewFixRetries < MAX_REVIEW_FIX_RETRIES) {
      reviewFixRetries++;
      console.log(
        `Merge blockers found (${mergeBlockerCheck.mergeBlockers.length}), fixing (${reviewFixRetries}/${MAX_REVIEW_FIX_RETRIES})...`,
      );

      // Step 7: Fix merge blockers and push
      await stepFixAndCommitPush({
        client,
        sessionId,
        mergeBlockers: mergeBlockerCheck.mergeBlockers,
      });

      // Re-review after fixes
      const reReviewResult = await stepReviewPr({ client, sessionId });
      mergeBlockerCheck = await stepCheckMergeBlockers({
        client,
        sessionId,
        reviewResult: reReviewResult,
      });
    }

    if (mergeBlockerCheck.hasMergeBlockers) {
      const blockerList = mergeBlockerCheck.mergeBlockers.map((b) => `  - ${b}`).join("\n");
      throw new Error(`Merge blockers remain after max fix retries:\n${blockerList}`);
    }

    // Step 8: Create scrap issue for non-blocking findings
    if (mergeBlockerCheck.nonBlockingFindings.length > 0) {
      console.log(
        `Creating scrap issue for ${mergeBlockerCheck.nonBlockingFindings.length} non-blocking findings...`,
      );
      const issueResult = await stepCreateScrapIssue({
        client,
        sessionId,
        nonBlockingFindings: mergeBlockerCheck.nonBlockingFindings,
      });
      console.log(`Scrap issue result: ${issueResult}`);
    } else {
      console.log("No non-blocking findings to track.");
    }

    // Done
    console.log("\n=== Complete ===");
    console.log(`Implementation: ${implementationResult.summary}`);
    console.log(`Review: ${reviewResult.overallSummary}`);
    console.log(`Merge blockers resolved: ${reviewFixRetries} fix rounds`);
    console.log(
      `Non-blocking findings: ${mergeBlockerCheck.nonBlockingFindings.length} (${mergeBlockerCheck.nonBlockingFindings.length > 0 ? "tracked in scrap issue" : "none"})`,
    );
  } catch (error) {
    console.error(`Fatal error: ${formatError(error)}`);
    const lastProgress = sessionId ? progressStore.get(sessionId) : undefined;
    if (lastProgress) {
      logProgressSnapshot(lastProgress);
    }
    throw error;
  } finally {
    server?.close();
  }
};

main().catch((error: unknown) => {
  console.error(`Implement loop failed: ${formatError(error)}`);
  process.exit(1);
});
