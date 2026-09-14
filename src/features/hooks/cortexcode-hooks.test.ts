import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CortexcodeHooks } from "./cortexcode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

const GLOBAL_DIR = join(".snowflake", "cortex");

describe("CortexcodeHooks", () => {
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
    it("should return .cortex/settings.json for project mode", () => {
      expect(CortexcodeHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
      });
    });

    it("should return .snowflake/cortex/hooks.json for global mode", () => {
      expect(CortexcodeHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: "hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit the eleven supported events in PascalCase and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "pre-tool.sh", matcher: "bash" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
          permissionRequest: [{ type: "command", command: "permission.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          sessionStart: [{ type: "command", command: "session-start.sh" }],
          sessionEnd: [{ type: "command", command: "session-end.sh" }],
          preCompact: [{ type: "command", command: "compact.sh" }],
          stop: [{ type: "command", command: "audit.sh" }],
          subagentStop: [{ type: "command", command: "subagent-stop.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          setup: [{ type: "command", command: "setup.sh" }],
          // Cortex Code has no model or tool-selection events.
          preModelInvocation: [{ type: "command", command: "model.sh" }],
          beforeToolSelection: [{ type: "command", command: "select.sh" }],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(hooks.getRelativeDirPath()).toBe(".cortex");
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(hooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "Notification",
        "PermissionRequest",
        "PostToolUse",
        "PreCompact",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Setup",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
      ]);
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("bash");
      expect(parsed.hooks.PreToolUse[0].hooks[0]).toMatchObject({
        type: "command",
        command: "pre-tool.sh",
      });
      expect(parsed.hooks.Setup[0].hooks[0].command).toBe("setup.sh");
    });

    it("should carry over timeout and enabled on command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [{ type: "command", command: "audit.sh", timeout: 30, enabled: false }],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: "command",
        command: "audit.sh",
        timeout: 30,
        enabled: false,
      });
    });

    it("should emit prompt hooks and skip unsupported hook types", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh" },
            { type: "prompt", prompt: "Is this command safe? $ARGUMENTS", timeout: 30 },
            { type: "http", url: "https://example.com/hook" },
          ],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const emitted = parsed.hooks.PreToolUse.flatMap((group: { hooks: unknown[] }) => group.hooks);
      expect(emitted).toEqual([
        { type: "command", command: "pre.sh" },
        { type: "prompt", prompt: "Is this command safe? $ARGUMENTS", timeout: 30 },
      ]);
    });

    it("should keep the documented '*' matcher verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { command: "all-tools.sh", matcher: "*" },
            { command: "edits.sh", matcher: "edit|write" },
          ],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.PreToolUse.map((g: { matcher?: string }) => g.matcher)).toEqual([
        "*",
        "edit|write",
      ]);
    });

    it("should anchor dot-relative commands to $CORTEX_PROJECT_DIR", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: ".rulesync/hooks/start.sh" },
            { command: "npx prettier --write ." },
          ],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const commands = parsed.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toEqual([
        '"$CORTEX_PROJECT_DIR"/.rulesync/hooks/start.sh',
        "npx prettier --write .",
      ]);
    });

    it("should drop matchers on UserPromptSubmit and Stop", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
      expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, ".cortex"));
      await writeFileContent(
        join(testDir, ".cortex", "settings.json"),
        JSON.stringify({
          model: "claude-sonnet-4-5",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.model).toBe("claude-sonnet-4-5");
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      // The stale event is replaced because rulesync owns the whole `hooks` key.
      expect(parsed.hooks.Stop).toBeUndefined();
    });

    it("should emit events from the cortexcode override block verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {},
        cortexcode: {
          hooks: {
            sessionStart: [{ command: "cortex-only.sh" }],
          },
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain("cortex-only.sh");
    });

    it("should write to .snowflake/cortex/hooks.json in global mode", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(hooks.getRelativeFilePath()).toBe("hooks.json");
      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
    });

    it("should keep sibling keys of an existing global hooks.json", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, "hooks.json"),
        JSON.stringify({ custom: true, hooks: {} }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.custom).toBe(true);
      expect(parsed.hooks.Stop).toHaveLength(1);
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, ".cortex"));
      await writeFileContent(join(testDir, ".cortex", "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        CortexcodeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .cortex/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".cortex"));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, ".cortex", "settings.json"), content);

      const hooks = await CortexcodeHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(hooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const hooks = await CortexcodeHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });

    it("should load the global file from .snowflake/cortex/hooks.json", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      const content = JSON.stringify({ hooks: {} });
      await writeFileContent(join(testDir, GLOBAL_DIR, "hooks.json"), content);

      const hooks = await CortexcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(hooks.getRelativeFilePath()).toBe("hooks.json");
      expect(hooks.getFileContent()).toBe(content);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert PascalCase events to canonical camelCase", () => {
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          model: "claude-sonnet-4-5",
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
            PreToolUse: [
              {
                matcher: "bash",
                hooks: [{ type: "command", command: "pre.sh", timeout: 10, enabled: true }],
              },
            ],
            PermissionRequest: [
              { hooks: [{ type: "prompt", prompt: "Allow? $ARGUMENTS", timeout: 30 }] },
            ],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
            Setup: [{ hooks: [{ type: "command", command: "setup.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart?.[0]?.command).toBe("session-start.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "bash",
        timeout: 10,
        enabled: true,
      });
      expect(json.hooks.permissionRequest?.[0]).toMatchObject({
        type: "prompt",
        prompt: "Allow? $ARGUMENTS",
        timeout: 30,
      });
      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("prompt.sh");
      expect(json.hooks.setup?.[0]?.command).toBe("setup.sh");
      // Sibling settings keys must not leak into the canonical model.
      expect((json as Record<string, unknown>).model).toBeUndefined();
    });

    it("should move unknown event keys into the cortexcode override block", () => {
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
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
      expect(json.cortexcode?.hooks?.FutureEvent).toHaveLength(1);
    });

    it("should strip the $CORTEX_PROJECT_DIR prefix on import", () => {
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: '"$CORTEX_PROJECT_DIR"/.rulesync/hooks/start.sh' },
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
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ model: "x" }),
        validate: false,
      });

      expect(hooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should throw when the content is not parseable", () => {
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
        fileContent: "not json",
        validate: false,
      });

      expect(() => hooks.toRulesyncHooks()).toThrow(/Failed to parse Cortex Code hooks content/);
    });

    it("should round-trip through generate and import", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh", matcher: "edit|write", timeout: 5 },
            { type: "prompt", prompt: "Safe?", matcher: "bash" },
          ],
          stop: [{ type: "command", command: "stop.sh", enabled: false }],
        },
      });

      const hooks = await CortexcodeHooks.fromRulesyncHooks({
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
      expect(json.hooks.preToolUse?.[1]).toMatchObject({
        type: "prompt",
        prompt: "Safe?",
        matcher: "bash",
      });
      expect(json.hooks.stop?.[0]).toMatchObject({ command: "stop.sh", enabled: false });
    });
  });

  describe("isDeletable", () => {
    it("should return false because the files hold other user settings", () => {
      const hooks = new CortexcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an instance with an empty hooks block", () => {
      const hooks = CortexcodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".cortex",
        relativeFilePath: "settings.json",
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
