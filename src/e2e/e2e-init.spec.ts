import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: init", () => {
  const { getTestDir } = useTestDirectory();

  it("should initialize rulesync without errors and create files", async () => {
    const testDir = getTestDir();
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"]);

    const expectedPaths = [
      RULESYNC_CONFIG_RELATIVE_FILE_PATH,
      RULESYNC_MCP_RELATIVE_FILE_PATH,
      RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    ];

    for (const path of expectedPaths) {
      const exists = await fileExists(join(testDir, path));
      expect(exists, `Expected ${path} to exist`).toBe(true);
    }
  });

  it("should scaffold named and singleton feature files through the add command", async () => {
    const testDir = getTestDir();
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "rule", "--name", "architecture.md"]);
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "skill", "--name", "project-audit"]);
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "mcp"]);

    const rulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "architecture.md");
    const skillPath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "project-audit",
      SKILL_FILE_NAME,
    );
    const mcpPath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);

    expect(await readFileContent(rulePath)).toContain("# Architecture");
    expect(await readFileContent(skillPath)).toContain("name: project-audit");
    expect(await readFileContent(mcpPath)).toContain('"mcpServers"');
  });
});
