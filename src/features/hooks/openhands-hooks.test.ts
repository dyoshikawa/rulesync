import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OpenhandsHooks } from "./openhands-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function makeRulesyncHooks(config: unknown): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });
}

function makeOpenhandsHooks(content: unknown): OpenhandsHooks {
  return new OpenhandsHooks({
    outputRoot: "/mock",
    relativeDirPath: ".openhands",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(content),
    validate: false,
  });
}

describe("OpenhandsHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should use .openhands/hooks.json", () => {
    expect(OpenhandsHooks.getSettablePaths()).toEqual({
      relativeDirPath: ".openhands",
      relativeFilePath: "hooks.json",
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should write snake_case event keys without a wrapper", async () => {
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            sessionStart: [{ command: "echo start" }],
            sessionEnd: [{ command: "echo end" }],
            preToolUse: [{ command: ".openhands/hooks/block.sh", matcher: "Bash", timeout: 10 }],
            postToolUse: [{ command: "./log.sh", async: true }],
            beforeSubmitPrompt: [{ command: "echo prompt" }],
            stop: [{ command: "./lint.sh", timeout: 120 }],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        session_start: [{ hooks: [{ type: "command", command: "echo start" }] }],
        session_end: [{ hooks: [{ type: "command", command: "echo end" }] }],
        pre_tool_use: [
          {
            matcher: "terminal",
            hooks: [{ type: "command", command: ".openhands/hooks/block.sh", timeout: 10 }],
          },
        ],
        post_tool_use: [{ hooks: [{ type: "command", command: "./log.sh", async: true }] }],
        user_prompt_submit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
        stop: [{ hooks: [{ type: "command", command: "./lint.sh", timeout: 120 }] }],
      });
    });

    it("should skip unsupported events and non-command hooks", async () => {
      const logger = createMockLogger();
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preCompact: [{ command: "echo compact" }],
            stop: [{ type: "prompt", prompt: "Are you done?" }, { command: "echo stop" }],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      });
    });

    it.each([
      ["Bash", "terminal"],
      ["Write|Edit", "file_editor|apply_patch|write_file|edit|planning_file_editor"],
      ["MultiEdit", "file_editor|apply_patch|write_file|edit|planning_file_editor"],
      ["Read|Bash", "file_editor|read_file|planning_file_editor|terminal"],
      ["Glob|Grep|TodoWrite|Task|LS", "glob|grep|task_tracker|task|list_directory"],
      ["^Bash$", "^terminal$"],
      ["Edit.*", "(?:file_editor|apply_patch|write_file|edit|planning_file_editor).*"],
      ["github_.*", "github_.*"],
      ["*", "*"],
      ["terminal", "terminal"],
    ])("should translate the preToolUse matcher %s to %s", async (matcher, expected) => {
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          hooks: { preToolUse: [{ command: "./guard.sh", matcher }] },
        }),
      });

      expect(JSON.parse(hooks.getFileContent()).pre_tool_use[0].matcher).toBe(expected);
    });

    it("should fall back to the catch-all matcher for a preToolUse guard it cannot translate", async () => {
      const logger = createMockLogger();
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [
              { command: "./guard-web.sh", matcher: "Bash|WebFetch" },
              { command: "./guard-regex.sh", matcher: "Web.*" },
              { command: "./guard-mcp.sh", matcher: "mcp__github__.*" },
              { command: "./guard-mcp-tool.sh", matcher: "Bash|mcp__github__create_issue" },
            ],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent()).pre_tool_use).toEqual([
        {
          matcher: "*",
          hooks: [
            { type: "command", command: "./guard-web.sh" },
            { type: "command", command: "./guard-regex.sh" },
            { type: "command", command: "./guard-mcp.sh" },
            { type: "command", command: "./guard-mcp-tool.sh" },
          ],
        },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"*" matcher'));
    });

    it("should keep an untranslatable postToolUse matcher as written, with a warning", async () => {
      const logger = createMockLogger();
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: { postToolUse: [{ command: "./log.sh", matcher: "WebFetch" }] },
        }),
      });

      expect(JSON.parse(hooks.getFileContent()).post_tool_use[0].matcher).toBe("WebFetch");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not an OpenHands"));
    });

    it("should drop a matcher on a non-tool event with a warning", async () => {
      const logger = createMockLogger();
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: { stop: [{ command: "./lint.sh", matcher: "Bash" }] },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        stop: [{ hooks: [{ type: "command", command: "./lint.sh" }] }],
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not support matchers"),
      );
    });

    it("should round a fractional timeout up and keep the hook", async () => {
      const logger = createMockLogger();
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [{ command: "./guard.sh", matcher: "Bash", timeout: 1.5 }],
            stop: [{ command: "./b.sh", timeout: 30 }],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        pre_tool_use: [
          { matcher: "terminal", hooks: [{ type: "command", command: "./guard.sh", timeout: 2 }] },
        ],
        stop: [{ hooks: [{ type: "command", command: "./b.sh", timeout: 30 }] }],
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("whole number"));
    });

    it("should prefer the openhands override block for an event", async () => {
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          hooks: { stop: [{ command: "echo shared" }] },
          openhands: { hooks: { stop: [{ command: "echo openhands" }] } },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        stop: [{ hooks: [{ type: "command", command: "echo openhands" }] }],
      });
    });

    it("should replace the existing file by default", async () => {
      await writeFileContent(
        join(testDir, ".openhands", "hooks.json"),
        JSON.stringify({ stop: [{ hooks: [{ command: "./hand-written.sh" }] }] }),
      );
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({ hooks: { stop: [{ command: "echo stop" }] } }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      });
    });

    it("should keep hand-written handlers (PascalCase and wrapped) with preserveUnowned and not duplicate an imported one", async () => {
      await writeFileContent(
        join(testDir, ".openhands", "hooks.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "terminal",
                hooks: [{ type: "command", command: "./hand-written.sh" }],
              },
            ],
          },
        }),
      );
      const hooks = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        preserveUnowned: true,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [
              // Imported from the hand-written entry above.
              { type: "command", command: "./hand-written.sh", matcher: "Bash" },
              { command: "./generated.sh", matcher: "Bash" },
            ],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        pre_tool_use: [
          {
            matcher: "terminal",
            hooks: [
              { type: "command", command: "./hand-written.sh" },
              { type: "command", command: "./generated.sh" },
            ],
          },
        ],
      });
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import the native snake_case shape and translate tool names back", () => {
      const rulesyncHooks = makeOpenhandsHooks({
        pre_tool_use: [
          {
            matcher: "terminal",
            hooks: [{ type: "command", command: "./block.sh", timeout: 10 }],
          },
          { matcher: "file_editor", hooks: [{ command: "./edit-guard.sh" }] },
          { matcher: "apply_patch|write_file", hooks: [{ command: "./write-guard.sh" }] },
          { matcher: "/terminal|browser_.*/", hooks: [{ command: "./regex-guard.sh" }] },
        ],
        post_tool_use: [{ matcher: "*", hooks: [{ command: "./log.sh", async: true }] }],
        stop: [{ matcher: "*", hooks: [{ command: "./lint.sh", timeout: 120 }] }],
      }).toRulesyncHooks();

      expect(rulesyncHooks.getJson().hooks).toEqual({
        preToolUse: [
          { type: "command", command: "./block.sh", timeout: 10, matcher: "Bash" },
          { type: "command", command: "./edit-guard.sh", matcher: "Read|Write|Edit|MultiEdit" },
          { type: "command", command: "./write-guard.sh", matcher: "Write|Edit|MultiEdit" },
          { type: "command", command: "./regex-guard.sh", matcher: "Bash|browser_.*" },
        ],
        postToolUse: [{ type: "command", command: "./log.sh", async: true, matcher: "*" }],
        stop: [{ type: "command", command: "./lint.sh", timeout: 120 }],
      });
    });

    it("should skip a non-tool-event group whose matcher never runs in OpenHands", () => {
      const logger = createMockLogger();
      const rulesyncHooks = makeOpenhandsHooks({
        stop: [
          { matcher: "terminal", hooks: [{ command: "./never.sh" }] },
          { hooks: [{ command: "./always.sh" }] },
        ],
      }).toRulesyncHooks({ logger });

      expect(rulesyncHooks.getJson().hooks).toEqual({
        stop: [{ type: "command", command: "./always.sh" }],
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("never runs there"));
    });

    it("should accept PascalCase keys inside the hooks wrapper", () => {
      const rulesyncHooks = makeOpenhandsHooks({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "./ctx.sh" }] }],
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      }).toRulesyncHooks();

      expect(rulesyncHooks.getJson().hooks).toEqual({
        beforeSubmitPrompt: [{ type: "command", command: "./ctx.sh" }],
        sessionStart: [{ type: "command", command: "echo hi" }],
      });
    });

    it("should round-trip through generate", async () => {
      const source = {
        pre_tool_use: [{ matcher: "terminal", hooks: [{ type: "command", command: "./b.sh" }] }],
        stop: [{ hooks: [{ type: "command", command: "./lint.sh", timeout: 120 }] }],
      };
      const imported = makeOpenhandsHooks(source).toRulesyncHooks();
      const regenerated = await OpenhandsHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: imported,
      });

      expect(JSON.parse(regenerated.getFileContent())).toEqual(source);
    });
  });
});
