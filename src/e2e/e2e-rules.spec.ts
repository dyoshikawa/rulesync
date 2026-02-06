import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: rules", () => {
  const { getTestDir } = useTestDirectory();

  // Both codexcli and opencode generate AGENTS.md as their root rule output
  it.each([
    { target: "claudecode", outputPath: "CLAUDE.md" },
    { target: "cursor", outputPath: join(".cursor", "rules", "overview.mdc") },
    { target: "codexcli", outputPath: "AGENTS.md" },
    { target: "copilot", outputPath: join(".github", "copilot-instructions.md") },
    { target: "opencode", outputPath: "AGENTS.md" },
  ])("should generate $target rules", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create necessary directories and a sample rule file
    const ruleContent = `---
root: true
targets: ["*"]
description: "Test rule"
globs: ["**/*"]
---

# Test Rule

This is a test rule for E2E testing.
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      ruleContent,
    );

    // Execute: Generate rules for the target
    await runGenerate({ target, features: "rules" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("Test Rule");
  });
});
