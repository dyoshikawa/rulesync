import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { TabnineHooks } from "./tabnine-hooks.js";

const settingsDir = join(".tabnine", "agent");

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

describe("TabnineHooks", () => {
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
    it("should return .tabnine/agent/settings.json for both scopes", () => {
      expect(TabnineHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
      });
      expect(TabnineHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit every supported event in Tabnine's PascalCase shape and drop the rest", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "start.sh" }],
          sessionEnd: [{ type: "command", command: "end.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          stop: [{ type: "command", command: "stop.sh" }],
          preModelInvocation: [{ type: "command", command: "before-model.sh" }],
          postModelInvocation: [{ type: "command", command: "after-model.sh" }],
          beforeToolSelection: [{ type: "command", command: "select.sh" }],
          preToolUse: [{ type: "command", command: "pre.sh", matcher: "write_file|replace" }],
          postToolUse: [{ type: "command", command: "post.sh" }],
          preCompact: [{ type: "command", command: "compact.sh" }],
          notification: [{ type: "command", command: "notify.sh" }],
          // Tabnine has no permission event.
          permissionRequest: [{ type: "command", command: "permission.sh" }],
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(tabnineHooks.getRelativeDirPath()).toBe(settingsDir);
      expect(tabnineHooks.getRelativeFilePath()).toBe("settings.json");
      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "AfterAgent",
        "AfterModel",
        "AfterTool",
        "BeforeAgent",
        "BeforeModel",
        "BeforeTool",
        "BeforeToolSelection",
        "Notification",
        "PreCompress",
        "SessionEnd",
        "SessionStart",
      ]);
      expect(parsed.hooks.BeforeTool).toEqual([
        {
          matcher: "write_file|replace",
          hooks: [{ type: "command", command: "pre.sh" }],
        },
      ]);
      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "start.sh" }] },
      ]);
    });

    it("should convert the canonical timeout from seconds to milliseconds", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { preToolUse: [{ type: "command", command: "pre.sh", timeout: 5 }] },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.BeforeTool[0].hooks[0].timeout).toBe(5000);
    });

    it("should carry name, description, env and sequential through", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: "command",
              command: "lint.sh",
              matcher: "write_file",
              name: "lint",
              description: "Lint on write",
              env: { CI: "1" },
              sequential: true,
            },
            { type: "command", command: "format.sh", matcher: "write_file" },
          ],
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.BeforeTool).toEqual([
        {
          matcher: "write_file",
          sequential: true,
          hooks: [
            {
              type: "command",
              command: "lint.sh",
              name: "lint",
              description: "Lint on write",
              env: { CI: "1" },
            },
            { type: "command", command: "format.sh" },
          ],
        },
      ]);
    });

    it("should drop unsafe env entries with a warning", async () => {
      const logger = createMockLogger();
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            {
              type: "command",
              command: "stop.sh",
              env: { "PATH=/tmp/evil": "x", OK: "yes", "": "empty" },
            },
          ],
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.AfterAgent[0].hooks[0].env).toEqual({ OK: "yes" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("PATH=/tmp/evil"));
    });

    it("should emit a canonical '*' matcher as no matcher", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { preToolUse: [{ type: "command", command: "pre.sh", matcher: "*" }] },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.BeforeTool).toEqual([
        { hooks: [{ type: "command", command: "pre.sh" }] },
      ]);
    });

    it("should skip non-command hook types and command hooks without a command", async () => {
      const logger = createMockLogger();
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            { type: "prompt", prompt: "Summarize" },
            { type: "command" },
            { type: "command", command: "stop.sh" },
          ],
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.AfterAgent).toEqual([
        { hooks: [{ type: "command", command: "stop.sh" }] },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("has no 'command'"));
    });

    it("should merge into an existing settings.json and keep unrelated keys", async () => {
      await ensureDir(join(testDir, settingsDir));
      await writeFileContent(
        join(testDir, settingsDir, "settings.json"),
        JSON.stringify({
          hooksConfig: { enabled: true, disabled: ["old"] },
          mcpServers: { fs: { command: "npx" } },
          hooks: { AfterAgent: [{ hooks: [{ type: "command", command: "stale.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "start.sh" }] },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooksConfig).toEqual({ enabled: true, disabled: ["old"] });
      expect(parsed.mcpServers).toEqual({ fs: { command: "npx" } });
      expect(parsed.hooks.SessionStart).toHaveLength(1);
      // The stale event is replaced because rulesync owns the whole `hooks` key.
      expect(parsed.hooks.AfterAgent).toBeUndefined();
    });

    it("should emit events from the tabnine override block on top of shared hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ command: "shared.sh" }] },
        tabnine: {
          hooks: {
            sessionStart: [{ command: "tabnine-only.sh" }],
          },
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(tabnineHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "tabnine-only.sh" }] },
      ]);
    });

    it("should throw when the existing settings.json is not parseable", async () => {
      await ensureDir(join(testDir, settingsDir));
      await writeFileContent(join(testDir, settingsDir, "settings.json"), "invalid json {");
      const rulesyncHooks = buildRulesyncHooks(testDir, { version: 1, hooks: {} });

      await expect(
        TabnineHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow(/Failed to parse shared config/);
    });
  });

  describe("fromFile", () => {
    it("should load .tabnine/agent/settings.json when it exists", async () => {
      await ensureDir(join(testDir, settingsDir));
      await writeFileContent(
        join(testDir, settingsDir, "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const tabnineHooks = await TabnineHooks.fromFile({ outputRoot: testDir, validate: false });
      expect(JSON.parse(tabnineHooks.getFileContent())).toEqual({ hooks: { SessionStart: [] } });
    });

    it("should initialize an empty hooks block when the file does not exist", async () => {
      const tabnineHooks = await TabnineHooks.fromFile({ outputRoot: testDir, validate: false });
      expect(JSON.parse(tabnineHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Tabnine PascalCase events to canonical camelCase with seconds timeouts", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            BeforeTool: [
              {
                matcher: "write_file|replace",
                sequential: true,
                hooks: [
                  {
                    type: "command",
                    command: "node validate.js",
                    name: "validate",
                    description: "Validate writes",
                    timeout: 5000,
                    env: { STRICT: "1" },
                  },
                ],
              },
            ],
            AfterAgent: [{ hooks: [{ type: "command", command: "audit.sh" }] }],
            PreCompress: [{ hooks: [{ type: "command", command: "save.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = tabnineHooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([
        {
          type: "command",
          command: "node validate.js",
          name: "validate",
          description: "Validate writes",
          timeout: 5,
          env: { STRICT: "1" },
          sequential: true,
          matcher: "write_file|replace",
        },
      ]);
      expect(json.hooks.stop?.[0]?.command).toBe("audit.sh");
      expect(json.hooks.preCompact?.[0]?.command).toBe("save.sh");
      expect(json.tabnine).toBeUndefined();
    });

    it("should skip hooks without a command type, as Tabnine does", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { command: "no-type.sh" },
                  { type: "prompt", prompt: "hi" },
                  { type: "command", command: "ok.sh" },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const json = tabnineHooks.toRulesyncHooks().getJson();
      expect(json.hooks.sessionStart).toEqual([{ type: "command", command: "ok.sh" }]);
    });

    it("should move unknown event keys into the tabnine override block", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: { FutureEvent: [{ hooks: [{ type: "command", command: "future.sh" }] }] },
        }),
        validate: false,
      });

      const json = tabnineHooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({});
      expect(json.tabnine?.hooks?.FutureEvent?.[0]?.command).toBe("future.sh");
    });

    it("should tolerate a settings file without a hooks key", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      expect(tabnineHooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });

    it("should throw when the content is not parseable", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: "not json",
        validate: false,
      });

      expect(() => tabnineHooks.toRulesyncHooks()).toThrow(
        /Failed to parse Tabnine CLI hooks content/,
      );
    });

    it("should round-trip through generate and import", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: "command",
              command: "pre.sh",
              matcher: "write_file",
              timeout: 2.5,
              env: { A: "b" },
              sequential: true,
            },
          ],
          stop: [{ type: "command", command: "stop.sh" }],
        },
      });

      const tabnineHooks = await TabnineHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });
      const json = tabnineHooks.toRulesyncHooks().getJson();

      expect(json.hooks.preToolUse?.[0]).toEqual({
        type: "command",
        command: "pre.sh",
        matcher: "write_file",
        timeout: 2.5,
        env: { A: "b" },
        sequential: true,
      });
      expect(json.hooks.stop?.[0]?.command).toBe("stop.sh");
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json holds other user settings", () => {
      const tabnineHooks = new TabnineHooks({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });

      expect(tabnineHooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an instance with an empty hooks block", () => {
      const tabnineHooks = TabnineHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: settingsDir,
        relativeFilePath: "settings.json",
      });

      expect(JSON.parse(tabnineHooks.getFileContent())).toEqual({ hooks: {} });
    });
  });
});
