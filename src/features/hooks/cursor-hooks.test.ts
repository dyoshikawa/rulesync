import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CursorHooks } from "./cursor-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("CursorHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .cursor and hooks.json", () => {
      const paths = CursorHooks.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: ".cursor", relativeFilePath: "hooks.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Cursor-supported events only", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          notification: [{ command: "notify.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = CursorHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart).toHaveLength(1);
      expect(parsed.hooks.stop).toHaveLength(1);
      expect(parsed.hooks.notification).toBeUndefined();
    });

    it("should merge config.cursor.hooks on top of shared hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        cursor: {
          hooks: {
            afterFileEdit: [{ command: ".cursor/hooks/format.sh" }],
            sessionStart: [{ type: "command", command: "cursor-override.sh" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = CursorHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart[0].command).toBe("cursor-override.sh");
      expect(parsed.hooks.afterFileEdit).toHaveLength(1);
      expect(parsed.hooks.afterFileEdit[0].command).toBe(".cursor/hooks/format.sh");
    });

    it("should preserve version from config", () => {
      const config = { version: 2, hooks: { sessionStart: [] } };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = CursorHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(2);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Cursor hooks JSON to canonical rulesync format", () => {
      const cursorHooks = new CursorHooks({
        baseDir: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", command: "echo" }],
            afterFileEdit: [{ command: "format.sh" }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = cursorHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.afterFileEdit).toHaveLength(1);
      expect(json.version).toBe(1);
    });
  });

  describe("round-trip", () => {
    it("should preserve hooks through fromRulesyncHooks -> write -> fromFile -> toRulesyncHooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          postToolUse: [{ matcher: "Write|Edit", command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = CursorHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(cursorHooks.getFilePath(), cursorHooks.getFileContent());

      const loaded = await CursorHooks.fromFile({ baseDir: testDir, validate: false });
      const backToRulesync = loaded.toRulesyncHooks();
      const json = backToRulesync.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe(".rulesync/hooks/session-start.sh");
      expect(json.hooks.postToolUse).toHaveLength(1);
      expect(json.hooks.postToolUse?.[0]?.matcher).toBe("Write|Edit");
    });
  });

  describe("fromFile", () => {
    it("should load from .cursor/hooks.json", async () => {
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(
        join(testDir, ".cursor", "hooks.json"),
        JSON.stringify({ version: 1, hooks: { sessionStart: [] } }),
      );

      const cursorHooks = await CursorHooks.fromFile({ baseDir: testDir, validate: false });
      expect(cursorHooks).toBeInstanceOf(CursorHooks);
      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.sessionStart).toEqual([]);
    });
  });

  describe("forDeletion", () => {
    it("should return CursorHooks instance with empty hooks for deletion path", () => {
      const hooks = CursorHooks.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "hooks.json",
      });
      expect(hooks).toBeInstanceOf(CursorHooks);
      expect(hooks.getFileContent()).toBe("{}");
    });
  });
});
