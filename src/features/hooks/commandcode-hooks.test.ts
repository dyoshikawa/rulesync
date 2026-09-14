import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CommandcodeHooks } from "./commandcode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

const SETTINGS_DIR = ".commandcode";

describe("CommandcodeHooks", () => {
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
    it("should return .commandcode/settings.json for both scopes", () => {
      const expected = { relativeDirPath: SETTINGS_DIR, relativeFilePath: "settings.json" };
      expect(CommandcodeHooks.getSettablePaths({ global: false })).toEqual(expected);
      expect(CommandcodeHooks.getSettablePaths({ global: true })).toEqual(expected);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit the four supported events in PascalCase and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "pre-tool.sh", matcher: "shell" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
          stop: [{ type: "command", command: "audit.sh" }],
          sessionStart: [{ type: "command", command: "session-start.sh" }],
          // Command Code has no prompt, session-end or compaction events.
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          sessionEnd: [{ type: "command", command: "session-end.sh" }],
          preCompact: [{ type: "command", command: "compact.sh" }],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(hooks.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(hooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "PostToolUse",
        "PreToolUse",
        "SessionStart",
        "Stop",
      ]);
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("shell");
      expect(parsed.hooks.PreToolUse[0].hooks[0]).toEqual({
        type: "command",
        command: "pre-tool.sh",
      });
    });

    it("should carry over timeout on command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [{ type: "command", command: "audit.sh", timeout: 30 }],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: "command",
        command: "audit.sh",
        timeout: 30,
      });
    });

    it("should skip prompt and http hooks because only command hooks exist", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh" },
            { type: "prompt", prompt: "Is this command safe? $ARGUMENTS" },
            { type: "http", url: "https://example.com/hook" },
          ],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const emitted = parsed.hooks.PreToolUse.flatMap((group: { hooks: unknown[] }) => group.hooks);
      expect(emitted).toEqual([{ type: "command", command: "pre.sh" }]);
    });

    it("should keep regex matchers verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { command: "edits.sh", matcher: "edit|write" },
            { command: "shell.sh", matcher: "shell" },
          ],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.PreToolUse.map((g: { matcher?: string }) => g.matcher)).toEqual([
        "edit|write",
        "shell",
      ]);
    });

    it("should anchor dot-relative commands to $COMMANDCODE_PROJECT_DIR", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: ".rulesync/hooks/start.sh" },
            { command: "npx prettier --write ." },
          ],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const commands = parsed.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toEqual([
        '"$COMMANDCODE_PROJECT_DIR"/.rulesync/hooks/start.sh',
        "npx prettier --write .",
      ]);
    });

    it("should drop matchers on Stop and SessionStart", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
          sessionStart: [{ command: "start.sh", matcher: "*.js" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
      expect(parsed.hooks.SessionStart[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.ts" on "stop" hook will be ignored'),
      );
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      await writeFileContent(
        join(testDir, SETTINGS_DIR, "settings.json"),
        JSON.stringify({
          permissions: { allow: ["Read"] },
          defaultMode: "acceptEdits",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.permissions).toEqual({ allow: ["Read"] });
      expect(parsed.defaultMode).toBe("acceptEdits");
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      // The stale event is replaced because rulesync owns the whole `hooks` key.
      expect(parsed.hooks.Stop).toBeUndefined();
    });

    it("should emit events from the commandcode override block verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {},
        commandcode: {
          hooks: {
            sessionStart: [{ command: "commandcode-only.sh" }],
          },
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain("commandcode-only.sh");
    });

    it("should write to .commandcode/settings.json in global mode too", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      await writeFileContent(join(testDir, SETTINGS_DIR, "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        CommandcodeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .commandcode/settings.json when it exists", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, SETTINGS_DIR, "settings.json"), content);

      const hooks = await CommandcodeHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(hooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const hooks = await CommandcodeHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });

    it("should load the same relative file in global mode", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      const content = JSON.stringify({ hooks: {} });
      await writeFileContent(join(testDir, SETTINGS_DIR, "settings.json"), content);

      const hooks = await CommandcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(hooks.getFileContent()).toBe(content);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert PascalCase events to canonical camelCase", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: { allow: ["Read"] },
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
            PreToolUse: [
              {
                matcher: "shell",
                hooks: [{ type: "command", command: "pre.sh", timeout: 10 }],
              },
            ],
            PostToolUse: [{ hooks: [{ type: "command", command: "post.sh" }] }],
            Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart?.[0]?.command).toBe("session-start.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "shell",
        timeout: 10,
      });
      expect(json.hooks.postToolUse?.[0]?.command).toBe("post.sh");
      expect(json.hooks.stop?.[0]?.command).toBe("stop.sh");
      // Sibling settings keys must not leak into the canonical model.
      expect((json as Record<string, unknown>).permissions).toBeUndefined();
    });

    it("should move unknown event keys into the commandcode override block", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "a.sh" }] }],
            FutureEvent: [{ hooks: [{ type: "command", command: "b.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.commandcode?.hooks?.FutureEvent).toHaveLength(1);
    });

    it("should strip the $COMMANDCODE_PROJECT_DIR prefix on import", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: '"$COMMANDCODE_PROJECT_DIR"/.rulesync/hooks/start.sh',
                  },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      expect(hooks.toRulesyncHooks().getJson().hooks.sessionStart?.[0]?.command).toBe(
        "./.rulesync/hooks/start.sh",
      );
    });

    it("should tolerate a settings file without a hooks key", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ defaultMode: "plan" }),
        validate: false,
      });

      expect(hooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should throw when the content is not parseable", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: "not json",
        validate: false,
      });

      expect(() => hooks.toRulesyncHooks()).toThrow(/Failed to parse Command Code hooks content/);
    });

    it("should round-trip through generate and import", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "pre.sh", matcher: "edit|write", timeout: 5 }],
          stop: [{ type: "command", command: "stop.sh" }],
        },
      });

      const hooks = await CommandcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "edit|write",
        timeout: 5,
      });
      expect(json.hooks.stop?.[0]).toMatchObject({ command: "stop.sh" });
    });
  });

  describe("isDeletable", () => {
    it("should return false because the file holds other user settings", () => {
      const hooks = new CommandcodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an instance with an empty hooks block", () => {
      const hooks = CommandcodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
