// oxlint-disable no-console

import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod/mini";
import type { ZodMiniType } from "zod/mini";

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
  schema: ZodMiniType<T>;
}): Promise<T> => {
  const raw = await sendPrompt({ client, sessionId, text });
  const jsonMatches = [...raw.matchAll(/```json\s*([\s\S]*?)```/g)];
  const lastMatch = jsonMatches.at(-1);
  if (!lastMatch?.[1]) {
    throw new Error(`Expected JSON code block in response. Raw output:\n${raw.slice(0, 500)}`);
  }
  const jsonStr = lastMatch[1].trim();
  try {
    return schema.parse(JSON.parse(jsonStr));
  } catch (cause) {
    throw new Error(`Failed to parse JSON response. Raw output:\n${raw.slice(0, 500)}`, {
      cause,
    });
  }
};

const ReviewResultSchema = z.looseObject({
  findings: z.array(
    z.looseObject({
      number: z.number(),
      severity: z.enum(["low", "mid", "high", "critical"]),
      description: z.string(),
      file: z.optional(z.string()),
      line: z.optional(z.number()),
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

const MAX_REVIEW_FIX_RETRIES = 3;

const stepReviewPr = async ({
  client,
  sessionId,
  prIdentifier,
}: SessionContext & { prIdentifier?: string }): Promise<ReviewResult> => {
  console.log("\n=== Step: Review PR ===");
  const target = prIdentifier
    ? `on the following PR: ${prIdentifier}`
    : "on the current branch's PR";
  return sendPromptWithJsonParse({
    client,
    sessionId,
    schema: ReviewResultSchema,
    text: `Execute the /review-pr command ${target}
Review the code changes for both code quality and security issues.

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

const stepCheckMergeBlockers = async ({
  client,
  sessionId,
  reviewResult,
}: SessionContext & { reviewResult: ReviewResult }): Promise<MergeBlockerCheckResult> => {
  console.log("\n=== Step: Check Merge Blockers ===");
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

const stepFixAndCommitPush = async ({
  client,
  sessionId,
  mergeBlockers,
}: SessionContext & { mergeBlockers: string[] }): Promise<string> => {
  console.log("\n=== Step: Fix Merge Blockers and Commit-Push ===");
  return sendPrompt({
    client,
    sessionId,
    text: `The following merge blockers were identified in the review. Fix them all:

${mergeBlockers.map((b, i) => `${i + 1}. ${b}`).join("\n")}

After fixing, execute the /commit-push-pr command to commit and push the changes.
Report back when done.`,
  });
};

const stepCreateScrapIssue = async ({
  client,
  sessionId,
  nonBlockingFindings,
}: SessionContext & { nonBlockingFindings: string[] }): Promise<string> => {
  console.log("\n=== Step: Create Scrap Issue for Non-blocking Findings ===");
  return sendPrompt({
    client,
    sessionId,
    text: `Execute the /create-scrap-issue skill to create a GitHub issue for the following non-blocking review findings that should be addressed later:

${nonBlockingFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Create a single issue consolidating all these findings.`,
  });
};

const PR_IDENTIFIER_PATTERN = /^(\d+|https:\/\/github\.com\/.+\/pull\/\d+)$/;

const main = async () => {
  const prIdentifier = process.argv.slice(2).join(" ");
  if (!prIdentifier) {
    console.error("Usage: tsx scripts/review-loop.ts <pr-url-or-number>");
    console.error("  Example: tsx scripts/review-loop.ts https://github.com/owner/repo/pull/123");
    console.error("  Example: tsx scripts/review-loop.ts 123");
    process.exit(1);
  }

  if (!PR_IDENTIFIER_PATTERN.test(prIdentifier)) {
    console.error(
      `Invalid PR identifier: ${prIdentifier}\nExpected a PR number (e.g. 123) or GitHub PR URL.`,
    );
    process.exit(1);
  }

  console.log("Starting review-fix loop...");
  console.log(`PR: ${prIdentifier}`);

  const { client, server } = await createOpencode();

  try {
    const session = await client.session.create();
    if (!session.data) {
      throw new Error("Failed to create session");
    }
    const sessionId = session.data.id;
    console.log(`Session created: ${sessionId}`);

    // Step 1: Review PR
    const reviewResult = await stepReviewPr({ client, sessionId, prIdentifier });
    console.log(`Review summary: ${reviewResult.overallSummary}`);
    console.log(`Findings: ${reviewResult.findings.length}`);

    // Step 2: Check merge blockers
    let mergeBlockerCheck = await stepCheckMergeBlockers({
      client,
      sessionId,
      reviewResult,
    });

    // Step 3: Fix-review loop
    let reviewFixRetries = 0;
    while (mergeBlockerCheck.hasMergeBlockers && reviewFixRetries < MAX_REVIEW_FIX_RETRIES) {
      reviewFixRetries++;
      console.log(
        `Merge blockers found (${mergeBlockerCheck.mergeBlockers.length}), fixing (${reviewFixRetries}/${MAX_REVIEW_FIX_RETRIES})...`,
      );

      // Fix merge blockers and commit-push
      await stepFixAndCommitPush({
        client,
        sessionId,
        mergeBlockers: mergeBlockerCheck.mergeBlockers,
      });

      // Re-review after fixes
      const reReviewResult = await stepReviewPr({ client, sessionId, prIdentifier });
      console.log(`Re-review summary: ${reReviewResult.overallSummary}`);
      console.log(`Findings: ${reReviewResult.findings.length}`);

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

    // Step 4: Create scrap issue for non-blocking findings
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
    console.log(`Review: ${reviewResult.overallSummary}`);
    console.log(`Merge blockers resolved: ${reviewFixRetries} fix rounds`);
    console.log(
      `Non-blocking findings: ${mergeBlockerCheck.nonBlockingFindings.length} (${mergeBlockerCheck.nonBlockingFindings.length > 0 ? "tracked in scrap issue" : "none"})`,
    );
  } finally {
    server?.close();
  }
};

main().catch((error: unknown) => {
  console.error(`Fatal error: ${formatError(error)}`);
  process.exit(1);
});
