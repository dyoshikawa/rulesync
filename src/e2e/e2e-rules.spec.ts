import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useGlobalTestDirectories, useTestDirectory } from "./e2e-helper.js";

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

describe("E2E: rules (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "CLAUDE.md") },
    { target: "copilot", outputPath: join(".copilot", "copilot-instructions.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "AGENTS.md") },
  ])("should generate $target rules in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root rule in the project directory
    const ruleContent = `---
root: true
targets: ["*"]
description: "Global test rule"
globs: ["**/*"]
---

# Global Test Rule

This is a global test rule for E2E testing.
`;
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      ruleContent,
    );

    // Execute: Generate rules in global mode with HOME pointed to temp dir
    await runGenerate({
      target,
      features: "rules",
      global: true,
      env: { NODE_ENV: "test", HOME_DIR: homeDir },
    });

    // Verify that the output file was written to the home directory
    const generatedContent = await readFileContent(join(homeDir, outputPath));
    expect(generatedContent).toContain("Global Test Rule");
  });

  it("should ignore non-root rules in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root rule (overview) and a non-root rule
    const rootRuleContent = `---
root: true
targets: ["*"]
description: "Root rule"
globs: ["**/*"]
---

# Root Rule Content
`;
    const nonRootRuleContent = `---
targets: ["*"]
description: "Non-root rule"
globs: ["src/**/*"]
---

# Non-Root Rule Content
`;
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
      nonRootRuleContent,
    );

    // Execute: Generate rules in global mode
    await runGenerate({
      target: "claudecode",
      features: "rules",
      global: true,
      env: { NODE_ENV: "test", HOME_DIR: homeDir },
    });

    // Verify: root rule content is present, non-root rule content is absent
    const generatedContent = await readFileContent(join(homeDir, ".claude", "CLAUDE.md"));
    expect(generatedContent).toContain("Root Rule Content");
    expect(generatedContent).not.toContain("Non-Root Rule Content");
  });
});
