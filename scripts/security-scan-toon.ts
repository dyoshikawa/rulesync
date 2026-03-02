// oxlint-disable no-console

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { OpenRouter } from "@openrouter/sdk";

import { formatError } from "../src/utils/error.js";
import type { SecurityScanResult } from "./security-scan-lib.js";
import {
  countHighSeverityVulnerabilities,
  formatEmailBody,
  getToonFiles,
  runSecurityScan,
  sendEmail,
  validateEnv,
} from "./security-scan-lib.js";

const TOON_FORMAT_DESCRIPTION = `\
## About TOON Format

The content below is encoded in TOON (Token-Oriented Object Notation), a compact data format \
designed for LLM prompts. Here is a quick reference for reading TOON:

- Key-value pairs use colon separation: \`name: Alice\`
- Primitive arrays use bracket notation for length: \`colors[3]: red,green,blue\`
- Tabular arrays declare fields in braces, then list rows:
  \`\`\`
  users[2]{id,name,role}:
    1,Alice,admin
    2,Bob,user
  \`\`\`
- Nesting is represented by indentation (similar to YAML):
  \`\`\`
  user:
    id: 1
    profile:
      age: 30
  \`\`\`
- Strings are unquoted unless they contain special characters, match boolean/null keywords, or resemble numbers.

## Response Format

Report each vulnerability as a JSON object with the following keys:
- **severity**: One of "low", "medium", "high", "critical"
- **reason**: A concise description of the vulnerability
- **filePath**: The file path where the vulnerability was found
- **line**: The line range (e.g., "L10", "L10-L11")
`;

const main = async (): Promise<void> => {
  const env = validateEnv();
  const {
    openrouterApiKey,
    model,
    securityScanPrompt,
    resendApiKey,
    resendFromEmail,
    securityScanRecipient,
  } = env;
  const prompt = `${TOON_FORMAT_DESCRIPTION}\n${securityScanPrompt}`;

  const client = new OpenRouter({ apiKey: openrouterApiKey });

  const baseDir = process.cwd();
  const toonFiles = getToonFiles({ dir: baseDir });

  if (toonFiles.length === 0) {
    console.log("No toon files found to scan. Skipping.");
    return;
  }

  console.log(`Found ${toonFiles.length} toon files to scan`);

  const results = new Map<string, SecurityScanResult>();
  const errors: string[] = [];

  for (const toonPath of toonFiles) {
    const filename = basename(toonPath);
    console.log(`Scanning ${filename}...`);

    try {
      const toonContent = readFileSync(toonPath, "utf-8");
      const scanResult = await runSecurityScan({ client, toonContent, model, prompt });

      results.set(filename, scanResult);
      console.log(`  Found ${scanResult.vulnerabilities.length} vulnerabilities`);
    } catch (error: unknown) {
      const message = `Failed to scan ${filename}: ${formatError(error)}`;
      console.error(message);
      errors.push(message);
    }
  }

  console.log("All scans completed");

  if (results.size === 0) {
    throw new Error("All scans failed. No results to report.");
  }

  if (errors.length > 0) {
    console.warn(`${errors.length} file(s) failed to scan`);
  }

  // Filter results to only include toon files with high+ severity vulnerabilities
  const highSeverityResults = new Map<string, SecurityScanResult>();
  for (const [filename, result] of results.entries()) {
    const hasHighSeverity = result.vulnerabilities.some(
      (v) => v.severity === "high" || v.severity === "critical",
    );
    if (hasHighSeverity) {
      highSeverityResults.set(filename, result);
    }
  }

  if (highSeverityResults.size === 0) {
    console.log("No high+ severity vulnerabilities found. Skipping email notification.");
    return;
  }

  const totalHighVulnerabilities = countHighSeverityVulnerabilities({
    results: highSeverityResults,
  });
  const date = new Date().toISOString().split("T")[0];
  const subject = `Security Scan Report - ${date} (${totalHighVulnerabilities} high+ vulnerabilities found)`;

  const emailBody = formatEmailBody({ results: highSeverityResults });
  await sendEmail({
    apiKey: resendApiKey,
    from: resendFromEmail,
    to: securityScanRecipient,
    subject,
    body: emailBody,
  });

  console.log("Email sent successfully");
};

main().catch((error: unknown) => {
  console.error("Error:", formatError(error));
  process.exit(1);
});
