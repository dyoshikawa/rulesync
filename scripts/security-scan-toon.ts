// oxlint-disable no-console

import { OpenRouter } from "@openrouter/sdk";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { SecurityScanResult } from "./security-scan-lib.js";

import { formatError } from "../src/utils/error.js";
import {
  formatEmailBody,
  getToonFiles,
  runSecurityScan,
  sendEmail,
  validateEnv,
} from "./security-scan-lib.js";

const main = async (): Promise<void> => {
  const env = validateEnv();
  const {
    openrouterApiKey,
    model,
    securityScanPrompt: prompt,
    resendApiKey,
    resendFromEmail,
    securityScanRecipient,
  } = env;

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

  const totalVulnerabilities = [...results.values()].reduce(
    (sum, r) => sum + r.vulnerabilities.length,
    0,
  );
  const date = new Date().toISOString().split("T")[0];
  const subject = `Security Scan Report - ${date} (${totalVulnerabilities} vulnerabilities found)`;

  const emailBody = formatEmailBody({ results });
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
