import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Resend } from "resend";
import { z } from "zod";

export const SecurityScanResultSchema = z.object({
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

export type SecurityScanResult = z.infer<typeof SecurityScanResultSchema>;

export type ValidatedEnv = {
  openrouterApiKey: string;
  model: string;
  resendApiKey: string;
  resendFromEmail: string;
  securityScanRecipient: string;
};

export const validateEnv = (): ValidatedEnv => {
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  const model = process.env.SECURITY_SCAN_MODEL;
  if (!model) {
    throw new Error("SECURITY_SCAN_MODEL is not set");
  }
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const resendFromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendFromEmail) {
    throw new Error("RESEND_FROM_EMAIL is not set");
  }
  const securityScanRecipient = process.env.SECURITY_SCAN_RECIPIENT;
  if (!securityScanRecipient) {
    throw new Error("SECURITY_SCAN_RECIPIENT is not set");
  }

  return { openrouterApiKey, model, resendApiKey, resendFromEmail, securityScanRecipient };
};

export const getToonFiles = ({ dir }: { dir: string }): string[] => {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".toon"))
    .map((file) => join(dir, file));
};

export const loadPrompt = ({ promptPath }: { promptPath: string }): string => {
  return readFileSync(promptPath, "utf-8");
};

// oxlint-disable-next-line no-explicit-any -- duck-type to decouple from private SDK internals
export type OpenRouterClient = { chat: { send: (...args: any[]) => Promise<any> } };

export const runSecurityScan = async ({
  client,
  toonContent,
  model,
  prompt,
}: {
  client: OpenRouterClient;
  toonContent: string;
  model: string;
  prompt: string;
}): Promise<SecurityScanResult> => {
  const response = await client.chat.send({
    chatGenerationParams: {
      model,
      messages: [{ role: "user", content: `${prompt}\n\n${toonContent}` }],
      responseFormat: {
        type: "json_schema" as const,
        jsonSchema: {
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
      stream: false as const,
    },
    httpReferer: "https://github.com/dyoshikawa/rulesync",
    xTitle: "rulesync security-scan",
  });

  const content = response.choices[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("No content returned from OpenRouter");
  }

  return SecurityScanResultSchema.parse(JSON.parse(content));
};

export const formatEmailBody = ({
  results,
}: {
  results: Map<string, SecurityScanResult>;
}): string => {
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

export const sendEmail = async ({
  apiKey,
  from,
  to,
  body,
}: {
  apiKey: string;
  from: string;
  to: string;
  body: string;
}): Promise<void> => {
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to,
    subject: "Security Scan Report",
    text: body,
  });
};
