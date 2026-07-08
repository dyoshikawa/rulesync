// oxlint-disable no-console

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { OpenRouter } from "@openrouter/sdk";

import { formatError } from "../src/utils/error.js";
import type { SecurityScanResult } from "./security-scan-lib.js";
import {
  countHighSeverityVulnerabilities,
  formatEmailBody,
  generateOverallSummary,
  getXmlFiles,
  runSecurityScan,
  sendEmail,
  validateEnv,
} from "./security-scan-lib.js";

const XML_FORMAT_DESCRIPTION = `\
## About the Input Format

The content below is a repomix XML packed representation of a codebase. The files are wrapped in \
\`<file path="...">\` elements whose \`path\` attribute is the file path and whose text content is \
the file source. Line numbers may be prefixed to each line.

## Response Format

Report each vulnerability as a JSON object with the following keys:
- **severity**: One of "low", "medium", "high", "critical"
- **reason**: A concise description of the vulnerability in Japanese
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
  const prompt = `${XML_FORMAT_DESCRIPTION}\n${securityScanPrompt}`;

  const client = new OpenRouter({ apiKey: openrouterApiKey });

  const baseDir = process.cwd();
  const xmlFiles = getXmlFiles({ dir: baseDir });

  if (xmlFiles.length === 0) {
    console.log("No xml files found to scan. Skipping.");
    return;
  }

  console.log(`Found ${xmlFiles.length} xml files to scan`);

  const results = new Map<string, SecurityScanResult>();
  const errors: string[] = [];

  for (const xmlPath of xmlFiles) {
    const filename = basename(xmlPath);
    console.log(`Scanning ${filename}...`);

    try {
      const content = readFileSync(xmlPath, "utf-8");
      const scanResult = await runSecurityScan({ client, content, model, prompt });

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

  // Filter results to only include xml files with high+ severity vulnerabilities
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

  // Generate an AI summary from the full scan results to prepend to the email.
  // Failure here must not block the notification, so fall back to no summary.
  let overallSummary: string | undefined;
  try {
    overallSummary = await generateOverallSummary({ client, model, results });
    console.log("Generated AI summary");
  } catch (error: unknown) {
    console.warn(`Failed to generate AI summary: ${formatError(error)}`);
  }

  const emailBody = formatEmailBody({ results: highSeverityResults, overallSummary });
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
