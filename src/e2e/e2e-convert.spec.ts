import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

const execFileAsync = promisify(execFile);

async function runConvert({
  from,
  to,
  features,
}: {
  from: string;
  to: string;
  features?: string;
}): Promise<{ stdout: string; stderr: string }> {
  const args = [
    ...rulesyncArgs,
    "convert",
    "--from",
    from,
    "--to",
    to,
    ...(features ? ["--features", features] : []),
  ];
  return execFileAsync(rulesyncCmd, args);
}

describe("E2E: convert", () => {
  const { getTestDir } = useTestDirectory();

  it("should convert rules from cursor to claudecode without writing .rulesync files", async () => {
    const testDir = getTestDir();

    // Setup: a cursor rule file
    const cursorRule = `---
description: Test rule
globs: "**/*"
alwaysApply: true
---

# Overview

This is a cursor rule for convert e2e testing.
`;
    await writeFileContent(join(testDir, ".cursor", "rules", "overview.mdc"), cursorRule);

    // Execute: convert from cursor to claudecode
    await runConvert({ from: "cursor", to: "claudecode", features: "rules" });

    // Verify: Claude output was produced (cursor produces non-root rules, so
    // claudecode writes into .claude/rules/)
    const claudeContent = await readFileContent(join(testDir, ".claude", "rules", "overview.md"));
    expect(claudeContent).toContain("convert e2e testing");

    // Verify: no .rulesync/rules/ files created by convert
    const rulesyncRuleExists = await fileExists(join(testDir, ".rulesync", "rules", "overview.md"));
    expect(rulesyncRuleExists).toBe(false);
  });

  it("should convert mcp from claudecode to cursor without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const mcpContent = JSON.stringify(
      {
        mcpServers: {
          "test-server": {
            type: "stdio",
            command: "echo",
            args: ["hello"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".mcp.json"), mcpContent);

    await runConvert({ from: "claudecode", to: "cursor", features: "mcp" });

    const cursorMcp = await readFileContent(join(testDir, ".cursor", "mcp.json"));
    expect(cursorMcp).toContain("test-server");

    const rulesyncMcpExists = await fileExists(join(testDir, ".rulesync", "mcp.json"));
    expect(rulesyncMcpExists).toBe(false);
  });

  it("should convert rules to multiple destinations in one invocation", async () => {
    const testDir = getTestDir();

    const cursorRule = `---
description: Multi destination rule
globs: "**/*"
alwaysApply: true
---

# Multi

This rule is converted to multiple tools.
`;
    await writeFileContent(join(testDir, ".cursor", "rules", "overview.mdc"), cursorRule);

    await runConvert({ from: "cursor", to: "claudecode,copilot", features: "rules" });

    const claudeContent = await readFileContent(join(testDir, ".claude", "rules", "overview.md"));
    expect(claudeContent).toContain("converted to multiple tools");

    // Copilot writes non-root rules under .github/instructions/
    const copilotContent = await readFileContent(
      join(testDir, ".github", "instructions", "overview.instructions.md"),
    );
    expect(copilotContent).toContain("converted to multiple tools");
  });

  it("should convert commands from claudecode to cursor without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const commandContent = `Review the PR diff and provide feedback.`;
    await writeFileContent(join(testDir, ".claude", "commands", "review-pr.md"), commandContent);

    await runConvert({ from: "claudecode", to: "cursor", features: "commands" });

    const cursorContent = await readFileContent(
      join(testDir, ".cursor", "commands", "review-pr.md"),
    );
    expect(cursorContent).toContain("Review the PR diff and provide feedback.");

    const rulesyncExists = await fileExists(join(testDir, ".rulesync", "commands", "review-pr.md"));
    expect(rulesyncExists).toBe(false);
  });

  it("should convert subagents from claudecode to cursor without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const subagentContent = `---
name: planner
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;
    await writeFileContent(join(testDir, ".claude", "agents", "planner.md"), subagentContent);

    await runConvert({ from: "claudecode", to: "cursor", features: "subagents" });

    const cursorContent = await readFileContent(join(testDir, ".cursor", "agents", "planner.md"));
    expect(cursorContent).toContain("Analyze files and create a plan.");

    const rulesyncExists = await fileExists(join(testDir, ".rulesync", "subagents", "planner.md"));
    expect(rulesyncExists).toBe(false);
  });

  it("should convert skills from claudecode to cursor without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const skillContent = `---
name: test-skill
description: "A test skill for E2E convert testing"
---
This is the test skill body content.`;
    await writeFileContent(
      join(testDir, ".claude", "skills", "test-skill", "SKILL.md"),
      skillContent,
    );

    await runConvert({ from: "claudecode", to: "cursor", features: "skills" });

    const cursorContent = await readFileContent(
      join(testDir, ".cursor", "skills", "test-skill", "SKILL.md"),
    );
    expect(cursorContent).toContain("test skill body content");

    const rulesyncExists = await fileExists(
      join(testDir, ".rulesync", "skills", "test-skill", "SKILL.md"),
    );
    expect(rulesyncExists).toBe(false);
  });

  it("should convert hooks from claudecode to cursor without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const hooksContent = JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
            },
          ],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".claude", "settings.json"), hooksContent);

    await runConvert({ from: "claudecode", to: "cursor", features: "hooks" });

    const cursorContent = await readFileContent(join(testDir, ".cursor", "hooks.json"));
    const parsed = JSON.parse(cursorContent);
    expect(parsed.hooks).toBeDefined();
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");

    const rulesyncExists = await fileExists(join(testDir, ".rulesync", "hooks.json"));
    expect(rulesyncExists).toBe(false);
  });

  it("should convert permissions from opencode to claudecode without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const opencodeContent = JSON.stringify(
      {
        permission: {
          bash: { "git status *": "allow", "rm -rf *": "deny" },
          read: { ".env": "deny" },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, "opencode.json"), opencodeContent);

    await runConvert({ from: "opencode", to: "claudecode", features: "permissions" });

    const claudeContent = await readFileContent(join(testDir, ".claude", "settings.json"));
    const parsed = JSON.parse(claudeContent);
    expect(parsed.permissions.allow).toEqual(expect.arrayContaining(["Bash(git status *)"]));
    expect(parsed.permissions.deny).toEqual(
      expect.arrayContaining([expect.stringContaining(".env")]),
    );

    const rulesyncExists = await fileExists(join(testDir, ".rulesync", "permissions.json"));
    expect(rulesyncExists).toBe(false);
  });

  it("should convert ignore from cursor to geminicli without writing .rulesync files", async () => {
    const testDir = getTestDir();

    const ignoreContent = `tmp/
credentials/
*.secret
`;
    await writeFileContent(join(testDir, ".cursorignore"), ignoreContent);

    await runConvert({ from: "cursor", to: "geminicli", features: "ignore" });

    const geminiContent = await readFileContent(join(testDir, ".geminiignore"));
    expect(geminiContent).toContain("tmp/");
    expect(geminiContent).toContain("credentials/");

    const rulesyncExists = await fileExists(join(testDir, ".rulesync", ".aiignore"));
    expect(rulesyncExists).toBe(false);
  });
});
