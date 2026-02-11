import { readdirSync } from "node:fs";
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

export const getToonFiles = ({ dir }: { dir: string }): string[] => {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".toon"))
    .map((file) => join(dir, file));
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
          schema: SECURITY_SCAN_JSON_SCHEMA,
        },
      },
      stream: false as const,
    },
    httpReferer: "https://github.com/dyoshikawa/rulesync",
    xTitle: "rulesync security-scan",
  });

  const content = response.choices?.[0]?.message?.content;

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
    const vulnCount = result.vulnerabilities.length;
    const vulnLabel = vulnCount === 1 ? "vulnerability" : "vulnerabilities";
    body += `### Found ${vulnCount} ${vulnLabel}\n\n`;

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
