// oxlint-disable no-console

import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod";

import { formatError } from "../src/utils/error.js";

type SessionContext = {
  client: OpencodeClient;
  sessionId: string;
};

const sendPrompt = async ({
  client,
  sessionId,
  text,
}: SessionContext & { text: string }): Promise<string> => {
  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text }],
    },
  });
  if (!result.data) {
    throw new Error(`Prompt failed: ${JSON.stringify(result.error)}`);
  }
  const textParts = result.data.parts.filter((p) => p.type === "text");
  return textParts.map((p) => ("text" in p ? p.text : "")).join("\n");
};

const sendPromptWithJsonParse = async <T>({
  client,
  sessionId,
  text,
  schema,
}: SessionContext & {
  text: string;
  schema: z.ZodType<T>;
}): Promise<T> => {
  const raw = await sendPrompt({ client, sessionId, text });
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch?.[1]) {
    throw new Error(`Expected JSON code block in response. Raw output:\n${raw.slice(0, 500)}`);
  }
  const jsonStr = jsonMatch[1].trim();
  try {
    return schema.parse(JSON.parse(jsonStr));
  } catch (cause) {
    throw new Error(`Failed to parse JSON response. Raw output:\n${raw.slice(0, 500)}`, { cause });
  }
};

const InvestigationResultSchema = z.looseObject({
  plan: z.string(),
  filesInvolved: z.array(z.string()),
  summary: z.string(),
});
type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

const ImplementationResultSchema = z.looseObject({
  completed: z.boolean(),
  summary: z.string(),
  remainingWork: z.string().optional(),
});
type ImplementationResult = z.infer<typeof ImplementationResultSchema>;

const ReviewResultSchema = z.looseObject({
  findings: z.array(
    z.looseObject({
      number: z.number(),
      severity: z.enum(["low", "mid", "high", "critical"]),
      description: z.string(),
      file: z.string().optional(),
      line: z.number().optional(),
    }),
  ),
  overallSummary: z.string(),
});
type ReviewResult = z.infer<typeof ReviewResultSchema>;

const MergeBlockerCheckResultSchema = z.looseObject({
  hasMergeBlockers: z.boolean(),
  mergeBlockers: z.array(z.string()),
  nonBlockingFindings: z.array(z.string()),
});
type MergeBlockerCheckResult = z.infer<typeof MergeBlockerCheckResultSchema>;

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
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: ImplementationResultSchema,
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
};

const step3ContinueImplementation = async ({
  client,
  sessionId,
  previousResult,
}: SessionContext & { previousResult: ImplementationResult }): Promise<ImplementationResult> => {
  console.log("\n=== Step 3: Continue Implementation ===");
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: ImplementationResultSchema,
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
};

const step4CommitPushPr = async ({ client, sessionId }: SessionContext): Promise<string> => {
  console.log("\n=== Step 4: Commit, Push, and Create PR ===");
  return sendPrompt({
    client,
    sessionId,
    text: `Execute the /commit-push-pr skill now. Commit all current changes, push to remote, and create a pull request. Report back the PR URL when done.`,
  });
};

const step5ReviewPr = async ({ client, sessionId }: SessionContext): Promise<ReviewResult> => {
  console.log("\n=== Step 5: Review PR ===");
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: ReviewResultSchema,
    text: `Execute the /review-pr skill on the current branch's PR. Review the code changes for both code quality and security issues.

After the review, respond ONLY with a JSON block:
\`\`\`json
{
  "findings": [
    {
      "number": 1,
      "severity": "low|mid|high|critical",
      "description": "description of the finding",
      "file": "optional file path",
      "line": 0
    }
  ],
  "overallSummary": "overall review summary"
}
\`\`\``,
  });
};

const step6CheckMergeBlockers = async ({
  client,
  sessionId,
  reviewResult,
}: SessionContext & { reviewResult: ReviewResult }): Promise<MergeBlockerCheckResult> => {
  console.log("\n=== Step 6: Check Merge Blockers ===");
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: MergeBlockerCheckResultSchema,
    text: `Analyze the following review findings and determine which are merge blockers.

Merge blockers are findings with severity "high" or "critical" that indicate:
- Security vulnerabilities
- Data loss risks
- Breaking changes without migration
- Critical bugs

## Review Findings
${JSON.stringify(reviewResult.findings, null, 2)}

Respond ONLY with a JSON block:
\`\`\`json
{
  "hasMergeBlockers": true or false,
  "mergeBlockers": ["list of merge blocker descriptions"],
  "nonBlockingFindings": ["list of non-blocking finding descriptions"]
}
\`\`\``,
  });
};

