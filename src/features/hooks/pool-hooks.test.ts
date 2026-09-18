import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileContentIsEmptyPayload } from "../../utils/content-equivalence.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PoolHooks } from "./pool-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("PoolHooks", () => {
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

  const buildRulesyncHooks = (config: Record<string, unknown>): RulesyncHooks =>
    new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  const writeSettings = async ({
    content,
    global = false,
  }: {
    content: string;
    global?: boolean;
  }): Promise<string> => {
    const paths = PoolHooks.getSettablePaths({ global });
    const dir = join(testDir, paths.relativeDirPath);
    await ensureDir(dir);
    const filePath = join(dir, paths.relativeFilePath);
    await writeFileContent(filePath, content);
    return filePath;
  };

  describe("getSettablePaths", () => {
    it("should point to .poolside/settings.yaml in project mode", () => {
      expect(PoolHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });
    });

    it("should point to .config/poolside/settings.yaml in global mode", () => {
      expect(PoolHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "poolside"),
        relativeFilePath: "settings.yaml",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit flat entries with name, matcher, command and timeout per event", async () => {
      const logger = createMockLogger();
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preToolUse: [
              {
                type: "command",
                name: "block-sudo",
                matcher: "shell",
                command: ".poolside/hooks/block-sudo.sh",
                timeout: 10,
              },
              { command: "./hooks/log.sh", matcher: "*" },
              { type: "prompt", prompt: "Check the diff" },
            ],
            postToolUse: [{ command: "./hooks/after.sh", matcher: "shell|edit" }],
            beforeSubmitPrompt: [{ command: "./hooks/prompt.sh" }],
            preCompact: [{ command: "./hooks/compact.sh" }],
            sessionStart: [{ command: "./hooks/start.sh" }],
            stop: [{ command: "./hooks/stop.sh" }],
            sessionEnd: [{ command: "./hooks/end.sh" }],
          },
        }),
        logger,
      });

      expect(hooks.getSettings()).toEqual({
        hooks: {
          PreToolUse: [
            {
              name: "block-sudo",
              matcher: "shell",
              command: ".poolside/hooks/block-sudo.sh",
              timeout: 10,
            },
            { matcher: "*", command: "./hooks/log.sh" },
          ],
          PostToolUse: [{ matcher: "shell|edit", command: "./hooks/after.sh" }],
          UserPromptSubmit: [{ matcher: "*", command: "./hooks/prompt.sh" }],
          PreCompact: [{ matcher: "*", command: "./hooks/compact.sh" }],
          SessionStart: [{ matcher: "*", command: "./hooks/start.sh" }],
          Stop: [{ matcher: "*", command: "./hooks/stop.sh" }],
        },
      });
      // The prompt hook and the sessionEnd event are reported by the
      // HooksProcessor, not a second time here.
      expect(logger.warn).not.toHaveBeenCalled();
      expect(hooks.getFileContent()).toContain("- name: block-sudo\n");
    });

    it("should drop a matcher on an event Pool never tests it against", async () => {
      const logger = createMockLogger();
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { stop: [{ name: "audit", command: "./hooks/stop.sh", matcher: "shell" }] },
        }),
        logger,
      });

      expect(hooks.getSettings()).toEqual({
        hooks: { Stop: [{ name: "audit", matcher: "*", command: "./hooks/stop.sh" }] },
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Pool ignores "matcher" on "Stop"'),
      );
    });

    it("should warn about and skip a command hook without a command", async () => {
      const logger = createMockLogger();
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ type: "command", name: "broken" }, { command: "./ok.sh" }] },
        }),
        logger,
      });

      expect(hooks.getSettings()).toEqual({
        hooks: { PreToolUse: [{ matcher: "*", command: "./ok.sh" }] },
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"broken"'));
    });

    it("should round a fractional timeout up to whole seconds", async () => {
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./a.sh", timeout: 2.2 }] },
        }),
      });

      expect(hooks.getSettings()).toEqual({
        hooks: { PreToolUse: [{ matcher: "*", command: "./a.sh", timeout: 3 }] },
      });
    });

    it("should apply the pool override per event and pass its own events through", async () => {
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preToolUse: [{ command: "./shared.sh" }],
            stop: [{ command: "./shared-stop.sh" }],
          },
          pool: {
            hooks: {
              preToolUse: [{ command: "./pool-only.sh", matcher: "edit" }],
              Custom: [{ command: "./custom.sh" }],
            },
          },
        }),
      });

      expect(hooks.getSettings()).toEqual({
        hooks: {
          PreToolUse: [{ matcher: "edit", command: "./pool-only.sh" }],
          Stop: [{ matcher: "*", command: "./shared-stop.sh" }],
          Custom: [{ matcher: "*", command: "./custom.sh" }],
        },
      });
    });

    it("should preserve the other settings keys and the hooks block's non-event siblings", async () => {
      await writeSettings({
        content: [
          "pool:",
          "  model: gpt",
          "mcp_servers:",
          "  github:",
          "    command: gh-mcp",
          "hooks:",
          "  stop_hook_max_continuations: 2",
          "  PreToolUse:",
          "    - name: stale",
          "      matcher: '*'",
          "      command: ./stale.sh",
          "  Stop:",
          "    - matcher: '*'",
          "      command: ./old-stop.sh",
          "",
        ].join("\n"),
      });

      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./fresh.sh" }] },
        }),
      });

      expect(hooks.getSettings()).toEqual({
        pool: { model: "gpt" },
        mcp_servers: { github: { command: "gh-mcp" } },
        hooks: {
          stop_hook_max_continuations: 2,
          PreToolUse: [{ matcher: "*", command: "./fresh.sh" }],
        },
      });
    });

    it("should not create the settings file for an empty payload at either scope", async () => {
      for (const global of [false, true]) {
        const hooks = await PoolHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
          global,
        });
        expect(hooks.getSettings()).toEqual({ hooks: {} });
        expect(
          fileContentIsEmptyPayload({
            filePath: hooks.getFilePath(),
            content: hooks.getFileContent(),
          }),
        ).toBe(true);
        expect(hooks.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
        expect(hooks.isDeletable()).toBe(false);
      }
    });

    it("should write the user settings file in global mode", async () => {
      const hooks = await PoolHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { sessionStart: [{ command: "~/hooks/start.sh" }] },
        }),
        global: true,
      });

      expect(hooks.getFilePath()).toBe(join(testDir, ".config", "poolside", "settings.yaml"));
      expect(hooks.getSettings()).toEqual({
        hooks: { SessionStart: [{ matcher: "*", command: "~/hooks/start.sh" }] },
      });
    });

    it("should refuse to rewrite a settings file whose root is not a mapping", async () => {
      await writeSettings({ content: "- just\n- a list\n" });

      await expect(
        PoolHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({
            version: 1,
            hooks: { stop: [{ command: "./stop.sh" }] },
          }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read the project settings file", async () => {
      await writeSettings({
        content: "hooks:\n  Stop:\n    - matcher: '*'\n      command: ./stop.sh\n",
      });

      const hooks = await PoolHooks.fromFile({ outputRoot: testDir });

      expect(hooks.getSettings()).toEqual({
        hooks: { Stop: [{ matcher: "*", command: "./stop.sh" }] },
      });
    });

    it("should read an empty settings when the file is missing", async () => {
      const hooks = await PoolHooks.fromFile({ outputRoot: testDir, global: true });

      expect(hooks.getSettings()).toEqual({});
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map the event lists back to canonical command hooks", async () => {
      await writeSettings({
        content: [
          "hooks:",
          "  stop_hook_max_continuations: 1",
          "  PreToolUse:",
          "    - name: block-sudo",
          "      matcher: shell",
          "      command: ./block-sudo.sh",
          "      timeout: 10",
          "    - matcher: '*'",
          "      command: ./log.sh",
          "  PostToolUse:",
          "    - matcher: ''",
          "      command: ./after.sh",
          "  UserPromptSubmit:",
          "    - matcher: shell",
          "      command: ./prompt.sh",
          "  PreCompact:",
          "    - matcher: '*'",
          "      command: ./compact.sh",
          "  SessionStart:",
          "    - matcher: '*'",
          "      command: ./start.sh",
          "  Stop:",
          "    - matcher: '*'",
          "      command: ./stop.sh",
          "    - matcher: '*'",
          "      command: ''",
          "    - not-an-entry",
          "  Custom:",
          "    - matcher: '*'",
          "      command: ./custom.sh",
          "",
        ].join("\n"),
      });

      const hooks = await PoolHooks.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(hooks.toRulesyncHooks().getFileContent());

      expect(imported.hooks).toEqual({
        preToolUse: [
          {
            type: "command",
            name: "block-sudo",
            matcher: "shell",
            command: "./block-sudo.sh",
            timeout: 10,
          },
          { type: "command", command: "./log.sh" },
        ],
        postToolUse: [{ type: "command", command: "./after.sh" }],
        // Pool never tests the matcher on this event, so the value is noise.
        beforeSubmitPrompt: [{ type: "command", command: "./prompt.sh" }],
        preCompact: [{ type: "command", command: "./compact.sh" }],
        sessionStart: [{ type: "command", command: "./start.sh" }],
        stop: [{ type: "command", command: "./stop.sh" }],
      });
      expect(imported.pool).toEqual({
        hooks: { Custom: [{ type: "command", command: "./custom.sh" }] },
      });
    });

    it("should skip prototype-pollution event keys and a non-mapping hooks block", async () => {
      await writeSettings({
        content: [
          "hooks:",
          "  __proto__:",
          "    - matcher: '*'",
          "      command: ./evil.sh",
          "  constructor:",
          "    - matcher: '*'",
          "      command: ./evil.sh",
          "  Stop:",
          "    - matcher: '*'",
          "      command: ./stop.sh",
          "",
        ].join("\n"),
      });

      const hooks = await PoolHooks.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(hooks.toRulesyncHooks().getFileContent());

      expect(imported.hooks).toEqual({ stop: [{ type: "command", command: "./stop.sh" }] });
      expect(imported.pool).toBeUndefined();
      expect(Object.keys(imported)).not.toContain("__proto__");

      await writeSettings({ content: "hooks: nope\n" });
      const noHooks = await PoolHooks.fromFile({ outputRoot: testDir });
      expect(JSON.parse(noHooks.toRulesyncHooks().getFileContent()).hooks).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should build a well-formed instance for the never-deleted settings file", () => {
      const hooks = PoolHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".poolside",
        relativeFilePath: "settings.yaml",
      });

      expect(hooks.isDeletable()).toBe(false);
      expect(hooks.getSettings()).toEqual({});
    });
  });
});
