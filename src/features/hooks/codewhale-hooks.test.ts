import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleHooks } from "./codewhale-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });

type ParsedEntries = Array<Record<string, unknown>>;

describe("CodewhaleHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getSettablePaths", () => {
    it("should target .codewhale/hooks.toml in project scope and config.toml globally", () => {
      expect(CodewhaleHooks.getSettablePaths()).toEqual({
        relativeDirPath: ".codewhale",
        relativeFilePath: "hooks.toml",
      });
      expect(CodewhaleHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".codewhale",
        relativeFilePath: "config.toml",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should map events, matchers and options to top-level [[hooks]] entries", async () => {
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            sessionStart: [{ command: "echo start", matcher: "ignored" }],
            preToolUse: [
              { command: "guard", matcher: "exec_shell", timeout: 10, name: "guard" },
              { command: "multi", matcher: "write_file|edit_*" },
              { command: "all", matcher: "*" },
            ],
            stop: [{ command: "echo end", background: true, continue_on_error: false }],
          },
        }),
      });

      const parsed = smolToml.parse(hooks.getFileContent()) as { hooks: ParsedEntries };
      expect(parsed.hooks).toEqual([
        { event: "session_start", command: "echo start" },
        {
          event: "tool_call_before",
          command: "guard",
          name: "guard",
          condition: { type: "tool_name", name: "exec_shell" },
          timeout_secs: 10,
        },
        {
          event: "tool_call_before",
          command: "multi",
          condition: {
            type: "any",
            conditions: [
              { type: "tool_name", name: "write_file" },
              { type: "tool_name", name: "edit_*" },
            ],
          },
        },
        { event: "tool_call_before", command: "all" },
        { event: "turn_end", command: "echo end", background: true, continue_on_error: false },
      ]);
    });

    it("should skip a hook whose matcher is a regex rather than widening it", async () => {
      const logger = createMockLogger();
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "guard", matcher: "^Bash(.*)$" }] },
        }),
        logger,
      });

      const parsed = smolToml.parse(hooks.getFileContent()) as { hooks: ParsedEntries };
      expect(parsed.hooks).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipping"));
    });

    it("should drop unsupported events, non-command hooks and invalid timeouts", async () => {
      const logger = createMockLogger();
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preCompact: [{ command: "echo compact" }],
            postToolUse: [
              { type: "prompt", prompt: "summarize" },
              { command: "echo after", timeout: 1.5 },
            ],
          },
        }),
        logger,
      });

      const parsed = smolToml.parse(hooks.getFileContent()) as { hooks: ParsedEntries };
      expect(parsed.hooks).toEqual([{ event: "tool_call_after", command: "echo after" }]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("omitting the timeout"));
    });

    it("should combine a matcher with a raw condition from the codewhale override", async () => {
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {},
          codewhale: {
            hooks: {
              preToolUse: [
                {
                  command: "guard",
                  matcher: "exec_shell",
                  condition: { type: "mode", mode: "agent" },
                },
              ],
            },
          },
        }),
      });

      const parsed = smolToml.parse(hooks.getFileContent()) as { hooks: ParsedEntries };
      expect(parsed.hooks[0]?.condition).toEqual({
        type: "all",
        conditions: [
          { type: "tool_name", name: "exec_shell" },
          { type: "mode", mode: "agent" },
        ],
      });
    });

    it("should nest entries under [hooks] in global scope", async () => {
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { stop: [{ command: "echo end" }] },
        }),
        global: true,
      });

      expect(smolToml.parse(hooks.getFileContent())).toEqual({
        hooks: { hooks: [{ event: "turn_end", command: "echo end" }] },
      });
      expect(hooks.isDeletable()).toBe(false);
      expect(hooks.shouldMergeExistingFileContent()).toBe(true);
    });
  });

  describe("setFileContent (global)", () => {
    it("should keep unrelated settings and the [hooks] table settings", async () => {
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { stop: [{ command: "echo new" }] },
        }),
        global: true,
      });

      hooks.setFileContent(
        [
          'model = "deepseek-chat"',
          "",
          "[hooks]",
          "enabled = false",
          "default_timeout_secs = 20",
          "",
          "[[hooks.hooks]]",
          'event = "session_start"',
          'command = "echo old"',
        ].join("\n"),
      );

      expect(smolToml.parse(hooks.getFileContent())).toEqual({
        model: "deepseek-chat",
        hooks: {
          enabled: false,
          default_timeout_secs: 20,
          hooks: [{ event: "turn_end", command: "echo new" }],
        },
      });
    });

    it("should leave project content untouched", async () => {
      const hooks = await CodewhaleHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
      });

      hooks.setFileContent("hooks = []\n");

      expect(hooks.getFileContent()).toBe("hooks = []\n");
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import project hooks back to canonical events and matchers", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "hooks.toml"),
        [
          "[[hooks]]",
          'event = "tool_call_before"',
          'command = "guard"',
          "timeout_secs = 5",
          'condition = { type = "any", conditions = [{ type = "tool_name", name = "exec_shell" }, { type = "tool_name", name = "write_file" }] }',
          "",
          "[[hooks]]",
          'event = "tool_call_after"',
          'command = "check"',
          'condition = { type = "exit_code", code = 1 }',
          "",
          "[[hooks]]",
          'event = "mode_change"',
          'command = "echo mode"',
          "",
          "[[hooks]]",
          'event = "__proto__"',
          'command = "evil"',
        ].join("\n"),
      );

      const hooks = await CodewhaleHooks.fromFile({ outputRoot: testDir });
      const json = hooks.toRulesyncHooks().getJson();

      expect(json.hooks.preToolUse).toEqual([
        { type: "command", command: "guard", matcher: "exec_shell|write_file", timeout: 5 },
      ]);
      expect(json.hooks.postToolUse).toEqual([
        { type: "command", command: "check", condition: { type: "exit_code", code: 1 } },
      ]);
      expect(json.codewhale?.hooks?.mode_change).toEqual([
        { type: "command", command: "echo mode" },
      ]);
      expect(Object.prototype.hasOwnProperty.call(json.hooks, "__proto__")).toBe(false);
    });

    it("should import global hooks from the [hooks] table", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "config.toml"),
        ['model = "x"', "", "[[hooks.hooks]]", 'event = "turn_end"', 'command = "echo end"'].join(
          "\n",
        ),
      );

      const hooks = await CodewhaleHooks.fromFile({ outputRoot: testDir, global: true });

      expect(hooks.toRulesyncHooks().getJson().hooks.stop).toEqual([
        { type: "command", command: "echo end" },
      ]);
    });
  });
});
