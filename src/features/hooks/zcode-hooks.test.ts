import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ZcodeHooks } from "./zcode-hooks.js";

describe("ZcodeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .zcode/cli and config.json for project mode", () => {
      const paths = ZcodeHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
      });
    });

    it("should return .zcode/cli and config.json for global mode", () => {
      const paths = ZcodeHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit the seven supported events under hooks.events and drop unsupported events", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: ".rulesync/hooks/prompt.sh" }],
          preToolUse: [{ type: "command", command: ".rulesync/hooks/pre-tool.sh" }],
          postToolUse: [{ type: "command", command: ".rulesync/hooks/post-tool.sh" }],
          postToolUseFailure: [{ type: "command", command: ".rulesync/hooks/failure.sh" }],
          permissionRequest: [{ type: "command", command: ".rulesync/hooks/permission.sh" }],
          stop: [{ type: "command", command: ".rulesync/hooks/audit.sh" }],
          // sessionEnd is not one of ZCode's seven events and must be dropped.
          sessionEnd: [{ type: "command", command: ".rulesync/hooks/session-end.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.enabled).toBe(true);
      expect(parsed.hooks.events.SessionStart).toBeDefined();
      expect(parsed.hooks.events.UserPromptSubmit).toBeDefined();
      expect(parsed.hooks.events.PreToolUse).toBeDefined();
      expect(parsed.hooks.events.PostToolUse).toBeDefined();
      expect(parsed.hooks.events.PostToolUseFailure).toBeDefined();
      expect(parsed.hooks.events.PermissionRequest).toBeDefined();
      expect(parsed.hooks.events.Stop).toBeDefined();
      expect(parsed.hooks.events.SessionEnd).toBeUndefined();
    });

    it("should keep a pre-existing enabled: false and carry over hooks siblings", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({ otherKey: "preserved", hooks: { enabled: false, timeoutMs: 5000 } }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks.enabled).toBe(false);
      expect(parsed.hooks.timeoutMs).toBe(5000);
      expect(parsed.hooks.events.SessionStart).toBeDefined();
    });

    it("should not state enabled when no supported events are written", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        // sessionEnd is not one of ZCode's seven events, so nothing is written.
        hooks: { sessionEnd: [{ command: "echo session ended" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.events).toEqual({});
      expect(parsed.hooks.enabled).toBeUndefined();
    });

    it("should preserve a non-boolean enabled value untouched", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({ hooks: { enabled: "false" } }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.enabled).toBe("false");
    });

    it("should replace a stale event key from the existing file", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({
          hooks: {
            enabled: true,
            timeoutMs: 5000,
            events: {
              PostToolUse: [{ hooks: [{ type: "command", command: "stale.sh" }] }],
            },
          },
        }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      // `hooks` is owned as a whole key: the stale PostToolUse entry vanishes
      // while the non-`events` siblings survive.
      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.events.PostToolUse).toBeUndefined();
      expect(parsed.hooks.events.SessionStart).toBeDefined();
      expect(parsed.hooks.timeoutMs).toBe(5000);
    });

    it("should state enabled: true when the existing config has no hooks block", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({ model: "glm-4.7" }),
      );

      const config = {
        version: 1,
        hooks: { stop: [{ command: ".rulesync/hooks/audit.sh" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.model).toBe("glm-4.7");
      expect(parsed.hooks.enabled).toBe(true);
    });

    it("should emit dot-relative commands verbatim and keep absolute ones", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: "npx audit-tool" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.events.SessionStart[0].hooks[0].command).toBe(
        ".rulesync/hooks/session-start.sh",
      );
      expect(parsed.hooks.events.Stop[0].hooks[0].command).toBe("npx audit-tool");
    });

    it("should export a canonical catch-all matcher as no matcher", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { matcher: "*", command: ".rulesync/hooks/pre-tool.sh" },
            { matcher: "Bash", command: ".rulesync/hooks/pre-bash.sh" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      // `*` is an explicit match-all in ZCode, equivalent to an omitted matcher.
      expect(parsed.hooks.events.PreToolUse).toHaveLength(2);
      expect(parsed.hooks.events.PreToolUse[0].matcher).toBeUndefined();
      expect(parsed.hooks.events.PreToolUse[1].matcher).toBe("Bash");
    });

    it("should drop matchers on UserPromptSubmit and Stop, which expose no match value", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.events.UserPromptSubmit[0].matcher).toBeUndefined();
      expect(parsed.hooks.events.Stop[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.ts" on "stop" hook will be ignored'),
      );
    });

    it("should emit events from the zcode override block verbatim", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {},
        zcode: {
          hooks: {
            sessionStart: [{ command: ".rulesync/hooks/zcode-only.sh" }],
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

      const zcodeHooks = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.events.SessionStart)).toContain(
        ".rulesync/hooks/zcode-only.sh",
      );
    });

    it("should throw when the existing config.json is not parseable", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        ZcodeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load from .zcode/cli/config.json when it exists", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(
        join(testDir, ".zcode", "cli", "config.json"),
        JSON.stringify({ hooks: { enabled: true, events: { SessionStart: [] } } }),
      );

      const zcodeHooks = await ZcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      const parsed = JSON.parse(zcodeHooks.getFileContent());
      expect(parsed.hooks.events.SessionStart).toEqual([]);
    });

    it("should initialize an empty config when .zcode/cli/config.json does not exist", async () => {
      const zcodeHooks = await ZcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(JSON.parse(zcodeHooks.getFileContent())).toEqual({});
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert ZCode PascalCase hooks to canonical camelCase (round-trip)", () => {
      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            enabled: true,
            timeoutMs: 5000,
            events: {
              SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
            },
          },
        }),
        validate: false,
      });

      const rulesyncHooks = zcodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("session-start.sh");
      // The config's own keys must not leak into the canonical model.
      expect(json.enabled).toBeUndefined();
      expect(json.timeoutMs).toBeUndefined();
    });

    it("should keep a per-hook enabled: false through import and regenerate", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            events: {
              SessionStart: [
                {
                  hooks: [
                    { type: "command", command: "on.sh" },
                    { type: "command", command: "off.sh", enabled: false },
                  ],
                },
              ],
            },
          },
        }),
        validate: false,
      });

      const rulesyncHooks = zcodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.enabled).toBeUndefined();
      expect(json.hooks.sessionStart?.[1]?.enabled).toBe(false);

      const regenerated = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const parsed = JSON.parse(regenerated.getFileContent());
      expect(parsed.hooks.events.SessionStart[0].hooks[0].enabled).toBeUndefined();
      expect(parsed.hooks.events.SessionStart[0].hooks[1].enabled).toBe(false);
    });

    it("should move native-only event keys into the zcode override block", () => {
      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            events: {
              SessionStart: [{ hooks: [{ type: "command", command: "a.sh" }] }],
              Notification: [{ hooks: [{ type: "command", command: "b.sh" }] }],
            },
          },
        }),
        validate: false,
      });

      const rulesyncHooks = zcodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.zcode?.hooks?.Notification).toHaveLength(1);
    });

    it("should skip process hooks, which have no canonical equivalent", () => {
      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            events: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    { type: "process", command: "node", args: ["hook.js"] },
                    { type: "command", command: "keep.sh" },
                  ],
                },
              ],
            },
          },
        }),
        validate: false,
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const rulesyncHooks = zcodeHooks.toRulesyncHooks({ logger });
      const defs = rulesyncHooks.getJson().hooks.preToolUse;
      expect(defs).toHaveLength(1);
      expect(defs?.[0]?.command).toBe("keep.sh");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping a ZCode "process" hook on "PreToolUse"'),
      );
    });

    it("should drop a matcher group whose only hook is a process hook", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            events: {
              PreToolUse: [
                { matcher: "Read", hooks: [{ type: "process", command: "node", args: ["a.js"] }] },
                { matcher: "Bash", hooks: [{ type: "command", command: "keep.sh" }] },
              ],
            },
          },
        }),
        validate: false,
      });

      const rulesyncHooks = zcodeHooks.toRulesyncHooks({ logger: createMockLogger() });
      const defs = rulesyncHooks.getJson().hooks.preToolUse;
      expect(defs).toHaveLength(1);
      expect(defs?.[0]?.matcher).toBe("Bash");

      // The emptied group must not survive as a hook-less entry: regenerating
      // would otherwise write a matcher that runs nothing.
      const regenerated = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const groups = JSON.parse(regenerated.getFileContent()).hooks.events.PreToolUse;
      expect(groups).toHaveLength(1);
      expect(groups[0].matcher).toBe("Bash");
    });

    it("should round-trip the async, shell and statusMessage passthrough fields", async () => {
      await ensureDir(join(testDir, ".zcode", "cli"));
      await writeFileContent(join(testDir, ".zcode", "cli", "config.json"), JSON.stringify({}));

      const zcodeHooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: JSON.stringify({
          hooks: {
            events: {
              PostToolUse: [
                {
                  matcher: "Write",
                  hooks: [
                    {
                      type: "command",
                      command: "format.sh",
                      async: true,
                      shell: "bash",
                      statusMessage: "Formatting",
                    },
                  ],
                },
              ],
            },
          },
        }),
        validate: false,
      });

      const rulesyncHooks = zcodeHooks.toRulesyncHooks();
      const def = rulesyncHooks.getJson().hooks.postToolUse?.[0];
      expect(def?.async).toBe(true);
      expect(def?.shell).toBe("bash");
      expect(def?.statusMessage).toBe("Formatting");

      const regenerated = await ZcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const hook = JSON.parse(regenerated.getFileContent()).hooks.events.PostToolUse[0].hooks[0];
      expect(hook.async).toBe(true);
      expect(hook.shell).toBe("bash");
      expect(hook.statusMessage).toBe("Formatting");
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new ZcodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return a ZcodeHooks instance with empty events for the deletion path", () => {
      const hooks = ZcodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".zcode", "cli"),
        relativeFilePath: "config.json",
      });
      expect(hooks).toBeInstanceOf(ZcodeHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.events).toEqual({});
    });
  });
});
