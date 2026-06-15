import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANTIGRAVITY_CLI_GLOBAL_SUBDIR,
  ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH,
  ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME,
} from "./antigravity-cli-paths.js";
import {
  ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH as ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH_SOURCE,
  ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME as ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME_SOURCE,
  ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR,
} from "./antigravity-paths.js";
import { CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME } from "./claudecode-paths.js";
import { KILO_COMMANDS_DIR_PATH, KILO_JSONC_FILE_NAME } from "./kilo-paths.js";

/**
 * Guards the centralized path constants against accidental edits. PR #1856 moved
 * these literals into the `*-paths.ts` modules with byte-for-byte equivalence;
 * these assertions pin the resulting values so a future typo is caught here
 * rather than only by whichever feature test happens to exercise the path.
 */
describe("centralized path constants", () => {
  it("resolves the Claude Code shared settings path", () => {
    expect(CLAUDECODE_DIR).toBe(".claude");
    expect(CLAUDECODE_SETTINGS_FILE_NAME).toBe("settings.json");
    expect(join(CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME)).toBe(
      join(".claude", "settings.json"),
    );
  });

  it("resolves the shared Kilo config and commands paths", () => {
    expect(KILO_JSONC_FILE_NAME).toBe("kilo.jsonc");
    expect(KILO_COMMANDS_DIR_PATH).toBe(join(".kilo", "commands"));
  });

  describe("antigravity CLI permissions (single source of truth)", () => {
    it("resolves to the .gemini/antigravity-cli location", () => {
      expect(ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR).toBe("antigravity-cli");
      expect(ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH).toBe(join(".gemini", "antigravity-cli"));
      expect(ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME).toBe("settings.json");
    });

    it("re-exports the same values from antigravity-cli-paths without drift", () => {
      expect(ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH).toBe(
        ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH_SOURCE,
      );
      expect(ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME).toBe(
        ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME_SOURCE,
      );
      expect(ANTIGRAVITY_CLI_GLOBAL_SUBDIR).toBe(ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR);
    });
  });
});
