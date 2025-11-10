import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../utils/file.js";

// Save original working directory
const originalCwd = process.cwd();

const execAsync = promisify(exec);

// Get the command to run from environment variable
// Default to using tsx directly with the CLI entry point
const workspaceRoot = process.cwd();
const tsxPath = join(workspaceRoot, "node_modules", ".bin", "tsx");
const cliPath = join(workspaceRoot, "src", "cli", "index.ts");
// Convert relative path to absolute path if RULESYNC_CMD is set
const RULESYNC_CMD = process.env.RULESYNC_CMD
  ? join(process.cwd(), process.env.RULESYNC_CMD)
  : `${tsxPath} ${cliPath}`;

describe("E2E Tests", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Setup test directory and change to it
    ({ testDir, cleanup } = await setupTestDirectory());
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original working directory before cleanup
    process.chdir(originalCwd);
    await cleanup();
  });

  it("should display version with --version", async () => {
    const { stdout } = await execAsync(`${RULESYNC_CMD} --version`);

    // Should output a version number (e.g., "3.16.0")
    // Use regex to extract version number to handle potential debug output
    const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    expect(versionMatch).toBeTruthy();
    expect(versionMatch?.[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should generate claudecode rules", async () => {
    // Setup: Create necessary directories and files
    const rulesyncDir = ".rulesync";
    const rulesDir = join(rulesyncDir, "rules");
    await ensureDir(rulesDir);

    // Create a sample rule file
    const ruleContent = `---
root: true
targets: ["*"]
description: "Test rule"
globs: ["**/*"]
---

# Test Rule

This is a test rule for E2E testing.
`;
    const ruleFilePath = join(rulesDir, "overview.md");
    await writeFileContent(ruleFilePath, ruleContent);

    // Execute: Generate claudecode rules
    const { stderr } = await execAsync(
      `${RULESYNC_CMD} generate --targets claudecode --features rules`,
    );

    // Assert: Should not have critical errors (warnings are acceptable)
    // Filter out info/warn level messages, only check for errors
    const errorLines = stderr
      .split("\n")
      .filter((line) => line.includes("[error]"))
      .join("\n");
    expect(errorLines).toBe("");

    // Verify that the CLAUDE.md file was generated
    const claudeMdPath = "CLAUDE.md";
    const generatedContent = await readFileContent(claudeMdPath);
    expect(generatedContent).toContain("Test Rule");
  });

  it("should import claudecode rules", async () => {
    // Setup: Create a CLAUDE.md file to import
    const claudeMdContent = `# Project Overview

This is a test project for E2E testing.
`;
    const claudeMdPath = "CLAUDE.md";
    await writeFileContent(claudeMdPath, claudeMdContent);

    // Execute: Import claudecode rules
    const { stderr } = await execAsync(`${RULESYNC_CMD} import --targets claudecode`);

    // Assert: Should not have critical errors (warnings are acceptable)
    // Filter out info/warn level messages, only check for errors
    const errorLines = stderr
      .split("\n")
      .filter((line) => line.includes("[error]"))
      .join("\n");
    expect(errorLines).toBe("");

    // Verify that the imported rule file was created
    const importedRulePath = join(".rulesync", "rules", "CLAUDE.md");
    const importedContent = await readFileContent(importedRulePath);
    expect(importedContent).toContain("Project Overview");
  });
});
