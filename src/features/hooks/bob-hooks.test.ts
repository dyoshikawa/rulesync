import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobHooks } from "./bob-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("BobHooks", () => {
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
    it("should return .bob/settings.json for project mode", () => {
      expect(BobHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
      });
    });

    it("should return .bob/settings/settings.json for global mode", () => {
      expect(BobHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".bob", "settings"),
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit the five supported events in Bob's PascalCase shape and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: ".rulesync/hooks/prompt.sh" }],
          preToolUse: [
            { type: "command", command: ".rulesync/hooks/pre-tool.sh", matcher: "Bash" },
          ],
          postToolUse: [{ type: "command", command: ".rulesync/hooks/post-tool.sh" }],
          stop: [{ type: "command", command: ".rulesync/hooks/audit.sh" }],
          // Bob has no session-end or permission events.
          sessionEnd: [{ type: "command", command: ".rulesync/hooks/session-end.sh" }],
          permissionRequest: [{ type: "command", command: ".rulesync/hooks/permission.sh" }],
        },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(bobHooks.getRelativeDirPath()).toBe(".bob");
      expect(bobHooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(bobHooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "PostToolUse",
        "PreToolUse",
        "SessionStart",
        "Stop",
        "UserPromptSubmit",
      ]);
      expect(parsed.hooks.SessionStart[0].hooks[0]).toMatchObject({
        type: "command",
        command: ".rulesync/hooks/session-start.sh",
      });
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(".rulesync/hooks/pre-tool.sh");
      expect(parsed.hooks.SessionEnd).toBeUndefined();
      expect(parsed.hooks.PermissionRequest).toBeUndefined();
    });

    it("should carry over the timeout on command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [{ type: "command", command: "audit.sh", timeout: 30 }],
        },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(bobHooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0].timeout).toBe(30);
    });

    it("should drop matchers on SessionStart, UserPromptSubmit and Stop", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [{ command: "start.sh", matcher: "startup" }],
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(bobHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].matcher).toBeUndefined();
      expect(parsed.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
      expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
    });

    it("should skip non-command hook types", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh" },
            { type: "prompt", prompt: "Check this" },
          ],
        },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(bobHooks.getFileContent());
      const hooks = parsed.hooks.PreToolUse.flatMap((group: { hooks: unknown[] }) => group.hooks);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toMatchObject({ type: "command", command: "pre.sh" });
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "settings.json"),
        JSON.stringify({
          autoApproval: { enabled: true },
          hooks: { Stop: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(bobHooks.getFileContent());
      expect(parsed.autoApproval).toEqual({ enabled: true });
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      // The stale event is replaced because rulesync owns the whole `hooks` key.
      expect(parsed.hooks.Stop).toBeUndefined();
    });

    it("should emit events from the bob override block verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {},
        bob: {
          hooks: {
            sessionStart: [{ command: ".rulesync/hooks/bob-only.sh" }],
          },
        },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(bobHooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain(".rulesync/hooks/bob-only.sh");
    });

    it("should write to .bob/settings/settings.json in global mode", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(bobHooks.getRelativeDirPath()).toBe(join(".bob", "settings"));
      expect(bobHooks.getRelativeFilePath()).toBe("settings.json");
      expect(JSON.parse(bobHooks.getFileContent()).hooks.Stop).toHaveLength(1);
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        BobHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .bob/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".bob"));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, ".bob", "settings.json"), content);

      const bobHooks = await BobHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(bobHooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const bobHooks = await BobHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(bobHooks.getFileContent())).toEqual({ hooks: {} });
    });

    it("should load the global file from .bob/settings/settings.json", async () => {
      await ensureDir(join(testDir, ".bob", "settings"));
      const content = JSON.stringify({ hooks: {} });
      await writeFileContent(join(testDir, ".bob", "settings", "settings.json"), content);

      const bobHooks = await BobHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });

      expect(bobHooks.getRelativeDirPath()).toBe(join(".bob", "settings"));
      expect(bobHooks.getFileContent()).toBe(content);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Bob PascalCase events to canonical camelCase", () => {
      const bobHooks = new BobHooks({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          autoApproval: { enabled: true },
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "pre.sh", timeout: 10 }] },
            ],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
            PostToolUse: [{ hooks: [{ type: "command", command: "post.sh" }] }],
            Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = bobHooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart?.[0]?.command).toBe("session-start.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Bash",
        timeout: 10,
      });
      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("prompt.sh");
      expect(json.hooks.postToolUse?.[0]?.command).toBe("post.sh");
      expect(json.hooks.stop?.[0]?.command).toBe("stop.sh");
      // Sibling settings keys must not leak into the canonical model.
      expect((json as Record<string, unknown>).autoApproval).toBeUndefined();
    });

    it("should move unknown event keys into the bob override block", () => {
      const bobHooks = new BobHooks({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "a.sh" }] }],
            Notification: [{ hooks: [{ type: "command", command: "b.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = bobHooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.bob?.hooks?.Notification).toHaveLength(1);
    });

    it("should tolerate a settings file without a hooks key", () => {
      const bobHooks = new BobHooks({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ autoApproval: {} }),
        validate: false,
      });

      expect(bobHooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should throw when the content is not parseable", () => {
      const bobHooks = new BobHooks({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
        fileContent: "not json",
        validate: false,
      });

      expect(() => bobHooks.toRulesyncHooks()).toThrow(/Failed to parse Bob hooks content/);
    });

    it("should round-trip through generate and import", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "pre.sh", matcher: "Write|Edit", timeout: 5 }],
          stop: [{ type: "command", command: "stop.sh" }],
        },
      });

      const bobHooks = await BobHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const json = bobHooks.toRulesyncHooks().getJson();

      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Write|Edit",
        timeout: 5,
      });
      expect(json.hooks.stop?.[0]?.command).toBe("stop.sh");
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json holds other user settings", () => {
      const bobHooks = new BobHooks({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(bobHooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an instance with an empty hooks block", () => {
      const bobHooks = BobHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "settings.json",
      });

      expect(JSON.parse(bobHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
