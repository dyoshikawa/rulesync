import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
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
    { target: "amp", outputPath: "AGENTS.md" },
    { target: "codexcli", outputPath: "AGENTS.md" },
    { target: "grokcli", outputPath: "AGENTS.md" },
    { target: "hermesagent", outputPath: ".hermes.md" },
    { target: "copilot", outputPath: join(".github", "copilot-instructions.md") },
    { target: "opencode", outputPath: "AGENTS.md" },
    { target: "geminicli", outputPath: "GEMINI.md" },
    { target: "antigravity-cli", outputPath: "AGENTS.md" },
    { target: "antigravity-ide", outputPath: "AGENTS.md" },
    { target: "goose", outputPath: ".goosehints" },
    { target: "copilotcli", outputPath: join(".github", "copilot-instructions.md") },
    { target: "kilo", outputPath: "AGENTS.md" },
    { target: "agentsmd", outputPath: "AGENTS.md" },
    { target: "factorydroid", outputPath: "AGENTS.md" },
    { target: "deepagents", outputPath: join(".deepagents", "AGENTS.md") },
    { target: "rovodev", outputPath: join(".rovodev", "AGENTS.md") },
    { target: "qwencode", outputPath: "QWEN.md" },
    { target: "junie", outputPath: join(".junie", "AGENTS.md") },
    { target: "warp", outputPath: "AGENTS.md" },
    { target: "replit", outputPath: "replit.md" },
    { target: "pi", outputPath: "AGENTS.md" },
    { target: "zed", outputPath: ".rules" },
    { target: "vibe", outputPath: "AGENTS.md" },
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
    { target: "kiro-cli", outputPath: join(".kiro", "steering", "overview.md") },
    { target: "kiro-ide", outputPath: join(".kiro", "steering", "overview.md") },
    { target: "antigravity", outputPath: join(".agent", "rules", "overview.md") },
    { target: "antigravity-ide", outputPath: join(".agents", "rules", "overview.md") },
    { target: "augmentcode", outputPath: join(".augment", "rules", "overview.md") },
    { target: "devin", outputPath: join(".devin", "rules", "overview.md") },
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

  it("should fold pi non-root rules into the root AGENTS.md", async () => {
    const testDir = getTestDir();

    const rootRuleContent = `---
root: true
targets: ["pi"]
description: "Root rule"
globs: ["**/*"]
---

# Pi Root Rule
`;
    const nonRootRuleContent = `---
targets: ["pi"]
description: "Detail rule"
globs: ["src/**/*"]
---

# Pi Detail Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
      nonRootRuleContent,
    );

    await runGenerate({ target: "pi", features: "rules" });

    // Both bodies land in the single root AGENTS.md; no inert .agents/memories tree.
    const rootContent = await readFileContent(join(testDir, "AGENTS.md"));
    expect(rootContent).toContain("Pi Root Rule");
    expect(rootContent).toContain("Pi Detail Rule");
    expect(await fileExists(join(testDir, ".agents", "memories", "detail.md"))).toBe(false);
  });

  it("should generate qwencode non-root rules into .qwen/rules with paths frontmatter", async () => {
    const testDir = getTestDir();

    // Root rule -> QWEN.md, non-root rule with globs -> .qwen/rules/*.md with `paths`.
    const rootRuleContent = `---
root: true
targets: ["*"]
description: "Root rule"
globs: ["**/*"]
---

# Root Rule
`;
    const nonRootRuleContent = `---
targets: ["*"]
description: "Coding guidelines"
globs: ["src/**/*.ts"]
---

# Non-Root Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
      nonRootRuleContent,
    );

    await runGenerate({ target: "qwencode", features: "rules" });

    // Root memory file is unchanged.
    const rootContent = await readFileContent(join(testDir, "QWEN.md"));
    expect(rootContent).toContain("Root Rule");
    // Qwen Code auto-discovers `.qwen/rules/`, so the root file must not carry a
    // reference block pointing at the non-root rule files.
    expect(rootContent).not.toContain(".qwen/rules/");

    // Non-root rule lands in .qwen/rules/ with `paths` and `description`.
    const nonRootContent = await readFileContent(
      join(testDir, ".qwen", "rules", "coding-guidelines.md"),
    );
    expect(nonRootContent).toContain("Non-Root Rule");
    expect(nonRootContent).toContain("paths:");
    expect(nonRootContent).toContain("src/**/*.ts");
    expect(nonRootContent).toContain("description: Coding guidelines");
  });

  it("should generate cline non-root rules into .clinerules with paths frontmatter", async () => {
    const testDir = getTestDir();

    // Root rule -> AGENTS.md (plain); non-root rule with globs -> .clinerules/*.md
    // with `paths`; universal-glob rule -> `alwaysApply`.
    const rootRuleContent = `---
root: true
targets: ["*"]
description: "Root rule"
globs: ["**/*"]
---

# Root Rule
`;
    const nonRootRuleContent = `---
targets: ["*"]
description: "Coding guidelines"
globs: ["src/**/*.ts"]
---

# Non-Root Rule
`;
    const alwaysRuleContent = `---
targets: ["*"]
description: "Always conventions"
globs: ["**/*"]
---

# Always Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
      nonRootRuleContent,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "always.md"),
      alwaysRuleContent,
    );

    await runGenerate({ target: "cline", features: "rules" });

    // Root rule lands in the plain AGENTS.md memory file.
    const rootContent = await readFileContent(join(testDir, "AGENTS.md"));
    expect(rootContent).toContain("Root Rule");

    // Non-root rule with specific globs lands in .clinerules/ with `paths`.
    const nonRootContent = await readFileContent(
      join(testDir, ".clinerules", "coding-guidelines.md"),
    );
    expect(nonRootContent).toContain("Non-Root Rule");
    expect(nonRootContent).toContain("paths:");
    expect(nonRootContent).toContain("src/**/*.ts");
    expect(nonRootContent).toContain("description: Coding guidelines");

    // Universal-glob rule maps to alwaysApply instead of paths.
    const alwaysContent = await readFileContent(join(testDir, ".clinerules", "always.md"));
    expect(alwaysContent).toContain("alwaysApply: true");
    expect(alwaysContent).not.toContain("paths:");
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

  it("should write BOTH instructions (rules) and mcp into a single kilo.jsonc when generating rules+mcp together", async () => {
    const testDir = getTestDir();

    // Non-root rule -> .kilo/rules/*.md, registered in kilo.jsonc `instructions`.
    const nonRootRuleContent = `---
targets: ["*"]
description: "Detail rule"
globs: ["src/**/*"]
---

# Detail Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
      nonRootRuleContent,
    );

    // MCP server -> kilo.jsonc `mcp` block.
    const mcpContent = JSON.stringify(
      {
        mcpServers: {
          "test-server": {
            type: "stdio",
            command: "echo",
            args: ["hello"],
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    // Drive the real generate flow for both features at once. The shared
    // kilo.jsonc must end up with BOTH keys: neither feature clobbers the other.
    await runGenerate({ target: "kilo", features: "rules,mcp" });

    const generatedContent = await readFileContent(join(testDir, "kilo.jsonc"));
    const json = JSON.parse(generatedContent);

    expect(json.instructions).toEqual([".kilo/rules/detail.md"]);
    expect(json.mcp?.["test-server"]).toBeDefined();
    expect(json.mcp["test-server"].type).toBe("local");
  });

  it("should pass check for a non-owning target when another target owns AGENTS.md", async () => {
    const testDir = getTestDir();

    const rootRuleContent = `---
root: true
targets: ["*"]
description: "Root rule"
---

# Root Rule
`;
    const nonRootRuleContent = `---
targets: ["*"]
description: "Detail rule"
globs: ["src/**/*"]
---

# Detail Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
      nonRootRuleContent,
    );

    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          targets: {
            codexcli: ["rules"],
            "antigravity-ide": ["rules"],
          },
        },
        null,
        2,
      ),
    );

    // Full generate with both targets — antigravity-ide is last so it owns AGENTS.md
    await runGenerate({
      target: "codexcli,antigravity-ide",
      features: "rules",
      env: { NODE_ENV: "e2e" },
    });

    // AGENTS.md exists (owned by antigravity-ide)
    expect(await readFileContent(join(testDir, "AGENTS.md"))).toContain("Root Rule");

    // The non-root "Detail Rule" body is emitted by the owning target
    // (antigravity-ide) under its own .agents/rules/ tree.
    const nonRoot = await readFileContent(join(testDir, ".agents", "rules", "detail.md"));
    expect(nonRoot).toContain("Detail Rule");

    // codexcli folds non-root rules into the root AGENTS.md and no longer writes
    // the inert .codex/memories/ tree (see #1765 / #1979).
    expect(await fileExists(join(testDir, ".codex", "memories", "detail.md"))).toBe(false);

    // Check codexcli only — should pass even though AGENTS.md is owned by antigravity-ide
    const { stdout, stderr } = await runGenerate({
      target: "codexcli",
      features: "rules",
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("All files are up to date.");
  });

  it("should attribute rovodev's mirrored ./AGENTS.md so a non-owning target passes check (#1981 #2)", async () => {
    const testDir = getTestDir();

    const rootRuleContent = `---
root: true
targets: ["*"]
description: "Root rule"
---

# Root Rule
`;
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );

    await writeFileContent(
      join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          targets: {
            codexcli: ["rules"],
            rovodev: ["rules"],
          },
        },
        null,
        2,
      ),
    );

    // rovodev is last in config order and mirrors its root rule to the project
    // root ./AGENTS.md, so that mirrored file ends up on disk with rovodev's
    // content (an "Additional Conventions" preamble codexcli never emits).
    await runGenerate({
      target: "codexcli,rovodev",
      features: "rules",
      env: { NODE_ENV: "e2e" },
    });

    const agentsMd = await readFileContent(join(testDir, "AGENTS.md"));
    expect(agentsMd).toContain("Additional Conventions");

    // Check codexcli only. Even though codexcli's own root output is ./AGENTS.md,
    // rovodev owns the on-disk mirror, so the file is skipped and the check
    // passes. Without crediting the mirror to rovodev, codexcli would be treated
    // as the owner and fail on the content mismatch.
    const { stdout, stderr } = await runGenerate({
      target: "codexcli",
      features: "rules",
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("All files are up to date.");
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
    { target: "amp", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
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
      sourcePath: join(".junie", "AGENTS.md"),
      importedFileName: "overview.md",
    },
    { target: "warp", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    { target: "replit", sourcePath: "replit.md", importedFileName: "overview.md" },
    { target: "pi", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
    { target: "vibe", sourcePath: "AGENTS.md", importedFileName: "overview.md" },
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
      target: "kiro-cli",
      sourcePath: join(".kiro", "steering", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "kiro-ide",
      sourcePath: join(".kiro", "steering", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "antigravity",
      sourcePath: join(".agent", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "antigravity-ide",
      sourcePath: join(".agents", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "antigravity-cli",
      sourcePath: "AGENTS.md",
      importedFileName: "overview.md",
    },
    {
      target: "augmentcode",
      sourcePath: join(".augment", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    {
      target: "devin",
      sourcePath: join(".devin", "rules", "overview.md"),
      importedFileName: "overview.md",
    },
    { target: "zed", sourcePath: ".rules", importedFileName: "overview.md" },
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
    { target: "grokcli", outputPath: join(".grok", "AGENTS.md") },
    { target: "amp", outputPath: join(".config", "amp", "AGENTS.md") },
    { target: "cline", outputPath: join(".agents", "AGENTS.md") },
    { target: "geminicli", outputPath: join(".gemini", "GEMINI.md") },
    { target: "antigravity-ide", outputPath: join(".gemini", "GEMINI.md") },
    { target: "antigravity-cli", outputPath: join(".gemini", "GEMINI.md") },
    { target: "goose", outputPath: join(".config", "goose", ".goosehints") },
    { target: "copilotcli", outputPath: join(".copilot", "copilot-instructions.md") },
    { target: "deepagents", outputPath: join(".deepagents", "deepagents", "AGENTS.md") },
    { target: "factorydroid", outputPath: join(".factory", "AGENTS.md") },
    { target: "kilo", outputPath: join(".config", "kilo", "AGENTS.md") },
    { target: "rovodev", outputPath: join(".rovodev", "AGENTS.md") },
    { target: "takt", outputPath: join(".takt", "facets", "policies", "overview.md") },
    { target: "pi", outputPath: join(".pi", "agent", "AGENTS.md") },
    { target: "zed", outputPath: join(".config", "zed", "AGENTS.md") },
    { target: "vibe", outputPath: join(".vibe", "AGENTS.md") },
    { target: "augmentcode", outputPath: join(".augment", "rules", "overview.md") },
    {
      target: "devin",
      outputPath: join(".codeium", "windsurf", "memories", "global_rules.md"),
    },
    { target: "junie", outputPath: join(".junie", "AGENTS.md") },
    { target: "qwencode", outputPath: join(".qwen", "QWEN.md") },
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

  it("should generate qwencode non-root rules into ~/.qwen/rules in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

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
description: "Global coding guidelines"
globs: ["src/**/*.ts"]
---

# Global Non-Root Rule
`;
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      rootRuleContent,
    );
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
      nonRootRuleContent,
    );

    await runGenerate({
      target: "qwencode",
      features: "rules",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Root memory file -> ~/.qwen/QWEN.md
    const rootContent = await readFileContent(join(homeDir, ".qwen", "QWEN.md"));
    expect(rootContent).toContain("Root Rule Content");

    // Non-root rule -> ~/.qwen/rules/*.md with `paths` frontmatter
    const nonRootContent = await readFileContent(
      join(homeDir, ".qwen", "rules", "coding-guidelines.md"),
    );
    expect(nonRootContent).toContain("Global Non-Root Rule");
    expect(nonRootContent).toContain("src/**/*.ts");
  });

  it("should generate roo non-root rules into ~/.roo/rules in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Roo has no root memory file; every rule is a non-root file under the
    // rules directory. In global mode that directory resolves to ~/.roo/rules/.
    const nonRootRuleContent = `---
targets: ["*"]
description: "Global coding guidelines"
globs: ["src/**/*"]
---

# Global Roo Rule
`;
    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "coding-guidelines.md"),
      nonRootRuleContent,
    );

    await runGenerate({
      target: "roo",
      features: "rules",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Non-root rule -> ~/.roo/rules/*.md (plain Markdown, Roo reads no frontmatter)
    const nonRootContent = await readFileContent(
      join(homeDir, ".roo", "rules", "coding-guidelines.md"),
    );
    expect(nonRootContent).toContain("Global Roo Rule");
  });
});
