// oxlint-disable no-console

import { createOpencode } from "@opencode-ai/sdk";

import { formatError } from "../src/utils/error.js";
import {
  MAX_REVIEW_FIX_RETRIES,
  stepCheckMergeBlockers,
  stepCreateScrapIssue,
  stepFixAndCommitPush,
  stepReviewPr,
} from "./opencode-helpers.js";

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
