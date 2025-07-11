import { join } from "node:path";
import { ensureDir, fileExists, writeFileContent } from "../../utils/index.js";

export async function initCommand(): Promise<void> {
  const aiRulesDir = ".rulesync";

  console.log("Initializing rulesync...");

  // Create .rulesync directory
  await ensureDir(aiRulesDir);

  // Create sample rule files
  await createSampleFiles(aiRulesDir);

  console.log("✅ rulesync initialized successfully!");
  console.log("\nNext steps:");
  console.log("1. Edit rule files in .rulesync/");
  console.log("2. Run 'rulesync generate' to create configuration files");
}

async function createSampleFiles(aiRulesDir: string): Promise<void> {
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

  const filepath = join(aiRulesDir, sampleFile.filename);
  if (!(await fileExists(filepath))) {
    await writeFileContent(filepath, sampleFile.content);
    console.log(`Created ${filepath}`);
  } else {
    console.log(`Skipped ${filepath} (already exists)`);
  }
}
