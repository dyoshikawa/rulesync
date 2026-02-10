// oxlint-disable no-console

import { OpenRouter } from "@openrouter/sdk";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { SecurityScanResult } from "./security-scan-lib.js";

import { formatError } from "../src/utils/error.js";
import {
  formatEmailBody,
  getToonFiles,
  loadPrompt,
  runSecurityScan,
  sendEmail,
  validateEnv,
} from "./security-scan-lib.js";

const main = async (): Promise<void> => {
  const env = validateEnv();
  const { openrouterApiKey, model, resendApiKey, resendFromEmail, securityScanRecipient } = env;

  const client = new OpenRouter({ apiKey: openrouterApiKey });

  const promptPath = join(import.meta.dirname, "security-scan-prompt.txt");
  const prompt = loadPrompt({ promptPath });

  const baseDir = process.cwd();
  const toonFiles = getToonFiles({ dir: baseDir });

  console.log(`Found ${toonFiles.length} toon files to scan`);

  const results = new Map<string, SecurityScanResult>();

  for (const toonPath of toonFiles) {
    const filename = basename(toonPath);
    console.log(`Scanning ${filename}...`);

    const toonContent = readFileSync(toonPath, "utf-8");
    const scanResult = await runSecurityScan({ client, toonContent, model, prompt });

    results.set(filename, scanResult);
    console.log(`  Found ${scanResult.vulnerabilities.length} vulnerabilities`);
  }

  console.log("All scans completed");

  const emailBody = formatEmailBody({ results });
  await sendEmail({
    apiKey: resendApiKey,
    from: resendFromEmail,
    to: securityScanRecipient,
    body: emailBody,
  });

  console.log("Email sent successfully");
};

main().catch((error: unknown) => {
  console.error("Error:", formatError(error));
  process.exit(1);
});
