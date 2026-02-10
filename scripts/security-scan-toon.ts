// oxlint-disable no-console

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Resend } from "resend";
import { z } from "zod";

type Vulnerability = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  location?: string;
  recommendation?: string;
};

type SecurityScanResult = {
  vulnerabilities: Vulnerability[];
  summary: string;
};

const SecurityScanResultSchema = z.object({
  vulnerabilities: z.array(
    z.object({
      severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      title: z.string(),
      description: z.string(),
      location: z.string().optional(),
      recommendation: z.string().optional(),
    }),
  ),
  summary: z.string(),
});

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SECURITY_SCAN_MODEL = process.env.SECURITY_SCAN_MODEL;
const SECURITY_SCAN_PROMPT = process.env.SECURITY_SCAN_PROMPT;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const TO_RECEIVER = "dyoshikawa1993@gmail.com";

const validateEnv = () => {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (!SECURITY_SCAN_MODEL) {
    throw new Error("SECURITY_SCAN_MODEL is not set");
  }
  if (!SECURITY_SCAN_PROMPT) {
    throw new Error("SECURITY_SCAN_PROMPT is not set");
  }
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }

  return {
    openrouterApiKey: OPENROUTER_API_KEY,
    model: SECURITY_SCAN_MODEL,
    prompt: SECURITY_SCAN_PROMPT,
    resendApiKey: RESEND_API_KEY,
  };
};

const getToonFiles = (dir: string): string[] => {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".toon"))
    .map((file) => join(dir, file));
};

const runSecurityScan =
  (apiKey: string) =>
  async (toonContent: string, model: string, prompt: string): Promise<SecurityScanResult> => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/dyoshikawa/rulesync",
        "X-Title": "rulesync security-scan",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: `${prompt}\n\n${toonContent}` }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "security_scan",
            strict: true,
            schema: {
              type: "object",
              properties: {
                vulnerabilities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      severity: {
                        type: "string",
                        enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
                      },
                      title: { type: "string" },
                      description: { type: "string" },
                      location: { type: "string" },
                      recommendation: { type: "string" },
                    },
                    required: ["severity", "title", "description"],
                  },
                },
                summary: { type: "string" },
              },
              required: ["vulnerabilities", "summary"],
              additionalProperties: false,
            },
          },
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${error}`);
    }

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const data = (await response.json()) as {
      choices?: [{ message?: { content?: string } }];
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content returned from OpenRouter");
    }

    const result = SecurityScanResultSchema.parse(JSON.parse(content));
    return result;
  };

const formatEmailBody = (results: Map<string, SecurityScanResult>): string => {
  let body = "# Security Scan Report\n\n";

  for (const [filename, result] of results.entries()) {
    body += `## ${filename}\n\n`;
    body += `${result.summary}\n`;
    body += `### Found ${result.vulnerabilities.length} vulnerabilities\n\n`;

    for (const vuln of result.vulnerabilities) {
      body += `**[${vuln.severity}] ${vuln.title}**\n`;
      if (vuln.location) {
        body += `- Location: ${vuln.location}\n`;
      }
      body += `- Description: ${vuln.description}\n`;
      if (vuln.recommendation) {
        body += `- Recommendation: ${vuln.recommendation}\n`;
      }
      body += "\n";
    }

    body += "---\n\n";
  }

  return body;
};

const sendEmail =
  (apiKey: string) =>
  async (body: string): Promise<void> => {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "Security Scan <security@rulesync.>",
      to: TO_RECEIVER,
      subject: "Security Scan Report",
      html: body,
    });
  };

const main = async (): Promise<void> => {
  const env = validateEnv();
  const { openrouterApiKey, model, prompt, resendApiKey } = env satisfies Record<
    "openrouterApiKey" | "model" | "prompt" | "resendApiKey",
    string
  >;

  const baseDir = process.cwd();
  const toonFiles = getToonFiles(baseDir);

  console.log(`Found ${toonFiles.length} toon files to scan`);

  const results = new Map<string, SecurityScanResult>();

  for (const toonPath of toonFiles) {
    const filename = toonPath.split("/").pop() ?? toonPath;
    console.log(`Scanning ${filename}...`);

    const toonContent = readFileSync(toonPath, "utf-8");
    const scan = runSecurityScan(openrouterApiKey);
    const scanResult = await scan(toonContent, model, prompt);

    results.set(filename, scanResult);
    console.log(`  Found ${scanResult.vulnerabilities.length} vulnerabilities`);
  }

  console.log("All scans completed");

  const emailBody = formatEmailBody(results);
  const send = sendEmail(resendApiKey);
  await send(emailBody);

  console.log("Email sent successfully");
};

main().catch((error: unknown) => {
  console.error("Error:", error);
  process.exit(1);
});
