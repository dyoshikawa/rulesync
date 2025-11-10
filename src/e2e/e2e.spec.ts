import { exec } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../utils/file.js";

// Save original working directory
const originalCwd = process.cwd();

const execAsync = promisify(exec);

// Get the command to run from environment variable
// Default to using tsx directly with the CLI entry point
const tsxPath = join(originalCwd, "node_modules", ".bin", "tsx");
const cliPath = join(originalCwd, "src", "cli", "index.ts");

// Validate process.env.RULESYNC_CMD
if (process.env.RULESYNC_CMD) {
  const resolvedRulesyncCmd = resolve(process.env.RULESYNC_CMD);
  const splittedResolvedRulesyncCmd = resolvedRulesyncCmd.split(sep);
  const valid =
    splittedResolvedRulesyncCmd.at(-2) === "dist-deno" &&
    splittedResolvedRulesyncCmd.at(-1)?.startsWith("rulesync-");
  if (!valid) {
    throw new Error(
      `Invalid RULESYNC_CMD: must start with 'dist-deno' directory and end with 'rulesync-<platform>-<arch>': ${process.env.RULESYNC_CMD}`,
    );
  }
}

// Convert relative path to absolute path if RULESYNC_CMD is set
const rulesyncCmd = process.env.RULESYNC_CMD
  ? join(originalCwd, process.env.RULESYNC_CMD)
  : `${tsxPath} ${cliPath}`;

describe("E2E Tests", () => {
  let testDir: string;
  // let cleanup: () => Promise<void>;

  beforeEach(async () => {
    // Setup test directory and change to it
    // ({ testDir, cleanup } = await setupTestDirectory());
    testDir = (await setupTestDirectory()).testDir;
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original working directory before cleanup
    process.chdir(originalCwd);
    // await cleanup();
  });

  it("should display version with --version", async () => {
    const { stdout } = await execAsync(`${rulesyncCmd} --version`);

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
    const ruleFilePath = join(testDir, rulesDir, "overview.md");
    await writeFileContent(ruleFilePath, ruleContent);

    // Execute: Generate claudecode rules
    await execAsync(`${rulesyncCmd} generate --targets claudecode --features rules`);

    // Wait for file system operations to complete
    await setTimeout(3000);

    await execAsync(`ls -la ${testDir}`);

    // Verify that the CLAUDE.md file was generated
    const claudeMdPath = join(testDir, "CLAUDE.md");
    const generatedContent = await readFileContent(claudeMdPath);
    expect(generatedContent).toContain("Test Rule");
  });

  it("should import claudecode rules", async () => {
    // Setup: Create a CLAUDE.md file to import
    const claudeMdContent = `# Project Overview

This is a test project for E2E testing.
`;
    const claudeMdPath = join(testDir, "CLAUDE.md");
    await writeFileContent(claudeMdPath, claudeMdContent);

    // Execute: Import claudecode rules
    await execAsync(`${rulesyncCmd} import --targets claudecode`);

    // Wait for file system operations to complete
    await setTimeout(3000);

    // Verify that the imported rule file was created
    const importedRulePath = join(testDir, ".rulesync", "rules", "CLAUDE.md");
    const importedContent = await readFileContent(importedRulePath);
    expect(importedContent).toContain("Project Overview");
  });
});
