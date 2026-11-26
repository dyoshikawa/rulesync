import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { directoryExists, fileExists, writeFileContent } from "../utils/file.js";
import { runImport, useTestDirectory } from "./e2e-helper.js";

// `--output-root` names where the tool files are read. The imported rulesync
// sources always go to `.rulesync/` in the current working directory, where
// `generate` reads them, for every feature and target.
describe("E2E: import --output-root writes sources to the project", () => {
  const { getTestDir } = useTestDirectory();

  it("writes every Claude Code feature to ./.rulesync, not <output-root>/.rulesync", async () => {
    const testDir = getTestDir();
    const sub = join(testDir, "sub");
    await writeFileContent(join(sub, "CLAUDE.md"), "# Root\n");
    await writeFileContent(
      join(sub, ".claude", "rules", "api.md"),
      '---\npaths: ["api/**"]\n---\nAPI rule\n',
    );
    await writeFileContent(
      join(sub, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(ls)"], deny: ["Read(./.env)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
        },
      }),
    );
    await writeFileContent(
      join(sub, ".mcp.json"),
      JSON.stringify({ mcpServers: { local: { command: "node" } } }),
    );
    await writeFileContent(
      join(sub, ".claude", "commands", "review.md"),
      "---\ndescription: Review\n---\nReview it\n",
    );
    await writeFileContent(
      join(sub, ".claude", "agents", "planner.md"),
      "---\nname: planner\ndescription: Plans\n---\nPlan it\n",
    );
    await writeFileContent(
      join(sub, ".claude", "skills", "lint", "SKILL.md"),
      "---\nname: lint\ndescription: Lints\n---\nLint it\n",
    );

    await runImport({
      target: "claudecode",
      features: "rules,ignore,mcp,commands,subagents,skills,hooks,permissions",
      outputRoot: "sub",
    });

    for (const relativePath of [
      join(RULESYNC_RULES_RELATIVE_DIR_PATH, "api.md"),
      RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      RULESYNC_MCP_RELATIVE_FILE_PATH,
      join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review.md"),
      join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "lint", "SKILL.md"),
      RULESYNC_HOOKS_RELATIVE_FILE_PATH,
      RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
    ]) {
      expect(await fileExists(join(testDir, relativePath)), relativePath).toBe(true);
    }
    expect(await directoryExists(join(sub, RULESYNC_RELATIVE_DIR_PATH))).toBe(false);
  });

  it("writes Copilot prompt files and Codex CLI rules to ./.rulesync", async () => {
    const testDir = getTestDir();
    const sub = join(testDir, "sub");
    await writeFileContent(
      join(sub, ".github", "prompts", "fix.prompt.md"),
      "---\ndescription: Fix\n---\nFix it\n",
    );
    await writeFileContent(join(sub, "AGENTS.md"), "# Codex\n");

    await runImport({ target: "copilot", features: "commands", outputRoot: "sub" });
    await runImport({ target: "codexcli", features: "rules", outputRoot: "sub" });

    expect(await fileExists(join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "fix.md"))).toBe(
      true,
    );
    expect(await fileExists(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"))).toBe(
      true,
    );
    expect(await directoryExists(join(sub, RULESYNC_RELATIVE_DIR_PATH))).toBe(false);
  });
});
