import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/index.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { generate, getStatus, importConfig, initialize, validate } from "./core.js";
import { getSupportedTools, parseRules } from "./utils.js";

describe("API Integration Tests", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should complete a full workflow: init → add rules → generate → validate", async () => {
    // 1. Initialize project
    const initResult = await initialize({ baseDir: testDir });
    expect(initResult.createdFiles).toHaveLength(2);
    expect(initResult.baseDir).toBe(testDir);

    // 2. Check initial status
    let status = await getStatus({ baseDir: testDir });
    expect(status.isInitialized).toBe(true);
    expect(status.rulesStatus.totalFiles).toBe(1); // overview.md

    // 3. Add custom rules
    await writeFileContent(
      join(testDir, ".rulesync", "rules", "typescript-rules.md"),
      `---
title: "TypeScript Rules"
description: "TypeScript coding standards"
targets: ["cursor", "claudecode"]
---

# TypeScript Rules

## Type Safety
- Use strict mode in tsconfig.json
- Avoid using 'any' type
- Prefer interfaces over types for object shapes

## Code Style
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Prefer const assertions where appropriate`,
    );

    await writeFileContent(
      join(testDir, ".rulesync", "rules", "security-rules.md"),
      `---
title: "Security Rules"
description: "Security guidelines and best practices"
---

# Security Rules

## Authentication
- Always use HTTPS for API endpoints
- Implement proper token validation
- Use secure session management

## Data Protection
- Encrypt sensitive data at rest
- Validate all user inputs
- Implement proper CORS policies`,
    );

    // 4. Parse rules to verify they were added correctly
    const parseResult = await parseRules({ baseDir: testDir });
    expect(parseResult.errors).toHaveLength(0);
    expect(parseResult.rules.length).toBe(3); // overview + typescript + security

    const typescriptRule = parseResult.rules.find((r) => r.metadata.title === "TypeScript Rules");
    expect(typescriptRule).toBeDefined();
    expect(typescriptRule?.metadata.targets).toEqual(["cursor", "claudecode"]);

    // 5. Generate configurations for multiple tools
    const generateResult = await generate({
      baseDirs: [testDir],
      tools: ["cursor", "claudecode", "copilot"],
      verbose: false,
    });

    expect(generateResult.summary.errorCount).toBe(0);
    expect(generateResult.summary.successCount).toBe(3);

    // Verify files were created
    expect(existsSync(join(testDir, ".cursorrules"))).toBe(true);
    expect(existsSync(join(testDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(testDir, ".github", "copilot-instructions.md"))).toBe(true);

    // 6. Validate the generated configuration
    const validateResult = await validate({ baseDir: testDir });
    expect(validateResult.isValid).toBe(true);
    expect(validateResult.errors).toHaveLength(0);

    // 7. Check final status
    status = await getStatus({ baseDir: testDir });
    expect(status.isInitialized).toBe(true);
    expect(status.rulesStatus.totalFiles).toBe(3);
    expect(status.generatedFilesStatus.length).toBeGreaterThan(0);

    const cursorFiles = status.generatedFilesStatus.find((s) => s.tool === "cursor")?.files;
    expect(cursorFiles?.some((f) => f.exists)).toBe(true);
  });

  it("should handle import → generate workflow", async () => {
    // 1. Create existing AI tool configurations
    await writeFileContent(
      join(testDir, ".cursorrules"),
      `You are an expert TypeScript developer.

Use these principles:
- Write clean, readable code
- Use functional programming patterns
- Always add proper error handling`,
    );

    await ensureDir(join(testDir, ".github"));
    await writeFileContent(
      join(testDir, ".github", "copilot-instructions.md"),
      `# GitHub Copilot Instructions

## Code Style
- Use TypeScript with strict mode
- Prefer functional components in React
- Write comprehensive unit tests

## Security
- Never hardcode secrets
- Validate all user inputs
- Use HTTPS for all API calls`,
    );

    // 2. Initialize rulesync
    const initResult = await initialize({ baseDir: testDir });
    expect(initResult.createdFiles).toHaveLength(2);

    // 3. Import existing configurations
    const importResult = await importConfig({
      baseDir: testDir,
      sources: ["cursor", "copilot"],
      verbose: false,
    });

    expect(importResult.summary.totalSources).toBe(2);
    expect(importResult.summary.successCount).toBe(2);
    expect(importResult.createdFiles.length).toBeGreaterThan(0);

    // 4. Generate for all tools (including imported content)
    const generateResult = await generate({
      baseDirs: [testDir],
      all: true,
    });

    expect(generateResult.summary.errorCount).toBe(0);
    expect(generateResult.summary.successCount).toBeGreaterThan(2);

    // 5. Verify that generated files contain imported content
    const cursorrules = await readFile(join(testDir, ".cursorrules"), "utf-8");
    expect(cursorrules).toContain("TypeScript");
    expect(cursorrules).toContain("functional programming");

    // 6. Final validation
    const validateResult = await validate({ baseDir: testDir });
    expect(validateResult.isValid).toBe(true);
  });

  it("should provide consistent tool information", () => {
    const tools = getSupportedTools();

    // Verify structure consistency
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.displayName).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.features).toBeDefined();
      expect(tool.configPaths).toBeDefined();

      // All tools should support rules
      expect(tool.features.rules).toBe(true);
      expect(tool.configPaths.rules).toBeDefined();
      expect(tool.configPaths.rules!.length).toBeGreaterThan(0);
    }

    // Check specific tool capabilities
    const claudecodeTool = tools.find((t) => t.name === "claudecode");
    expect(claudecodeTool?.features.commands).toBe(true);
    expect(claudecodeTool?.features.mcp).toBe(true);
    expect(claudecodeTool?.features.ignore).toBe(true);

    const agentsmdTool = tools.find((t) => t.name === "agentsmd");
    expect(agentsmdTool?.features.commands).toBe(false);
    expect(agentsmdTool?.features.mcp).toBe(false);
    expect(agentsmdTool?.features.ignore).toBe(false);
  });
});
