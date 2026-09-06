import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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

    it("should prefix dot-relative commands with $ZCODE_PROJECT_DIR and keep absolute ones", async () => {
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
        '"$ZCODE_PROJECT_DIR"/.rulesync/hooks/session-start.sh',
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
      // `*` is an invalid regular expression that would silently never match.
      expect(parsed.hooks.events.PreToolUse).toHaveLength(2);
      expect(parsed.hooks.events.PreToolUse[0].matcher).toBeUndefined();
      expect(parsed.hooks.events.PreToolUse[1].matcher).toBe("Bash");
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

      const rulesyncHooks = zcodeHooks.toRulesyncHooks();
      const defs = rulesyncHooks.getJson().hooks.preToolUse;
      expect(defs).toHaveLength(1);
      expect(defs?.[0]?.command).toBe("keep.sh");
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
