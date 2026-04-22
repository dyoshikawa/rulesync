import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: rules", () => {
  const { getTestDir } = useTestDirectory();

  // Both codexcli and opencode generate AGENTS.md as their root rule output
  it.each([
    { target: "claudecode", outputPath: "CLAUDE.md" },
    { target: "cursor", outputPath: join(".cursor", "rules", "overview.mdc") },
    { target: "codexcli", outputPath: "AGENTS.md" },
    { target: "copilot", outputPath: join(".github", "copilot-instructions.md") },
    { target: "opencode", outputPath: "AGENTS.md" },
    { target: "geminicli", outputPath: "GEMINI.md" },
    { target: "goose", outputPath: ".goosehints" },
    { target: "copilotcli", outputPath: join(".github", "copilot-instructions.md") },
    { target: "kilo", outputPath: "AGENTS.md" },
    { target: "agentsmd", outputPath: "AGENTS.md" },
    { target: "factorydroid", outputPath: "AGENTS.md" },
    { target: "deepagents", outputPath: join(".deepagents", "AGENTS.md") },
    { target: "rovodev", outputPath: join(".rovodev", "AGENTS.md") },
    { target: "qwencode", outputPath: "QWEN.md" },
    { target: "junie", outputPath: join(".junie", "guidelines.md") },
    { target: "warp", outputPath: "WARP.md" },
    { target: "replit", outputPath: "replit.md" },
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

  it.each([
    { target: "cline", outputPath: join(".clinerules", "overview.md") },
    { target: "roo", outputPath: join(".roo", "rules", "overview.md") },
    { target: "kiro", outputPath: join(".kiro", "steering", "overview.md") },
    { target: "antigravity", outputPath: join(".agent", "rules", "overview.md") },
    { target: "augmentcode", outputPath: join(".augment", "rules", "overview.md") },
    { target: "windsurf", outputPath: join(".windsurf", "rules", "overview.md") },
    { target: "takt", outputPath: join(".takt", "facets", "policies", "overview.md") },
  ])("should generate $target rules (non-root)", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create a non-root rule file
    const ruleContent = `---
targets: ["*"]
description: "Test rule"
globs: ["src/**/*"]
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

  it("should fail in check mode when delete would remove an orphan rule file", async () => {
    const testDir = getTestDir();

    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(join(testDir, "CLAUDE.md"), "# orphan\n");

    await expect(
      runGenerate({
        target: "claudecode",
        features: "rules",
        deleteFiles: true,
        check: true,
        env: { NODE_ENV: "e2e" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Files are not up to date. Run 'rulesync generate' to update.",
      ),
    });

    expect(await readFileContent(join(testDir, "CLAUDE.md"))).toBe("# orphan\n");
  });

  it("should print a single up-to-date message in check mode when there is no diff", async () => {
    const testDir = getTestDir();

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

    await runGenerate({ target: "claudecode", features: "rules" });

    const { stdout, stderr } = await runGenerate({
      target: "claudecode",
      features: "rules",
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stderr).toBe("");
    expect(stdout.match(/All files are up to date\./g)).toHaveLength(1);
    expect(stdout).not.toContain("All files are up to date (rules)");
  });
});

describe("E2E: rules (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: "CLAUDE.md", importedFileName: "CLAUDE.md" },
    {
      target: "cursor",
      sourcePath: join(".cursor", "rules", "overview.mdc"),
      importedFileName: "overview.md",
    },
    { target: "codexcli", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    {
      target: "copilot",
      sourcePath: join(".github", "copilot-instructions.md"),
      importedFileName: "copilot-instructions.md",
    },
    { target: "opencode", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    { target: "geminicli", sourcePath: "GEMINI.md", importedFileName: "overview.md" },
    { target: "goose", sourcePath: ".goosehints", importedFileName: "overview.md" },
    {
      target: "copilotcli",
      sourcePath: join(".github", "copilot-instructions.md"),
      importedFileName: "copilot-instructions.md",
    },
    { target: "kilo", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    { target: "agentsmd", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    { target: "factorydroid", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    {
      target: "deepagents",
      sourcePath: join(".deepagents", "AGENTS.md"),
      importedFileName: "overview.md",
    },
    {
      target: "rovodev",
      sourcePath: join(".rovodev", "AGENTS.md"),
      importedFileName: "overview.md",
    },
    { target: "qwencode", sourcePath: "QWEN.md", importedFileName: "overview.md" },
    {
      target: "junie",
      sourcePath: join(".junie", "guidelines.md"),
      importedFileName: "overview.md",
    },
    { target: "warp", sourcePath: "WARP.md", importedFileName: "overview.md" },
    { target: "replit", sourcePath: "replit.md", importedFileName: "overview.md" },
    {
      target: "cline",
      sourcePath: join(".clinerules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "roo",
      sourcePath: join(".roo", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "kiro",
      sourcePath: join(".kiro", "steering", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "antigravity",
      sourcePath: join(".agent", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "augmentcode",
      sourcePath: join(".augment", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "windsurf",
      sourcePath: join(".windsurf", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
  ])("should import $target rules", async ({ target, sourcePath, importedFileName }) => {
    const testDir = getTestDir();

    const ruleContent = `# Project Overview

This is a test project for E2E testing.
`;
    await writeFileContent(join(testDir, sourcePath), ruleContent);

    await runImport({ target, features: "rules" });

    const importedRulePath = join(testDir, ".rulesync", "rules", importedFileName);
    const importedContent = await readFileContent(importedRulePath);
    expect(importedContent).toContain("Project Overview");
  });
});

describe("E2E: rules (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "CLAUDE.md") },
    { target: "copilot", outputPath: join(".copilot", "copilot-instructions.md") },
    { target: "opencode", outputPath: join(".config", "opencode", "AGENTS.md") },
    { target: "codexcli", outputPath: join(".codex", "AGENTS.md") },
    { target: "geminicli", outputPath: join(".gemini", "GEMINI.md") },
    { target: "goose", outputPath: ".goosehints" },
    { target: "copilotcli", outputPath: join(".copilot", "copilot-instructions.md") },
    { target: "factorydroid", outputPath: join(".factory", "AGENTS.md") },
    { target: "kilo", outputPath: join(".config", "kilo", "AGENTS.md") },
    { target: "rovodev", outputPath: join(".rovodev", "AGENTS.md") },
    { target: "takt", outputPath: join(".takt", "facets", "policies", "overview.md") },
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
      env: { HOME_DIR: homeDir },
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
      env: { HOME_DIR: homeDir },
    });

    // Verify: root rule content is present, non-root rule content is absent
    const generatedContent = await readFileContent(join(homeDir, ".claude", "CLAUDE.md"));
    expect(generatedContent).toContain("Root Rule Content");
    expect(generatedContent).not.toContain("Non-Root Rule Content");
  });
});
