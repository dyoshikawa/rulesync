import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate } from "./e2e-helper.js";

const originalCwd = process.cwd();

describe("E2E: --input-root (read from A, write to B)", () => {
  let sourceDir = "";
  let outputDir = "";
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupSource: () => Promise<void> = async () => {};
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- default avoids undefined if beforeEach fails
  let cleanupOutput: () => Promise<void> = async () => {};

  beforeEach(async () => {
    ({ testDir: sourceDir, cleanup: cleanupSource } = await setupTestDirectory());
    ({ testDir: outputDir, cleanup: cleanupOutput } = await setupTestDirectory());
    process.chdir(outputDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupSource();
    await cleanupOutput();
  });

  it.each([
    { target: "claudecode", outputPath: "CLAUDE.md" },
    { target: "cursor", outputPath: join(".cursor", "rules", "overview.mdc") },
    { target: "codexcli", outputPath: "AGENTS.md" },
  ])(
    "should read rules from --input-root and write $target output to cwd",
    async ({ target, outputPath }) => {
      const ruleContent = `---
root: true
targets: ["*"]
description: "Input-root test rule"
globs: ["**/*"]
---

# Input Root Test Rule

Rules live in sourceDir; output must land in outputDir.
`;
      await writeFileContent(
        join(sourceDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
        ruleContent,
      );

      await runGenerate({ target, features: "rules", inputRoot: sourceDir });

      const generatedContent = await readFileContent(join(outputDir, outputPath));
      expect(generatedContent).toContain("Input Root Test Rule");

      expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
    },
  );
});
