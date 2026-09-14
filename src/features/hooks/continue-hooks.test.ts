import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ContinueHooks } from "./continue-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("ContinueHooks", () => {
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
    it("should return .continue/settings.json for both scopes", () => {
      expect(ContinueHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
      });
      expect(ContinueHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit the seventeen supported events in PascalCase and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "pre-tool.sh", matcher: "Bash" }],
          postToolUse: [{ type: "command", command: "post-tool.sh" }],
          postToolUseFailure: [{ type: "command", command: "failure.sh" }],
          permissionRequest: [{ type: "command", command: "permission.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          sessionStart: [{ type: "command", command: "session-start.sh" }],
          sessionEnd: [{ type: "command", command: "session-end.sh" }],
          stop: [{ type: "command", command: "audit.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          subagentStart: [{ type: "command", command: "subagent-start.sh" }],
          subagentStop: [{ type: "command", command: "subagent-stop.sh" }],
          preCompact: [{ type: "command", command: "compact.sh" }],
          configChange: [{ type: "command", command: "config.sh" }],
          teammateIdle: [{ type: "command", command: "idle.sh" }],
          taskCompleted: [{ type: "command", command: "task.sh" }],
          worktreeCreate: [{ type: "command", command: "wt-create.sh" }],
          worktreeRemove: [{ type: "command", command: "wt-remove.sh" }],
          // Continue has no model or setup events.
          preModelInvocation: [{ type: "command", command: "model.sh" }],
          setup: [{ type: "command", command: "setup.sh" }],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(hooks.getRelativeDirPath()).toBe(".continue");
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(hooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "ConfigChange",
        "Notification",
        "PermissionRequest",
        "PostToolUse",
        "PostToolUseFailure",
        "PreCompact",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "TaskCompleted",
        "TeammateIdle",
        "UserPromptSubmit",
        "WorktreeCreate",
        "WorktreeRemove",
      ]);
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(parsed.hooks.PreToolUse[0].hooks[0]).toMatchObject({
        type: "command",
        command: "pre-tool.sh",
      });
      expect(parsed.hooks.WorktreeRemove[0].hooks[0].command).toBe("wt-remove.sh");
    });

    it("should carry over timeout, statusMessage, once and async on command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            {
              type: "command",
              command: "audit.sh",
              timeout: 30,
              statusMessage: "Auditing",
              once: true,
              async: true,
            },
          ],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: "command",
        command: "audit.sh",
        timeout: 30,
        statusMessage: "Auditing",
        once: true,
        async: true,
      });
    });

    it("should emit http, prompt and agent hooks and skip unsupported hook types", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh" },
            { type: "prompt", prompt: "Is this command safe? $ARGUMENTS", model: "haiku" },
            {
              type: "http",
              url: "https://example.com/hook",
              headers: { "X-Token": "t" },
              allowedEnvVars: ["HOME"],
            },
            { type: "agent", prompt: "Verify the change", timeout: 60 },
            { type: "mcp_tool", server: "s", tool: "t" },
          ],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const emitted = parsed.hooks.PreToolUse.flatMap((group: { hooks: unknown[] }) => group.hooks);
      expect(emitted).toEqual([
        { type: "command", command: "pre.sh" },
        { type: "prompt", prompt: "Is this command safe? $ARGUMENTS", model: "haiku" },
        {
          type: "http",
          url: "https://example.com/hook",
          headers: { "X-Token": "t" },
          allowedEnvVars: ["HOME"],
        },
        { type: "agent", prompt: "Verify the change", timeout: 60 },
      ]);
    });

    it("should not emit async on non-command hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [{ type: "prompt", prompt: "Done?", async: true, once: true }],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: "prompt",
        prompt: "Done?",
        once: true,
      });
    });

    it("should anchor dot-relative commands to $CONTINUE_PROJECT_DIR", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: ".rulesync/hooks/start.sh" },
            { command: "npx prettier --write ." },
          ],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const commands = parsed.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toEqual([
        '"$CONTINUE_PROJECT_DIR"/.rulesync/hooks/start.sh',
        "npx prettier --write .",
      ]);
    });

    it("should drop matchers on the events the CLI fires unconditionally", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
          teammateIdle: [{ command: "idle.sh", matcher: "x" }],
          taskCompleted: [{ command: "task.sh", matcher: "x" }],
          worktreeCreate: [{ command: "create.sh", matcher: "x" }],
          worktreeRemove: [{ command: "remove.sh", matcher: "x" }],
          sessionStart: [{ command: "start.sh", matcher: "startup" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      for (const event of [
        "UserPromptSubmit",
        "Stop",
        "TeammateIdle",
        "TaskCompleted",
        "WorktreeCreate",
        "WorktreeRemove",
      ]) {
        expect(parsed.hooks[event][0].matcher).toBeUndefined();
      }
      expect(parsed.hooks.SessionStart[0].matcher).toBe("startup");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, ".continue"));
      await writeFileContent(
        join(testDir, ".continue", "settings.json"),
        JSON.stringify({
          model: "claude-sonnet-4-5",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
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

    it("should emit events from the continue override block verbatim", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {},
        continue: {
          hooks: {
            sessionStart: [{ command: "continue-only.sh" }],
          },
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(JSON.stringify(parsed.hooks.SessionStart)).toContain("continue-only.sh");
    });

    it("should write to .continue/settings.json under the home directory in global mode", async () => {
      await ensureDir(join(testDir, ".continue"));
      await writeFileContent(
        join(testDir, ".continue", "settings.json"),
        JSON.stringify({ custom: true, hooks: {} }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(".continue");
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.custom).toBe(true);
      expect(parsed.hooks).toEqual({
        Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
      });
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, ".continue"));
      await writeFileContent(join(testDir, ".continue", "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        ContinueHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .continue/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".continue"));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, ".continue", "settings.json"), content);

      const hooks = await ContinueHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(hooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const hooks = await ContinueHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert PascalCase events to canonical camelCase", () => {
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          model: "claude-sonnet-4-5",
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "session-start.sh" }] }],
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  { type: "command", command: "pre.sh", timeout: 10, async: true, once: true },
                ],
              },
            ],
            PermissionRequest: [
              { hooks: [{ type: "prompt", prompt: "Allow? $ARGUMENTS", timeout: 30 }] },
            ],
            PostToolUseFailure: [
              { hooks: [{ type: "http", url: "https://example.com/hook", timeout: 5 }] },
            ],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
            WorktreeCreate: [{ hooks: [{ type: "agent", prompt: "Set up", model: "sonnet" }] }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.sessionStart?.[0]?.command).toBe("session-start.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Bash",
        timeout: 10,
        async: true,
        once: true,
      });
      expect(json.hooks.permissionRequest?.[0]).toMatchObject({
        type: "prompt",
        prompt: "Allow? $ARGUMENTS",
        timeout: 30,
      });
      expect(json.hooks.postToolUseFailure?.[0]).toMatchObject({
        type: "http",
        url: "https://example.com/hook",
        timeout: 5,
      });
      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("prompt.sh");
      expect(json.hooks.worktreeCreate?.[0]).toMatchObject({
        type: "agent",
        prompt: "Set up",
        model: "sonnet",
      });
      // Sibling settings keys must not leak into the canonical model.
      expect((json as Record<string, unknown>).model).toBeUndefined();
    });

    it("should move unknown event keys into the continue override block", () => {
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
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
      expect(json.continue?.hooks?.FutureEvent).toHaveLength(1);
    });

    it("should strip the $CONTINUE_PROJECT_DIR prefix on import", () => {
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: '"$CONTINUE_PROJECT_DIR"/.rulesync/hooks/start.sh' },
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
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ model: "x" }),
        validate: false,
      });

      expect(hooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should throw when the content is not parseable", () => {
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
        fileContent: "not json",
        validate: false,
      });

      expect(() => hooks.toRulesyncHooks()).toThrow(/Failed to parse Continue hooks content/);
    });

    it("should round-trip through generate and import", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "pre.sh", matcher: "Edit|Write", timeout: 5 },
            { type: "prompt", prompt: "Safe?", matcher: "Bash", model: "haiku" },
          ],
          stop: [{ type: "command", command: "stop.sh", statusMessage: "Stopping", once: true }],
        },
      });

      const hooks = await ContinueHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Edit|Write",
        timeout: 5,
      });
      expect(json.hooks.preToolUse?.[1]).toMatchObject({
        type: "prompt",
        prompt: "Safe?",
        matcher: "Bash",
        model: "haiku",
      });
      expect(json.hooks.stop?.[0]).toMatchObject({
        command: "stop.sh",
        statusMessage: "Stopping",
        once: true,
      });
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json holds other user settings", () => {
      const hooks = new ContinueHooks({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an instance with an empty hooks block", () => {
      const hooks = ContinueHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".continue",
        relativeFilePath: "settings.json",
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
