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

    it("should return the same .cursor/hooks.json shape in global mode (resolved relative to home)", () => {
      // Cursor uses identical filename for project and global — only the
      // resolution root (project vs. home) differs, which is the harness's job.
      const paths = CursorHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".cursor", relativeFilePath: "hooks.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Cursor-supported events only", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          notification: [{ command: "notify.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = await CursorHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart).toHaveLength(1);
      expect(parsed.hooks.stop).toHaveLength(1);
      expect(parsed.hooks.notification).toBeUndefined();
    });

    it("should emit the workspaceOpen event and pass through failClosed", async () => {
      const config = {
        version: 1,
        hooks: {
          workspaceOpen: [{ command: ".cursor/hooks/on-open.sh" }],
          beforeShellExecution: [{ command: ".cursor/hooks/guard.sh", failClosed: true }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await CursorHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: false,
          })
        ).getFileContent(),
      );
      expect(parsed.hooks.workspaceOpen).toHaveLength(1);
      expect(parsed.hooks.workspaceOpen[0].command).toBe(".cursor/hooks/on-open.sh");
      expect(parsed.hooks.beforeShellExecution[0].failClosed).toBe(true);
    });

    it("should merge config.cursor.hooks on top of shared hooks", async () => {
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = await CursorHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart[0].command).toBe("cursor-override.sh");
      expect(parsed.hooks.afterFileEdit).toHaveLength(1);
      expect(parsed.hooks.afterFileEdit[0].command).toBe(".cursor/hooks/format.sh");
    });

    it("should preserve version from config", async () => {
      const config = { version: 2, hooks: { sessionStart: [] } };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = await CursorHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = cursorHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(2);
    });

    it("should keep an existing third-party command on regenerate when preserveUnowned is set", async () => {
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(
        join(testDir, ".cursor", "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ command: "shared.sh" }, { command: "other-tool-hook cursor-hook" }],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          preserveUnowned: true,
          hooks: { sessionStart: [{ type: "command", command: "shared.sh" }] },
        }),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await CursorHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: false,
          })
        ).getFileContent(),
      );
      const commands = parsed.hooks.sessionStart.map(
        (handler: { command: string }) => handler.command,
      );
      expect(commands).toEqual(["shared.sh", "other-tool-hook cursor-hook"]);
    });

    it("should replace existing third-party commands unless preserveUnowned is set", async () => {
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(
        join(testDir, ".cursor", "hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ command: "shared.sh" }, { command: "other-tool-hook cursor-hook" }],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", command: "shared.sh" }] },
        }),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await CursorHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: false,
          })
        ).getFileContent(),
      );
      const commands = parsed.hooks.sessionStart.map(
        (handler: { command: string }) => handler.command,
      );
      expect(commands).toEqual(["shared.sh"]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Cursor hooks JSON to canonical rulesync format", () => {
      const cursorHooks = new CursorHooks({
        outputRoot: testDir,
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

    it("should carry an event named toString through as a plain string key (#2757)", () => {
      const cursorHooks = new CursorHooks({
        outputRoot: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "hooks.json",
        // JSON.parse yields an own enumerable `toString` key, unlike an object
        // literal whose `toString` the lookup map would inherit from
        // Object.prototype.
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", command: "echo start" }],
            toString: [{ type: "command", command: "echo crafted" }],
          },
        }),
        validate: false,
      });

      const json = cursorHooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(Object.keys(json.hooks)).toEqual(["sessionStart"]);
      // The unmapped name must fall through verbatim rather than resolving to
      // Object.prototype.toString and landing under its stringified source.
      const overrideHooks = (json as { cursor?: { hooks?: Record<string, unknown[]> } }).cursor
        ?.hooks;
      expect(Object.keys(overrideHooks ?? {})).toEqual(["toString"]);
      expect(overrideHooks?.["toString"]?.[0]).toMatchObject({ command: "echo crafted" });
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const cursorHooks = await CursorHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(cursorHooks.getFilePath(), cursorHooks.getFileContent());

      const loaded = await CursorHooks.fromFile({ outputRoot: testDir, validate: false });
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

      const cursorHooks = await CursorHooks.fromFile({ outputRoot: testDir, validate: false });
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
        outputRoot: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "hooks.json",
      });
      expect(hooks).toBeInstanceOf(CursorHooks);
      expect(hooks.getFileContent()).toBe("{}");
    });
  });
});
