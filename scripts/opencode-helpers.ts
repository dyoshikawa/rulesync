// oxlint-disable no-console

import type { OpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod/mini";
import type { ZodMiniType } from "zod/mini";

export type SessionContext = {
  client: OpencodeClient;
  sessionId: string;
};

export const sendPrompt = async ({
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

export const sendPromptWithJsonParse = async <T>({
  client,
  sessionId,
  text,
  schema,
}: SessionContext & {
  text: string;
  schema: ZodMiniType<T>;
}): Promise<T> => {
  const raw = await sendPrompt({ client, sessionId, text });
  return parseJsonResponse({ raw, schema });
};

const uniqueCandidates = (candidates: string[]): string[] => {
  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .filter((candidate) => {
      if (seen.has(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    });
};

const findJsonCandidates = (raw: string): string[] => {
  const candidates: string[] = [];
  const jsonMatches = [...raw.matchAll(/```json\s*([\s\S]*?)```/gi)];
  candidates.push(...jsonMatches.map((match) => match[1] ?? ""));

  const anyFenceMatches = [...raw.matchAll(/```\s*([\s\S]*?)```/g)];
  candidates.push(...anyFenceMatches.map((match) => match[1] ?? ""));

  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }

  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch?.[0]) {
    candidates.push(braceMatch[0]);
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    candidates.push(arrayMatch[0]);
  }

  return uniqueCandidates(candidates);
};

export const parseJsonResponse = <T>({
  raw,
  schema,
  label,
}: {
  raw: string;
  schema: ZodMiniType<T>;
  label?: string;
}): T => {
  const candidates = findJsonCandidates(raw);
  if (candidates.length === 0) {
    const labelSuffix = label ? ` for ${label}` : "";
    throw new Error(`Expected JSON response${labelSuffix}. Raw output:\n${raw.slice(0, 500)}`);
  }

  const errors: Error[] = [];
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch (cause) {
      errors.push(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  const labelSuffix = label ? ` for ${label}` : "";
  throw new Error(
    `Failed to parse JSON response${labelSuffix} after ${candidates.length} attempt(s). Raw output:\n${raw.slice(0, 500)}`,
    { cause: errors.at(-1) },
  );
};

export const ReviewResultSchema = z.looseObject({
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
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const MergeBlockerCheckResultSchema = z.looseObject({
  hasMergeBlockers: z.boolean(),
  mergeBlockers: z.array(z.string()),
  nonBlockingFindings: z.array(z.string()),
});
export type MergeBlockerCheckResult = z.infer<typeof MergeBlockerCheckResultSchema>;

export const MAX_REVIEW_FIX_RETRIES = 3;

export const stepReviewPr = async ({
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
    text: `Execute the /review-pr skill ${target}
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

export const stepCheckMergeBlockers = async ({
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

export const stepFixAndCommitPush = async ({
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

After fixing, execute the /commit-push-pr skill to commit and push the changes.
Report back when done.`,
  });
};

export const stepCreateScrapIssue = async ({
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
