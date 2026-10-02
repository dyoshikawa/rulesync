import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CODEBUDDY_HOOK_EVENTS, CODEBUDDY_MATCHER_HOOK_EVENTS } from "../../types/hooks.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodebuddyHooks } from "./codebuddy-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("CodebuddyHooks", () => {
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
    it("should return .codebuddy/settings.json for both scopes", () => {
      const expected = { relativeDirPath: ".codebuddy", relativeFilePath: "settings.json" };
      expect(CodebuddyHooks.getSettablePaths({ global: false })).toEqual(expected);
      expect(CodebuddyHooks.getSettablePaths({ global: true })).toEqual(expected);
    });
  });

  describe("event tables", () => {
    it("should accept a matcher on every event except the matcher-less ones", () => {
      expect(CODEBUDDY_MATCHER_HOOK_EVENTS).toContain("preToolUse");
      expect(CODEBUDDY_MATCHER_HOOK_EVENTS).toContain("sessionStart");
      expect(CODEBUDDY_MATCHER_HOOK_EVENTS).not.toContain("beforeSubmitPrompt");
      expect(CODEBUDDY_MATCHER_HOOK_EVENTS).not.toContain("stop");
      expect(CODEBUDDY_MATCHER_HOOK_EVENTS).not.toContain("postCompact");
      expect(CODEBUDDY_HOOK_EVENTS).toHaveLength(26);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit supported events in PascalCase and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "start.sh", matcher: "startup" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          preToolUse: [{ type: "command", command: "pre.sh", matcher: "Bash" }],
          postToolUse: [{ type: "command", command: "post.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          subagentStop: [{ type: "command", command: "subagent.sh" }],
          stop: [{ type: "command", command: "stop.sh" }],
          preCompact: [{ type: "command", command: "compact.sh" }],
          sessionEnd: [{ type: "command", command: "end.sh" }],
          worktreeCreate: [{ type: "command", command: "worktree.sh" }],
          // CodeBuddy documents neither a setup event nor model events.
          setup: [{ type: "command", command: "setup.sh" }],
          preModelInvocation: [{ type: "command", command: "model.sh" }],
        },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(hooks.getRelativeDirPath()).toBe(".codebuddy");
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(hooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "Notification",
        "PostToolUse",
        "PreCompact",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "SubagentStop",
        "UserPromptSubmit",
        "WorktreeCreate",
      ]);
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(parsed.hooks.SessionStart[0].matcher).toBe("startup");
      expect(parsed.hooks.PreToolUse[0].hooks[0]).toEqual({ type: "command", command: "pre.sh" });
    });

    it("should emit http and prompt hooks with continueOnBlock and skip unsupported hook types", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            { type: "command", command: "stop.sh", timeout: 30 },
            { type: "prompt", prompt: "Is the task done?", timeout: 20, continueOnBlock: true },
            { type: "http", url: "https://example.com/hook" },
            { type: "mcp_tool", server: "guard", tool: "check" },
          ],
        },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const emitted = parsed.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks);
      expect(emitted).toEqual([
        { type: "command", command: "stop.sh", timeout: 30 },
        { type: "prompt", prompt: "Is the task done?", timeout: 20, continueOnBlock: true },
        { type: "http", url: "https://example.com/hook" },
      ]);
    });

    it("should anchor dot-relative commands to $CODEBUDDY_PROJECT_DIR", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: ".rulesync/hooks/start.sh" },
            { command: "npx prettier --write ." },
          ],
        },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      const commands = parsed.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands).toEqual([
        '"$CODEBUDDY_PROJECT_DIR"/.rulesync/hooks/start.sh',
        "npx prettier --write .",
      ]);
    });

    it("should drop matchers on matcher-less events", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
        },
      });

      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const hooks = await CodebuddyHooks.fromRulesyncHooks({
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
      await ensureDir(join(testDir, ".codebuddy"));
      await writeFileContent(
        join(testDir, ".codebuddy", "settings.json"),
        JSON.stringify({
          model: "gpt-5",
          permissions: { allow: ["Bash(npm test)"] },
          hooks: { Stop: [{ hooks: [{ type: "command", command: "old.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { preToolUse: [{ command: "pre.sh" }] },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.model).toBe("gpt-5");
      expect(parsed.permissions).toEqual({ allow: ["Bash(npm test)"] });
      expect(Object.keys(parsed.hooks)).toEqual(["PreToolUse"]);
    });

    it("should emit events from the codebuddy override block", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "shared.sh" }] },
        codebuddy: { hooks: { sessionEnd: [{ command: "codebuddy-only.sh" }] } },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe("shared.sh");
      expect(parsed.hooks.SessionEnd[0].hooks[0].command).toBe("codebuddy-only.sh");
    });

    it("should write the same relative path in global mode", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ command: "stop.sh" }] },
      });

      const hooks = await CodebuddyHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(".codebuddy");
      expect(hooks.getRelativeFilePath()).toBe("settings.json");
      expect(JSON.parse(hooks.getFileContent()).hooks.Stop).toHaveLength(1);
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, ".codebuddy"));
      await writeFileContent(join(testDir, ".codebuddy", "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        CodebuddyHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse/);
    });
  });

  describe("fromFile", () => {
    it("should load .codebuddy/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".codebuddy"));
      const content = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      await writeFileContent(join(testDir, ".codebuddy", "settings.json"), content);

      const hooks = await CodebuddyHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(hooks.getFileContent()).toBe(content);
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const hooks = await CodebuddyHooks.fromFile({ outputRoot: testDir, validate: false });

      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert PascalCase events to canonical camelCase", () => {
      const hooks = new CodebuddyHooks({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          model: "gpt-5",
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
            PreToolUse: [
              {
                matcher: "Edit|Write",
                hooks: [{ type: "command", command: "pre.sh", timeout: 10 }],
              },
            ],
            Stop: [
              { hooks: [{ type: "prompt", prompt: "Done?", continueOnBlock: true, timeout: 30 }] },
            ],
            PostCompact: [{ hooks: [{ type: "command", command: "post-compact.sh" }] }],
            FutureEvent: [{ hooks: [{ type: "command", command: "future.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("prompt.sh");
      expect(json.hooks.preToolUse?.[0]).toMatchObject({
        command: "pre.sh",
        matcher: "Edit|Write",
        timeout: 10,
      });
      expect(json.hooks.stop?.[0]).toMatchObject({
        type: "prompt",
        prompt: "Done?",
        continueOnBlock: true,
        timeout: 30,
      });
      expect(json.hooks.postCompact?.[0]?.command).toBe("post-compact.sh");
      expect(json.codebuddy?.hooks?.FutureEvent).toHaveLength(1);
      expect((json as Record<string, unknown>).model).toBeUndefined();
    });

    it("should strip the $CODEBUDDY_PROJECT_DIR prefix on import", () => {
      const hooks = new CodebuddyHooks({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: '"$CODEBUDDY_PROJECT_DIR"/.rulesync/hooks/start.sh',
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
  });

  describe("isDeletable", () => {
    it("should return false because the files hold other user settings", () => {
      const hooks = new CodebuddyHooks({
        outputRoot: testDir,
        relativeDirPath: ".codebuddy",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(hooks.isDeletable()).toBe(false);
    });
  });
});
