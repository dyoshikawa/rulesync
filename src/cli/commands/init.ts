import { join } from "node:path";
import { RulesyncCommand } from "../../commands/rulesync-command.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export async function initCommand(): Promise<void> {
  logger.info("Initializing rulesync...");

  await ensureDir(".rulesync");
  await createSampleFiles();

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(`1. Edit rule files in .rulesync/rules/`);
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

async function createSampleFiles(): Promise<void> {
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

  const filepath = join(".rulesync/rules", sampleFile.filename);
  await ensureDir(".rulesync/rules");
  await ensureDir(RulesyncCommand.getSettablePaths().relativeDirPath);
  await ensureDir(".rulesync/subagents");
  if (!(await fileExists(filepath))) {
    await writeFileContent(filepath, sampleFile.content);
    logger.success(`Created ${filepath}`);
  } else {
    logger.info(`Skipped ${filepath} (already exists)`);
  }
}
