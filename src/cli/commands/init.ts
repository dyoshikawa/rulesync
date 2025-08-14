import { join } from "node:path";
import { loadConfig } from "../../utils/config-loader.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export async function initCommand(options: { legacy?: boolean } = {}): Promise<void> {
  const configResult = await loadConfig();
  const config = configResult.config;
  const aiRulesDir = config.aiRulesDir;

  logger.log("Initializing rulesync...");

  // Create .rulesync directory
  await ensureDir(aiRulesDir);

  // Determine whether to use legacy location based on options and config
  const useLegacy = options.legacy ?? config.legacy ?? false;
  const rulesDir = useLegacy ? aiRulesDir : join(aiRulesDir, "rules");

  // Create rules directory if using new location
  if (!useLegacy) {
    await ensureDir(rulesDir);
  }

  // Create sample rule files
  await createSampleFiles(rulesDir);

  logger.success("rulesync initialized successfully!");
  logger.log("\nNext steps:");
  logger.log(`1. Edit rule files in ${rulesDir}/`);
  logger.log("2. Run 'rulesync generate' to create configuration files");
}

async function createSampleFiles(rulesDir: string): Promise<void> {
  const sampleFile = {
    filename: "overview.md",
    content: `---
root: true
targets: ["*"]
description: "Project overview and general development guidelines"
globs: ["**/*"]
---

# Project Overview

## General Guidelines

- Use TypeScript for all new code
- Follow consistent naming conventions
- Write self-documenting code with clear variable and function names
- Prefer composition over inheritance
- Use meaningful comments for complex business logic

## Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Use trailing commas in multi-line objects and arrays

## Architecture Principles

- Organize code by feature, not by file type
- Keep related files close together
- Use dependency injection for better testability
- Implement proper error handling
- Follow single responsibility principle
`,
  };

  const filepath = join(rulesDir, sampleFile.filename);
  if (!(await fileExists(filepath))) {
    await writeFileContent(filepath, sampleFile.content);
    logger.success(`Created ${filepath}`);
  } else {
    logger.log(`Skipped ${filepath} (already exists)`);
  }
}
