// oxlint-disable no-console

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Resend } from "resend";
import { z } from "zod";

import { formatError } from "../src/utils/error.js";

export const SecurityScanResultSchema = z.object({
  vulnerabilities: z.array(
    z.object({
      severity: z.enum(["low", "medium", "high", "critical"]),
      reason: z.string(),
      filePath: z.string(),
      line: z.string(),
    }),
  ),
  summary: z.string(),
});

export type SecurityScanResult = z.infer<typeof SecurityScanResultSchema>;

// JSON Schema for OpenRouter API response format (mirrors SecurityScanResultSchema above)
export const SECURITY_SCAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    vulnerabilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
          },
          reason: { type: "string" },
          filePath: { type: "string" },
          line: { type: "string" },
        },
        required: ["severity", "reason", "filePath", "line"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["vulnerabilities", "summary"],
  additionalProperties: false,
} as const;

export type ValidatedEnv = {
  openrouterApiKey: string;
  model: string;
  securityScanPrompt: string;
  resendApiKey: string;
  resendFromEmail: string;
  securityScanRecipient: string;
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

export const validateEnv = (): ValidatedEnv => {
  return {
    openrouterApiKey: requireEnv("OPENROUTER_API_KEY"),
    model: requireEnv("SECURITY_SCAN_MODEL"),
    securityScanPrompt: requireEnv("SECURITY_SCAN_PROMPT"),
    resendApiKey: requireEnv("RESEND_API_KEY"),
    resendFromEmail: requireEnv("RESEND_FROM_EMAIL"),
    securityScanRecipient: requireEnv("SECURITY_SCAN_RECIPIENT"),
  };
};

export const getXmlFiles = ({ dir }: { dir: string }): string[] => {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".xml"))
    .map((file) => join(dir, file));
};

// oxlint-disable-next-line no-explicit-any -- duck-type to decouple from private SDK internals
export type OpenRouterClient = { chat: { send: (...args: any[]) => Promise<any> } };

// Bound each request so a stalled OpenRouter response cannot hang the whole scan
// (a single request previously hung for ~18 minutes before failing the job).
const REQUEST_TIMEOUT_MS = 180_000;
// Retry transient failures ourselves: OpenRouter occasionally returns an empty
// body (200 with no content), which makes the SDK throw
// `SyntaxError: Unexpected end of JSON input`. The SDK's built-in retry only
// covers HTTP status codes, so it does not cover that case.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

// Applied to every OpenRouter request: cap each attempt with a hard timeout and
// disable the SDK's own retry so our own loop is the single source of truth for
// retry/backoff behavior.
const CHAT_SEND_OPTIONS = {
  timeoutMs: REQUEST_TIMEOUT_MS,
  retries: { strategy: "none" },
} as const;

const sendChatOnce = async ({
  client,
  content: scanContent,
  model,
  prompt,
}: {
  client: OpenRouterClient;
  content: string;
  model: string;
  prompt: string;
}): Promise<SecurityScanResult> => {
  const response = await client.chat.send(
    {
      chatRequest: {
        model,
        messages: [{ role: "user", content: `${prompt}\n\n${scanContent}` }],
        reasoning: { effort: "high" },
        responseFormat: {
          type: "json_schema" as const,
          jsonSchema: {
            name: "security_scan",
            strict: true,
            schema: SECURITY_SCAN_JSON_SCHEMA,
          },
        },
        stream: false as const,
      },
      httpReferer: "https://github.com/dyoshikawa/rulesync",
      appTitle: "rulesync security-scan",
    },
    CHAT_SEND_OPTIONS,
  );

  const content = response.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("No content returned from OpenRouter");
  }

  return SecurityScanResultSchema.parse(JSON.parse(content));
};

