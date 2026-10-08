import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import {
  ensureDir,
  fileExists,
  removeDirectory,
  removeFile,
  readFileContent,
  writeFileContent,
} from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: plugin targets", () => {
  const { getTestDir } = useTestDirectory();

  it("generates and imports a Claude Code plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review");

    await writeFileContent(
      join(rulesyncSkillDir, "SKILL.md"),
      `---
name: review
description: Review code changes
targets: ["claudecode-plugin"]
---
Review the current changes.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "project-only", "SKILL.md"),
      `---
name: project-only
description: Project-only skill
targets: ["claudecode"]
---
Do not package this skill.
`,
    );
    await writeFileContent(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );
    await writeFileContent(join(pluginRoot, "scripts", "check.sh"), "#!/bin/sh\n");

    await runGenerate({
      target: "claudecode-plugin",
      features: "skills",
      outputRoots: pluginRoot,
    });

    const generatedSkill = join(pluginRoot, "skills", "review", "SKILL.md");
    expect(await readFileContent(generatedSkill)).toContain("Review the current changes.");
    expect(await fileExists(join(pluginRoot, "skills", "project-only", "SKILL.md"))).toBe(false);
    expect(await fileExists(join(pluginRoot, "scripts", "check.sh"))).toBe(true);

    await removeDirectory(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));

    await runImport({
      target: "claudecode-plugin",
      features: "skills",
      outputRoot: pluginRoot,
    });

    expect(await readFileContent(join(rulesyncSkillDir, "SKILL.md"))).toContain(
      "Review the current changes.",
    );
    expect(await fileExists(join(pluginRoot, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(await fileExists(join(pluginRoot, "scripts", "check.sh"))).toBe(true);
  });

  it("generates and imports an Antigravity plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "review.md");

    await writeFileContent(
      rulesyncRulePath,
      `---
targets: ["antigravity-plugin"]
description: Review conventions
---
Review changes before submission.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "ide-only.md"),
      `---
targets: ["antigravity-ide"]
description: IDE-only conventions
---
Do not package this rule.
`,
    );
    const manifestContent = JSON.stringify(
      { name: "review-plugin", description: "Hand-authored description" },
      null,
      2,
    );
    await writeFileContent(join(pluginRoot, "plugin.json"), manifestContent);
    await writeFileContent(join(pluginRoot, "assets", "icon.txt"), "plugin icon\n");

    await runGenerate({
      target: "antigravity-plugin",
      features: "rules",
      outputRoots: pluginRoot,
    });

    const generatedRule = join(pluginRoot, "rules", "review.md");
    expect(await readFileContent(generatedRule)).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "rules", "ide-only.md"))).toBe(false);
    expect(await fileExists(join(pluginRoot, "assets", "icon.txt"))).toBe(true);
    expect(await readFileContent(join(pluginRoot, "plugin.json"))).toBe(manifestContent);

    await removeDirectory(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));

    await runImport({
      target: "antigravity-plugin",
      features: "rules",
      outputRoot: pluginRoot,
    });

    expect(await readFileContent(rulesyncRulePath)).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(true);
    expect(await fileExists(join(pluginRoot, "assets", "icon.txt"))).toBe(true);
  });

  it("creates the Antigravity plugin manifest when the plugin root has none", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review_plugin-2");

    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "review.md"),
      `---
targets: ["antigravity-plugin"]
description: Review conventions
---
Review changes before submission.
`,
    );
    await ensureDir(pluginRoot);

    await runGenerate({
      target: "antigravity-plugin",
      features: "rules",
      outputRoots: pluginRoot,
      dryRun: true,
    });
    expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(false);

    await runGenerate({
      target: "antigravity-plugin",
      features: "rules",
      outputRoots: pluginRoot,
      deleteFiles: true,
    });

    expect(JSON.parse(await readFileContent(join(pluginRoot, "plugin.json")))).toEqual({
      name: "review_plugin-2",
    });
    expect(await readFileContent(join(pluginRoot, "rules", "review.md"))).toContain(
      "Review changes before submission.",
    );

    // A second run finds the manifest it wrote and keeps it, so it is up to date.
    await runGenerate({
      target: "antigravity-plugin",
      features: "rules",
      outputRoots: pluginRoot,
      deleteFiles: true,
      check: true,
    });
    expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(true);
  });

  it("generates and imports an AugmentCode plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "review.md");

    await writeFileContent(
      rulesyncRulePath,
      `---
targets: ["augmentcode-plugin"]
description: Review conventions
augmentcode:
  type: agent_requested
---
Review changes before submission.
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "project-only.md"),
      `---
targets: ["augmentcode"]
description: Project-only conventions
---
Do not package this rule.
`,
    );
    await writeFileContent(
      join(pluginRoot, ".augment-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );
    await writeFileContent(join(pluginRoot, "hooks", "hooks.json"), '{"hooks":{}}\n');
    const rulesyncCommandPath = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md");
    await writeFileContent(
      rulesyncCommandPath,
      `---
targets: ["augmentcode-plugin"]
description: Review the changes
augmentcode:
  model: sonnet
  argument-hint: "<branch>"
---
Review the current branch.
`,
    );
    const rulesyncSubagentPath = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md");
    await writeFileContent(
      rulesyncSubagentPath,
      `---
targets: ["augmentcode-plugin"]
name: reviewer
description: Reviews code
augmentcode:
  model: sonnet
  tools: ["view"]
  color: blue
---
Review the changes.
`,
    );

    await runGenerate({
      target: "augmentcode-plugin",
      features: "rules,commands,subagents",
      outputRoots: pluginRoot,
    });

    const generatedRule = await readFileContent(join(pluginRoot, "rules", "review.md"));
    expect(generatedRule).toContain("type: agent_requested");
    expect(generatedRule).toContain("Review changes before submission.");
    expect(await fileExists(join(pluginRoot, "rules", "project-only.md"))).toBe(false);
    expect(await fileExists(join(testDir, ".augment", "rules", "review.md"))).toBe(false);

    const generatedCommand = await readFileContent(join(pluginRoot, "commands", "review.md"));
    expect(generatedCommand).toContain("model: sonnet");
    expect(generatedCommand).not.toContain("argument-hint");
    const generatedSubagent = await readFileContent(join(pluginRoot, "agents", "reviewer.md"));
    expect(generatedSubagent).toContain("description: Reviews code");
    expect(generatedSubagent).not.toContain("tools:");
    expect(generatedSubagent).not.toContain("color:");

    for (const dir of [
      RULESYNC_RULES_RELATIVE_DIR_PATH,
      RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    ]) {
      await removeDirectory(join(testDir, dir));
      await ensureDir(join(testDir, dir));
    }

    await runImport({
      target: "augmentcode-plugin",
      features: "rules,commands,subagents",
      outputRoot: pluginRoot,
    });

    const imported = await readFileContent(rulesyncRulePath);
    expect(imported).toContain("Review changes before submission.");
    expect(imported).toContain("type: agent_requested");
    const importedCommand = await readFileContent(rulesyncCommandPath);
    expect(importedCommand).toContain("Review the current branch.");
    expect(importedCommand).not.toContain("argument-hint");
    const importedSubagent = await readFileContent(rulesyncSubagentPath);
    expect(importedSubagent).toContain("Review the changes.");
    expect(importedSubagent).not.toContain("tools:");
    expect(await fileExists(join(pluginRoot, ".augment-plugin", "plugin.json"))).toBe(true);
    expect(await readFileContent(join(pluginRoot, "hooks", "hooks.json"))).toBe('{"hooks":{}}\n');
  });

  it("generates and imports a ZCode plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncSubagentPath = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md");
    const rulesyncMcpPath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
    const rulesyncHooksPath = join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH);

    await writeFileContent(
      rulesyncSubagentPath,
      `---
targets: ["zcode-plugin"]
name: reviewer
description: Reviews code
zcode:
  permissionMode: plan
---
Review the changes.
`,
    );
    await writeFileContent(
      rulesyncMcpPath,
      JSON.stringify({
        mcpServers: { docs: { command: "npx", args: ["-y", "docs-server"], disabled: true } },
      }),
    );
    await writeFileContent(
      rulesyncHooksPath,
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ type: "command", command: "./scripts/setup.sh" }] },
      }),
    );
    await writeFileContent(
      join(pluginRoot, ".zcode-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin" }, null, 2),
    );

    await runGenerate({
      target: "zcode-plugin",
      features: "subagents,mcp,hooks",
      outputRoots: pluginRoot,
    });

    // Plugin agents keep `permissionMode`, unlike project `.zcode/agents/`.
    const generatedSubagent = await readFileContent(join(pluginRoot, "agents", "reviewer.md"));
    expect(generatedSubagent).toContain("permissionMode: plan");
    expect(JSON.parse(await readFileContent(join(pluginRoot, ".mcp.json")))).toEqual({
      mcpServers: { docs: { command: "npx", args: ["-y", "docs-server"], enabled: false } },
    });
    expect(JSON.parse(await readFileContent(join(pluginRoot, "hooks", "hooks.json")))).toEqual({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: '"$ZCODE_PLUGIN_ROOT"/scripts/setup.sh' }] },
        ],
      },
    });
    expect(await fileExists(join(testDir, ".zcode", "config.json"))).toBe(false);

    await removeDirectory(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await removeFile(rulesyncMcpPath);
    await removeFile(rulesyncHooksPath);

    await runImport({
      target: "zcode-plugin",
      features: "subagents,mcp,hooks",
      outputRoot: pluginRoot,
    });

    const importedSubagent = await readFileContent(rulesyncSubagentPath);
    expect(importedSubagent).toContain("permissionMode: plan");
    expect(importedSubagent).toContain("Review the changes.");
    expect(JSON.parse(await readFileContent(rulesyncMcpPath)).mcpServers).toEqual({
      docs: { command: "npx", args: ["-y", "docs-server"], disabled: true },
    });
    expect(JSON.parse(await readFileContent(rulesyncHooksPath)).hooks).toEqual({
      sessionStart: [{ type: "command", command: "./scripts/setup.sh" }],
    });
    expect(await fileExists(join(pluginRoot, ".zcode-plugin", "plugin.json"))).toBe(true);
  });

  it("generates and imports a Vibe plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncSubagentPath = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md");
    const rulesyncMcpPath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
    const rulesyncHooksPath = join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH);

    await writeFileContent(
      rulesyncSubagentPath,
      `---
targets: ["vibe-plugin"]
name: reviewer
description: Reviews code
vibe:
  safety: safe
---
Review the changes.
`,
    );
    await writeFileContent(
      rulesyncMcpPath,
      JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["-y", "docs-server"] } } }),
    );
    await writeFileContent(
      rulesyncHooksPath,
      JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ command: "./scripts/audit.sh", matcher: "bash" }] },
      }),
    );
    await writeFileContent(
      join(pluginRoot, "plugin.json"),
      JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          name: "review-plugin",
          extensions: { "ai.mistral.vibe": { schemaVersion: 1 } },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "vibe-plugin",
      features: "subagents,mcp,hooks",
      outputRoots: pluginRoot,
    });

    // Plugin agents carry the prompt inline as `instructions`.
    const generatedSubagent = await readFileContent(
      join(pluginRoot, "ai.mistral.vibe", "agents", "reviewer.toml"),
    );
    expect(generatedSubagent).toContain('agent_type = "subagent"');
    expect(generatedSubagent).toContain('safety = "safe"');
    expect(generatedSubagent).toContain("Review the changes.");
    expect(JSON.parse(await readFileContent(join(pluginRoot, "mcp.json")))).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { docs: { type: "stdio", command: "npx", args: ["-y", "docs-server"] } },
    });
    const generatedHooks = await readFileContent(join(pluginRoot, "ai.mistral.vibe", "hooks.toml"));
    expect(generatedHooks).toContain('type = "pre_tool"');
    expect(generatedHooks).toContain('command = "./scripts/audit.sh"');
    expect(await fileExists(join(testDir, ".vibe", "config.toml"))).toBe(false);

    await removeDirectory(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await removeFile(rulesyncMcpPath);
    await removeFile(rulesyncHooksPath);

    await runImport({
      target: "vibe-plugin",
      features: "subagents,mcp,hooks",
      outputRoot: pluginRoot,
    });

    const importedSubagent = await readFileContent(rulesyncSubagentPath);
    expect(importedSubagent).toContain("safety: safe");
    expect(importedSubagent).toContain("Review the changes.");
    expect(JSON.parse(await readFileContent(rulesyncMcpPath)).mcpServers).toEqual({
      docs: { command: "npx", args: ["-y", "docs-server"] },
    });
    expect(JSON.parse(await readFileContent(rulesyncHooksPath)).hooks.preToolUse).toEqual([
      expect.objectContaining({ command: "./scripts/audit.sh", matcher: "bash" }),
    ]);
    expect(await fileExists(join(pluginRoot, "plugin.json"))).toBe(true);
  });

  it("generates and imports a Devin plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
    const rulesyncSubagentPath = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md");
    const rulesyncSkillPath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "review",
      "SKILL.md",
    );
    const rulesyncMcpPath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
    const rulesyncHooksPath = join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH);

    await writeFileContent(
      join(rulesyncRulesDir, "overview.md"),
      `---
root: true
targets: ["devin-plugin"]
---
Always follow the review checklist.
`,
    );
    await writeFileContent(
      join(rulesyncRulesDir, "typescript.md"),
      `---
targets: ["devin-plugin"]
globs: ["**/*.ts"]
---
Prefer strict TypeScript.
`,
    );
    await writeFileContent(
      rulesyncSubagentPath,
      `---
targets: ["devin-plugin"]
name: reviewer
description: Reviews code
---
Review the changes.
`,
    );
    await writeFileContent(
      rulesyncSkillPath,
      `---
name: review
description: Review code changes
targets: ["devin-plugin"]
---
Review the current changes.
`,
    );
    await writeFileContent(
      rulesyncMcpPath,
      JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["-y", "docs-server"] } } }),
    );
    await writeFileContent(
      rulesyncHooksPath,
      JSON.stringify({
        version: 1,
        hooks: { preToolUse: [{ command: "./scripts/audit.sh", matcher: "exec" }] },
      }),
    );
    await writeFileContent(
      join(pluginRoot, ".devin-plugin", "plugin.json"),
      JSON.stringify({ name: "review-plugin", version: "1.0.0" }, null, 2),
    );

    await runGenerate({
      target: "devin-plugin",
      features: "rules,subagents,skills,mcp,hooks",
      outputRoots: pluginRoot,
    });

    expect(await readFileContent(join(pluginRoot, "AGENTS.md"))).toContain(
      "Always follow the review checklist.",
    );
    const generatedRule = await readFileContent(join(pluginRoot, "rules", "typescript.md"));
    expect(generatedRule).toContain("trigger: glob");
    expect(generatedRule).toContain("Prefer strict TypeScript.");
    expect(await readFileContent(join(pluginRoot, "agents", "reviewer", "AGENT.md"))).toContain(
      "Review the changes.",
    );
    expect(await readFileContent(join(pluginRoot, "skills", "review", "SKILL.md"))).toContain(
      "Review the current changes.",
    );
    expect(JSON.parse(await readFileContent(join(pluginRoot, ".mcp.json")))).toEqual({
      mcpServers: { docs: { command: "npx", args: ["-y", "docs-server"] } },
    });
    expect(JSON.parse(await readFileContent(join(pluginRoot, "hooks.json")))).toEqual({
      PreToolUse: [
        { matcher: "exec", hooks: [{ type: "command", command: "./scripts/audit.sh" }] },
      ],
    });
    expect(await fileExists(join(testDir, ".devin"))).toBe(false);

    await removeDirectory(rulesyncRulesDir);
    await ensureDir(rulesyncRulesDir);
    await removeDirectory(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await removeDirectory(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));
    await removeFile(rulesyncMcpPath);
    await removeFile(rulesyncHooksPath);

    await runImport({
      target: "devin-plugin",
      features: "rules,subagents,skills,mcp,hooks",
      outputRoot: pluginRoot,
    });

    expect(await readFileContent(join(rulesyncRulesDir, "typescript.md"))).toContain(
      "Prefer strict TypeScript.",
    );
    expect(await readFileContent(rulesyncSubagentPath)).toContain("Review the changes.");
    expect(await readFileContent(rulesyncSkillPath)).toContain("Review the current changes.");
    expect(JSON.parse(await readFileContent(rulesyncMcpPath)).mcpServers).toEqual({
      docs: { command: "npx", args: ["-y", "docs-server"] },
    });
    expect(JSON.parse(await readFileContent(rulesyncHooksPath)).hooks.preToolUse).toEqual([
      expect.objectContaining({ command: "./scripts/audit.sh", matcher: "exec" }),
    ]);
    expect(await fileExists(join(pluginRoot, ".devin-plugin", "plugin.json"))).toBe(true);
  });

  it("generates and imports a Kimi Code plugin from an explicit plugin root", async () => {
    const testDir = getTestDir();
    const pluginRoot = join(testDir, "packages", "review-plugin");
    const rulesyncRulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
    const rulesyncCommandPath = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md");
    const rulesyncSubagentPath = join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md");
    const rulesyncSkillPath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "review",
      "SKILL.md",
    );
    const manifest = {
      name: "review-plugin",
      skills: "./skills/",
      commands: "./commands/",
      systemPromptPath: "./SYSTEM.md",
    };

    await writeFileContent(
      join(rulesyncRulesDir, "overview.md"),
      `---
root: true
targets: ["kimi-code-plugin"]
---
Always follow the review checklist.
`,
    );
    await writeFileContent(
      join(rulesyncRulesDir, "typescript.md"),
      `---
targets: ["kimi-code-plugin"]
globs: ["**/*.ts"]
---
Prefer strict TypeScript.
`,
    );
    await writeFileContent(
      rulesyncCommandPath,
      `---
targets: ["kimi-code-plugin"]
description: Review a pull request
---
Review pull request $ARGUMENTS.
`,
    );
    await writeFileContent(
      rulesyncSubagentPath,
      `---
targets: ["kimi-code-plugin"]
name: reviewer
description: Reviews code
---
Review the changes.
`,
    );
    await writeFileContent(
      rulesyncSkillPath,
      `---
name: review
description: Review code changes
targets: ["kimi-code-plugin"]
---
Review the current changes.
`,
    );
    await writeFileContent(join(pluginRoot, "kimi.plugin.json"), JSON.stringify(manifest, null, 2));

    await runGenerate({
      target: "kimi-code-plugin",
      features: "rules,commands,subagents,skills",
      outputRoots: pluginRoot,
    });

    const systemPrompt = await readFileContent(join(pluginRoot, "SYSTEM.md"));
    expect(systemPrompt).toContain("Always follow the review checklist.");
    expect(systemPrompt).toContain("Prefer strict TypeScript.");
    const command = await readFileContent(join(pluginRoot, "commands", "review.md"));
    expect(command).toContain("description: Review a pull request");
    expect(command).toContain("Review pull request $ARGUMENTS.");
    expect(await readFileContent(join(pluginRoot, "agents", "reviewer.md"))).toContain(
      "Review the changes.",
    );
    expect(await readFileContent(join(pluginRoot, "skills", "review", "SKILL.md"))).toContain(
      "Review the current changes.",
    );
    expect(await fileExists(join(testDir, ".kimi-code"))).toBe(false);
    expect(JSON.parse(await readFileContent(join(pluginRoot, "kimi.plugin.json")))).toEqual(
      manifest,
    );

    await removeDirectory(rulesyncRulesDir);
    await ensureDir(rulesyncRulesDir);
    await removeDirectory(join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH));
    await removeDirectory(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
    await removeDirectory(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));
    await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH));

    await runImport({
      target: "kimi-code-plugin",
      features: "rules,commands,subagents,skills",
      outputRoot: pluginRoot,
    });

    // Imported files land in the project's `.rulesync/`, not inside the plugin.
    expect(await readFileContent(join(rulesyncRulesDir, "overview.md"))).toContain(
      "Always follow the review checklist.",
    );
    expect(await readFileContent(rulesyncCommandPath)).toContain("Review pull request $ARGUMENTS.");
    expect(await readFileContent(rulesyncSubagentPath)).toContain("Review the changes.");
    expect(await readFileContent(rulesyncSkillPath)).toContain("Review the current changes.");
    expect(await fileExists(join(pluginRoot, ".rulesync"))).toBe(false);
  });

  describe.skipIf(process.platform === "win32")("symbolic link safety", () => {
    it("rejects plugin imports containing symbolic links", async () => {
      const testDir = getTestDir();
      const pluginRoot = join(testDir, "plugins", "untrusted");
      const outsideFile = join(testDir, "secret.txt");
      await writeFileContent(
        join(pluginRoot, "skills", "review", "SKILL.md"),
        `---
name: review
description: Review code changes
---
Review the current changes.
`,
      );
      await writeFileContent(outsideFile, "secret");
      await symlink(outsideFile, join(pluginRoot, "skills", "review", "secret.txt"));

      await expect(
        runImport({
          target: "claudecode-plugin",
          features: "skills",
          outputRoot: pluginRoot,
        }),
      ).rejects.toThrow();
      expect(
        await fileExists(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "secret.txt")),
      ).toBe(false);
    });
  });
});

describe.skipIf(process.platform === "win32")("E2E: plugin targets in global mode", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  const writeHomeWithUnrelatedSymlink = async (homeDir: string): Promise<void> => {
    // An ordinary home directory contains symlinks (version managers, dotfile
    // managers, ...). A packaging target must never scan it for them.
    const outsideFile = join(homeDir, "tool", "bin", "real-binary");
    await writeFileContent(outsideFile, "#!/bin/sh\n");
    await ensureDir(join(homeDir, ".cache", "bin"));
    await symlink(outsideFile, join(homeDir, ".cache", "bin", "linked-binary"));
  };

  it("skips a packaging target with a warning and still generates the other targets", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    await writeHomeWithUnrelatedSymlink(homeDir);
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
      `---
name: review
description: Review code changes
targets: ["*"]
---
Review the current changes.
`,
    );

    const { stderr, stdout } = await runGenerate({
      target: "claudecode,claudecode-plugin",
      features: "skills",
      global: true,
      env: { HOME_DIR: homeDir, NODE_ENV: "e2e" },
    });

    const output = `${stdout}\n${stderr}`;
    expect(output).toContain(
      "Target 'claudecode-plugin' is a plugin packaging target and supports only project scope. Re-run without '--global'. Skipping.",
    );
    expect(output).not.toContain("symbolic link");
    expect(
      await readFileContent(join(homeDir, ".claude", "skills", "review", "SKILL.md")),
    ).toContain("Review the current changes.");
    expect(await fileExists(join(homeDir, "skills", "review", "SKILL.md"))).toBe(false);
  });

  it("rejects importing a packaging target", async () => {
    const homeDir = getHomeDir();
    await writeHomeWithUnrelatedSymlink(homeDir);

    await expect(
      runImport({
        target: "claudecode-plugin",
        features: "skills",
        global: true,
        env: { HOME_DIR: homeDir, NODE_ENV: "e2e" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "Target 'claudecode-plugin' is a plugin packaging target and supports only project scope. Re-run without '--global'.",
      ),
    });
  });
});
