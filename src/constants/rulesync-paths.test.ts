import { describe, expect, it } from "vitest";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "./rulesync-paths.js";

describe("rulesync-paths constants", () => {
  it("should use forward slashes in all path constants for cross-platform compatibility", () => {
    const pathConstants = [
      RULESYNC_RULES_RELATIVE_DIR_PATH,
      RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      RULESYNC_MCP_RELATIVE_FILE_PATH,
      RULESYNC_HOOKS_RELATIVE_FILE_PATH,
      RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
      RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
    ];

    for (const p of pathConstants) {
      expect(p, `Path "${p}" should not contain backslashes`).not.toContain("\\");
      expect(p, `Path "${p}" should contain forward slashes`).toContain("/");
    }
  });
});