export const runSecurityScan = async ({
  client,
  content: scanContent,
  model,
  prompt,
  maxAttempts = MAX_ATTEMPTS,
  retryDelayMs = RETRY_BASE_DELAY_MS,
}: {
  client: OpenRouterClient;
  content: string;
  model: string;
  prompt: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<SecurityScanResult> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendChatOnce({ client, content: scanContent, model, prompt });
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn(
          `  Attempt ${attempt}/${maxAttempts} failed: ${formatError(error)}. Retrying...`,
        );
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs * attempt);
        }
      }
    }
  }

  throw new Error(
    `OpenRouter request failed after ${maxAttempts} attempts: ${formatError(lastError)}`,
  );
};

const OVERALL_SUMMARY_PROMPT = `\
You are a security analyst. Below are the complete results of an automated security scan across \
multiple files of a codebase. Write a concise executive summary in Japanese (3-5 sentences) that \
describes the overall security posture, highlights the most critical findings, and recommends \
priorities for remediation. Output only the summary text as plain prose, without any headings, \
bullet points, or markdown formatting.`;

export const buildSummaryInput = ({
  results,
}: {
  results: Map<string, SecurityScanResult>;
}): string => {
  const sections: string[] = [];

  for (const [filename, result] of results.entries()) {
    const lines = [`File: ${filename}`, `Summary: ${result.summary}`];

    if (result.vulnerabilities.length === 0) {
      lines.push("- No vulnerabilities found");
    } else {
      for (const vuln of result.vulnerabilities) {
        lines.push(`- [${vuln.severity}] ${vuln.filePath} ${vuln.line}: ${vuln.reason}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
};

export const generateOverallSummary = async ({
  client,
  model,
  results,
}: {
  client: OpenRouterClient;
  model: string;
  results: Map<string, SecurityScanResult>;
}): Promise<string> => {
  const input = buildSummaryInput({ results });

  const response = await client.chat.send(
    {
      chatRequest: {
        model,
        messages: [{ role: "user", content: `${OVERALL_SUMMARY_PROMPT}\n\n${input}` }],
        reasoning: { effort: "high" },
        stream: false as const,
      },
      httpReferer: "https://github.com/dyoshikawa/rulesync",
      appTitle: "rulesync security-scan",
    },
    CHAT_SEND_OPTIONS,
  );

  const content = response.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("No content returned from OpenRouter");
  }

  return content.trim();
};

const HIGH_SEVERITIES = new Set(["high", "critical"]);

export const formatEmailBody = ({
  results,
  overallSummary,
}: {
  results: Map<string, SecurityScanResult>;
  overallSummary?: string;
}): string => {
  let body = "# Security Scan Report\n\n";

  if (overallSummary && overallSummary.trim().length > 0) {
    body += `## AI Summary\n\n${overallSummary.trim()}\n\n---\n\n`;
  }

  for (const [filename, result] of results.entries()) {
    const filtered = result.vulnerabilities.filter((v) => HIGH_SEVERITIES.has(v.severity));

    if (filtered.length === 0) {
      continue;
    }

    body += `## ${filename}\n\n`;
    body += `${result.summary}\n`;
    const count = filtered.length;
    const label = count === 1 ? "vulnerability" : "vulnerabilities";
    body += `### Found ${count} ${label} (high+)\n\n`;

    for (const vuln of filtered) {
      body += `**[${vuln.severity}] ${vuln.filePath} ${vuln.line}**\n`;
      body += `- Reason: ${vuln.reason}\n`;
      body += "\n";
    }

    body += "---\n\n";
  }

  return body;
};

export const countHighSeverityVulnerabilities = ({
  results,
}: {
  results: Map<string, SecurityScanResult>;
}): number => {
  return [...results.values()].reduce(
    (sum, r) => sum + r.vulnerabilities.filter((v) => HIGH_SEVERITIES.has(v.severity)).length,
    0,
  );
};

export const sendEmail = async ({
  apiKey,
  from,
  to,
  subject,
  body,
}: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> => {
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    text: body,
  });
  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
};
