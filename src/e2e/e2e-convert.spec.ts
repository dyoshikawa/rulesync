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
  env,
}: {
  from: string;
  to: string;
  features?: string;
  env?: Record<string, string>;
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
  return execFileAsync(rulesyncCmd, args, env ? { env: { ...process.env, ...env } } : {});
}

type ConvertScenario = {
  feature: string;
  from: string;
  to: string;
  setup: (testDir: string) => Promise<void>;
  verify: (testDir: string) => Promise<void>;
};

const cursorRule = `---
description: Test rule
globs: "**/*"
alwaysApply: true
---

# Overview

This is a rule for convert e2e testing.
`;

const mcpContent = JSON.stringify(
  {
    mcpServers: {
      "test-server": { type: "stdio", command: "echo", args: ["hello"], env: {} },
    },
  },
  null,
  2,
);

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

const opencodePermissions = JSON.stringify(
  {
    permission: {
      bash: { "git status *": "allow", "rm -rf *": "deny" },
      read: { ".env": "deny" },
    },
  },
  null,
  2,
);

const subagentBody = `---
name: planner
description: "Plans implementation tasks"
---
You are the planner. Analyze files and create a plan.
`;

const skillBody = `---
name: test-skill
description: "A test skill for E2E convert testing"
---
This is the test skill body content.`;

const scenarios: ConvertScenario[] = [
  // --- rules: multiple source tools to exercise different parsers ---
  {
    feature: "rules",
    from: "cursor",
    to: "claudecode",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".cursor", "rules", "overview.mdc"), cursorRule);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".claude", "rules", "overview.md"));
      expect(content).toContain("convert e2e testing");
    },
  },
  {
    feature: "rules",
    from: "copilot",
    to: "claudecode",
    setup: async (dir) => {
      await writeFileContent(
        join(dir, ".github", "instructions", "overview.instructions.md"),
        `---\napplyTo: "**/*"\n---\n\n# Overview\n\nThis is a rule for convert e2e testing.\n`,
      );
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".claude", "rules", "overview.md"));
      expect(content).toContain("convert e2e testing");
    },
  },

  // --- mcp ---
  {
    feature: "mcp",
    from: "claudecode",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".mcp.json"), mcpContent);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".cursor", "mcp.json"));
      expect(content).toContain("test-server");
    },
  },
  {
    feature: "mcp",
    from: "cursor",
    to: "claudecode",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".cursor", "mcp.json"), mcpContent);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".mcp.json"));
      expect(content).toContain("test-server");
    },
  },

  // --- commands ---
  {
    feature: "commands",
    from: "claudecode",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(
        join(dir, ".claude", "commands", "review-pr.md"),
        "Review the PR diff and provide feedback.",
      );
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".cursor", "commands", "review-pr.md"));
      expect(content).toContain("Review the PR diff and provide feedback.");
    },
  },
  {
    feature: "commands",
    from: "cursor",
    to: "claudecode",
    setup: async (dir) => {
      await writeFileContent(
        join(dir, ".cursor", "commands", "review-pr.md"),
        "Review the PR diff and provide feedback.",
      );
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".claude", "commands", "review-pr.md"));
      expect(content).toContain("Review the PR diff and provide feedback.");
    },
  },

  // --- subagents ---
  {
    feature: "subagents",
    from: "claudecode",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".claude", "agents", "planner.md"), subagentBody);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".cursor", "agents", "planner.md"));
      expect(content).toContain("Analyze files and create a plan.");
    },
  },

  // --- skills ---
  {
    feature: "skills",
    from: "claudecode",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".claude", "skills", "test-skill", "SKILL.md"), skillBody);
    },
    verify: async (dir) => {
      const content = await readFileContent(
        join(dir, ".cursor", "skills", "test-skill", "SKILL.md"),
      );
      expect(content).toContain("test skill body content");
    },
  },

  // --- hooks ---
  {
    feature: "hooks",
    from: "claudecode",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".claude", "settings.json"), hooksContent);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".cursor", "hooks.json"));
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
    },
  },

  // --- permissions ---
  {
    feature: "permissions",
    from: "opencode",
    to: "claudecode",
    setup: async (dir) => {
      await writeFileContent(join(dir, "opencode.json"), opencodePermissions);
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".claude", "settings.json"));
      const parsed = JSON.parse(content);
      expect(parsed.permissions.allow).toEqual(expect.arrayContaining(["Bash(git status *)"]));
      expect(parsed.permissions.deny).toEqual(
        expect.arrayContaining([expect.stringContaining(".env")]),
      );
    },
  },

  // --- ignore ---
  {
    feature: "ignore",
    from: "cursor",
    to: "geminicli",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".cursorignore"), "tmp/\ncredentials/\n*.secret\n");
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".geminiignore"));
      expect(content).toContain("tmp/");
      expect(content).toContain("credentials/");
    },
  },
  {
    feature: "ignore",
    from: "roo",
    to: "cursor",
    setup: async (dir) => {
      await writeFileContent(join(dir, ".rooignore"), "tmp/\ncredentials/\n*.secret\n");
    },
    verify: async (dir) => {
      const content = await readFileContent(join(dir, ".cursorignore"));
      expect(content).toContain("tmp/");
      expect(content).toContain("credentials/");
    },
  },
];

describe("E2E: convert", () => {
  const { getTestDir } = useTestDirectory();

  it.each(scenarios)(
    "should convert $feature from $from to $to without writing .rulesync files",
    async ({ feature, from, to, setup, verify }) => {
      const testDir = getTestDir();

      await setup(testDir);
      await runConvert({ from, to, features: feature });
      await verify(testDir);

      // The key invariant this command sells: nothing is persisted to
      // `.rulesync/` — rulesync file instances live in memory only.
      const rulesyncDirExists = await fileExists(join(testDir, ".rulesync"));
      expect(rulesyncDirExists).toBe(false);
    },
  );

  it("should convert rules to multiple destinations in one invocation", async () => {
    const testDir = getTestDir();

    const multiRule = `---
description: Multi destination rule
globs: "**/*"
alwaysApply: true
---

# Multi

This rule is converted to multiple tools.
`;
    await writeFileContent(join(testDir, ".cursor", "rules", "overview.mdc"), multiRule);

    await runConvert({ from: "cursor", to: "claudecode,copilot", features: "rules" });

    const claudeContent = await readFileContent(join(testDir, ".claude", "rules", "overview.md"));
    expect(claudeContent).toContain("converted to multiple tools");

    const copilotContent = await readFileContent(
      join(testDir, ".github", "instructions", "overview.instructions.md"),
    );
    expect(copilotContent).toContain("converted to multiple tools");

    const rulesyncDirExists = await fileExists(join(testDir, ".rulesync"));
    expect(rulesyncDirExists).toBe(false);
  });

  it("should fail when --to contains the source tool", async () => {
    const testDir = getTestDir();
    await writeFileContent(join(testDir, ".cursor", "rules", "overview.mdc"), cursorRule);

    await expect(
      runConvert({
        from: "cursor",
        to: "claudecode,cursor",
        features: "rules",
        env: { NODE_ENV: "e2e" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("must not include the source tool"),
    });
  });
});
