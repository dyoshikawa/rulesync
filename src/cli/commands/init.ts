import { join } from "node:path";
import {
  RULESYNC_DIR,
  RULESYNC_RULES_DIR,
  RULESYNC_SUBAGENTS_DIR,
} from "../../constants/paths.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { RulesyncCommand } from "../../commands/rulesync-command.js";

export async function initCommand(): Promise<void> {
  logger.info("Initializing rulesync...");

  await ensureDir(RULESYNC_DIR);
  await createSampleFiles();

  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(`1. Edit rule files in ${RULESYNC_RULES_DIR}/`);
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

  const filepath = join(RULESYNC_RULES_DIR, sampleFile.filename);
  await ensureDir(RULESYNC_RULES_DIR);
  await ensureDir(RulesyncCommand.getSettablePaths().relativeDirPath);
  await ensureDir(RULESYNC_SUBAGENTS_DIR);
  if (!(await fileExists(filepath))) {
    await writeFileContent(filepath, sampleFile.content);
    logger.success(`Created ${filepath}`);
  } else {
    logger.info(`Skipped ${filepath} (already exists)`);
  }
}