const step7FixAndPush = async ({
  client,
  sessionId,
  mergeBlockers,
}: SessionContext & { mergeBlockers: string[] }): Promise<string> => {
  console.log("\n=== Step 7: Fix Merge Blockers and Push ===");
  return sendPrompt({
    client,
    sessionId,
    text: `The following merge blockers were identified in the review. Fix them all:

${mergeBlockers.map((b, i) => `${i + 1}. ${b}`).join("\n")}

After fixing, execute the /commit-push-pr skill to commit and push the changes.
Report back when done.`,
  });
};

const step8CreateScrapIssue = async ({
  client,
  sessionId,
  nonBlockingFindings,
}: SessionContext & { nonBlockingFindings: string[] }): Promise<string> => {
  console.log("\n=== Step 8: Create Scrap Issue for Non-blocking Findings ===");
  return sendPrompt({
    client,
    sessionId,
    text: `Execute the /create-scrap-issue skill to create a GitHub issue for the following non-blocking review findings that should be addressed later:

${nonBlockingFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Create a single issue consolidating all these findings.`,
  });
};

const MAX_IMPLEMENTATION_RETRIES = 3;
const MAX_REVIEW_FIX_RETRIES = 3;

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

  try {
    const session = await client.session.create();
    if (!session.data) {
      throw new Error("Failed to create session");
    }
    const sessionId = session.data.id;
    console.log(`Session created: ${sessionId}`);

    // Step 1: Investigate
    const investigation = await step1Investigate({ client, sessionId, instruction });
    console.log(`Investigation summary: ${investigation.summary}`);
    console.log(`Plan: ${investigation.plan}`);

    // Step 2: Implement
    let implementationResult = await step2Implement({
      client,
      sessionId,
      instruction,
      investigation,
    });
    console.log(`Implementation completed: ${implementationResult.completed}`);

    // Step 3: Retry implementation if not completed
    let retries = 0;
    while (!implementationResult.completed && retries < MAX_IMPLEMENTATION_RETRIES) {
      retries++;
      console.log(
        `Implementation not completed, retrying (${retries}/${MAX_IMPLEMENTATION_RETRIES})...`,
      );
      implementationResult = await step3ContinueImplementation({
        client,
        sessionId,
        previousResult: implementationResult,
      });
      console.log(`Implementation completed: ${implementationResult.completed}`);
    }

    if (!implementationResult.completed) {
      throw new Error("Implementation did not complete after max retries. Aborting.");
    }

    // Step 4: Commit, push, and create PR
    const prResult = await step4CommitPushPr({ client, sessionId });
    console.log(`PR result: ${prResult}`);

    // Step 5: Review PR
    const reviewResult = await step5ReviewPr({ client, sessionId });
    console.log(`Review summary: ${reviewResult.overallSummary}`);
    console.log(`Findings: ${reviewResult.findings.length}`);

    // Step 6: Check merge blockers and fix if needed
    let mergeBlockerCheck = await step6CheckMergeBlockers({
      client,
      sessionId,
      reviewResult,
    });

    let reviewFixRetries = 0;
    while (mergeBlockerCheck.hasMergeBlockers && reviewFixRetries < MAX_REVIEW_FIX_RETRIES) {
      reviewFixRetries++;
      console.log(
        `Merge blockers found (${mergeBlockerCheck.mergeBlockers.length}), fixing (${reviewFixRetries}/${MAX_REVIEW_FIX_RETRIES})...`,
      );

      // Step 7: Fix merge blockers and push
      await step7FixAndPush({
        client,
        sessionId,
        mergeBlockers: mergeBlockerCheck.mergeBlockers,
      });

      // Re-review after fixes
      const reReviewResult = await step5ReviewPr({ client, sessionId });
      mergeBlockerCheck = await step6CheckMergeBlockers({
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
      const issueResult = await step8CreateScrapIssue({
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
  } finally {
    server.close();
  }
};

main().catch((error: unknown) => {
  console.error(`Fatal error: ${formatError(error)}`);
  process.exit(1);
});
