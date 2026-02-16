import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { FactorydroidHooks } from "./factorydroid-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("FactorydroidHooks", () => {
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
    it("should return .factory and settings.json for project mode", () => {
      const paths = FactorydroidHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".factory", relativeFilePath: "settings.json" });
    });

    it("should return .factory and settings.json for global mode", () => {
      const paths = FactorydroidHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".factory", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Factory Droid-supported events and convert to PascalCase", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
    });

    it("should prefix non-absolute commands with $FACTORY_PROJECT_DIR", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      const sessionStartEntry = parsed.hooks.SessionStart[0];
      expect(sessionStartEntry).toBeDefined();
      expect(sessionStartEntry.matcher).toBeUndefined();
      expect(sessionStartEntry.hooks[0].command).toContain("$FACTORY_PROJECT_DIR");
      expect(sessionStartEntry.hooks[0].command).toContain(".rulesync/hooks/session-start.sh");
    });

    it("should not prefix commands that already start with $", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: "$FACTORY_PROJECT_DIR/.factory/hooks/start.sh" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        "$FACTORY_PROJECT_DIR/.factory/hooks/start.sh",
      );
    });

    it("should merge config.factorydroid.hooks on top of shared hooks", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        factorydroid: {
          hooks: {
            notification: [
              {
                matcher: "permission_prompt",
                command: "$FACTORY_PROJECT_DIR/.factory/hooks/notify.sh",
              },
            ],
            sessionStart: [{ type: "command", command: "factory-override.sh" }],
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

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("factory-override.sh");
      expect(parsed.hooks.Notification).toBeDefined();
      expect(parsed.hooks.Notification[0].matcher).toBe("permission_prompt");
    });

    it("should throw error with descriptive message when existing settings.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        FactorydroidHooks.fromRulesyncHooks({
          baseDir: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse existing Factory Droid settings/);
    });

    it("should merge rulesync hooks into existing .factory/settings.json content", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.json"),
        JSON.stringify({ otherKey: "preserved" }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
    });

    it("should handle hooks with matcher grouping", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { matcher: "Write", command: "lint.sh" },
            { matcher: "Write", command: "format.sh" },
            { matcher: "Edit", command: "validate.sh" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.PreToolUse).toHaveLength(2);

      const writeEntry = parsed.hooks.PreToolUse.find(
        (e: Record<string, unknown>) => e.matcher === "Write",
      );
      expect(writeEntry).toBeDefined();
      expect(writeEntry.hooks).toHaveLength(2);

      const editEntry = parsed.hooks.PreToolUse.find(
        (e: Record<string, unknown>) => e.matcher === "Edit",
      );
      expect(editEntry).toBeDefined();
      expect(editEntry.hooks).toHaveLength(1);
    });

    it("should include timeout and prompt fields when present", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "prompt", prompt: "Check this tool call", timeout: 30000 }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      const hookDef = parsed.hooks.PreToolUse[0].hooks[0];
      expect(hookDef.type).toBe("prompt");
      expect(hookDef.prompt).toBe("Check this tool call");
      expect(hookDef.timeout).toBe(30000);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => factorydroidHooks.toRulesyncHooks()).toThrow(
        /Failed to parse Factory Droid hooks content/,
      );
    });

    it("should convert Factory Droid PascalCase hooks to canonical camelCase", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "$FACTORY_PROJECT_DIR/echo.sh" }] },
            ],
            Stop: [{ hooks: [{ command: "audit.sh" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toContain("echo.sh");
      expect(json.hooks.stop).toHaveLength(1);
    });

    it("should strip $FACTORY_PROJECT_DIR prefix from commands", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: "$FACTORY_PROJECT_DIR/.rulesync/hooks/start.sh" },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("./.rulesync/hooks/start.sh");
    });

    it("should preserve matcher from entries", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [{ type: "command", command: "format.sh" }],
              },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.preToolUse).toHaveLength(1);
      expect(json.hooks.preToolUse?.[0]?.matcher).toBe("Write|Edit");
    });

    it("should handle empty hooks object", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ hooks: {} }),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks).toEqual({});
    });

    it("should handle missing hooks key", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({}),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks).toEqual({});
    });

    it("should skip entries that are not valid matcher entries", () => {
      const factorydroidHooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "valid.sh" }] },
              "invalid-entry",
              { matcher: 123, hooks: [] },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = factorydroidHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("valid.sh");
    });
  });

  describe("fromFile", () => {
    it("should load from .factory/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(
        join(testDir, ".factory", "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const factorydroidHooks = await FactorydroidHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(factorydroidHooks).toBeInstanceOf(FactorydroidHooks);
      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toEqual([]);
    });

    it("should initialize empty hooks when .factory/settings.json does not exist", async () => {
      const factorydroidHooks = await FactorydroidHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(factorydroidHooks).toBeInstanceOf(FactorydroidHooks);
      const content = factorydroidHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new FactorydroidHooks({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return FactorydroidHooks instance with empty hooks for deletion path", () => {
      const hooks = FactorydroidHooks.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
      });
      expect(hooks).toBeInstanceOf(FactorydroidHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("round-trip", () => {
    it("should preserve hooks through fromRulesyncHooks -> write -> fromFile -> toRulesyncHooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          preToolUse: [{ matcher: "Write|Edit", command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(factorydroidHooks.getFilePath(), factorydroidHooks.getFileContent());

      const loaded = await FactorydroidHooks.fromFile({ baseDir: testDir, validate: false });
      const backToRulesync = loaded.toRulesyncHooks();
      const json = backToRulesync.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("./.rulesync/hooks/session-start.sh");
      expect(json.hooks.preToolUse).toHaveLength(1);
      expect(json.hooks.preToolUse?.[0]?.matcher).toBe("Write|Edit");
    });

    it("should preserve all supported event types through round-trip", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "start.sh" }],
          sessionEnd: [{ command: "end.sh" }],
          preToolUse: [{ command: "pre.sh" }],
          postToolUse: [{ command: "post.sh" }],
          beforeSubmitPrompt: [{ command: "prompt.sh" }],
          stop: [{ command: "stop.sh" }],
          subagentStop: [{ command: "subagent.sh" }],
          preCompact: [{ command: "compact.sh" }],
          permissionRequest: [{ command: "perm.sh" }],
          notification: [{ command: "notify.sh" }],
          setup: [{ command: "setup.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const factorydroidHooks = await FactorydroidHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(factorydroidHooks.getFilePath(), factorydroidHooks.getFileContent());

      const loaded = await FactorydroidHooks.fromFile({ baseDir: testDir, validate: false });
      const backToRulesync = loaded.toRulesyncHooks();
      const json = backToRulesync.getJson();

      const expectedEvents = [
        "sessionStart",
        "sessionEnd",
        "preToolUse",
        "postToolUse",
        "beforeSubmitPrompt",
        "stop",
        "subagentStop",
        "preCompact",
        "permissionRequest",
        "notification",
        "setup",
      ];
      for (const event of expectedEvents) {
        expect(json.hooks[event]).toHaveLength(1);
      }
    });
  });
});
