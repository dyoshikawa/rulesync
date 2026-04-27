import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
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

  // Tool × Feature happy-path coverage with --input-root: one tool per
  // feature is sufficient per CLAUDE.md (the matrix is preserved by the
  // per-feature suites; here we only verify --input-root threads through
  // each feature's processor correctly).

  it("should read commands from --input-root and write claudecode output to cwd", async () => {
    const commandContent = `---
description: "Review a pull request"
targets: ["*"]
---
Check the PR diff and provide feedback.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      commandContent,
    );

    await runGenerate({ target: "claudecode", features: "commands", inputRoot: sourceDir });

    const outputPath = join(".claude", "commands", "review-pr.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("Check the PR diff and provide feedback.");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read mcp from --input-root and write claudecode output to cwd", async () => {
    const mcpContent = JSON.stringify(
      {
        mcpServers: {
          "input-root-server": {
            type: "stdio",
            command: "echo",
            args: ["hi"],
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(sourceDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    await runGenerate({ target: "claudecode", features: "mcp", inputRoot: sourceDir });

    const outputPath = ".mcp.json";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("input-root-server");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read ignore from --input-root and write cursor output to cwd", async () => {
    const ignoreContent = `tmp/
secrets/
*.env
`;
    await writeFileContent(join(sourceDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), ignoreContent);

    await runGenerate({ target: "cursor", features: "ignore", inputRoot: sourceDir });

    const outputPath = ".cursorignore";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("tmp/");
    expect(generatedContent).toContain("secrets/");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read hooks from --input-root and write claudecode output to cwd", async () => {
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(sourceDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "claudecode", features: "hooks", inputRoot: sourceDir });

    const outputPath = join(".claude", "settings.json");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    const parsed = JSON.parse(generatedContent);
    expect(parsed.hooks).toBeDefined();
    expect(parsed.hooks.SessionStart).toBeDefined();
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read permissions from --input-root and write opencode output to cwd", async () => {
    const permissionsContent = JSON.stringify(
      {
        permission: {
          bash: { "git *": "allow", "rm -rf": "deny" },
        },
      },
      null,
      2,
    );
    await writeFileContent(
      join(sourceDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      permissionsContent,
    );

    await runGenerate({ target: "opencode", features: "permissions", inputRoot: sourceDir });

    const outputPath = "opencode.jsonc";
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    const parsed = JSON.parse(generatedContent);
    expect(parsed.permission.bash["git *"]).toBe("allow");
    expect(parsed.permission.bash["rm -rf"]).toBe("deny");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read subagents from --input-root and write claudecode output to cwd", async () => {
    const subagentContent = `---
name: planner
targets: ["*"]
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      subagentContent,
    );

    await runGenerate({ target: "claudecode", features: "subagents", inputRoot: sourceDir });

    const outputPath = join(".claude", "agents", "planner.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("You are the planner");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });

  it("should read skills from --input-root and write claudecode output to cwd", async () => {
    const skillContent = `---
name: test-skill
description: "An input-root test skill"
targets: ["*"]
---
Body content for the input-root skill.
`;
    await writeFileContent(
      join(sourceDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill", "SKILL.md"),
      skillContent,
    );

    await runGenerate({ target: "claudecode", features: "skills", inputRoot: sourceDir });

    const outputPath = join(".claude", "skills", "test-skill", "SKILL.md");
    const generatedContent = await readFileContent(join(outputDir, outputPath));
    expect(generatedContent).toContain("Body content for the input-root skill.");
    expect(await fileExists(join(sourceDir, outputPath))).toBe(false);
  });
});
