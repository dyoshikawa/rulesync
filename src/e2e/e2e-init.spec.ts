import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists } from "../utils/file.js";
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

    const existenceChecks = await Promise.all(
      expectedPaths.map(async (path) => fileExists(join(testDir, path))),
    );

    existenceChecks.forEach((exists) => {
      expect(exists).toBe(true);
    });
  });
});
