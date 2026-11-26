import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { JcodeHooks } from "./jcode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });

const parseHooksTable = (content: string): Record<string, unknown> =>
  (smolToml.parse(content) as { hooks?: Record<string, unknown> }).hooks ?? {};

describe("JcodeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should target ~/.jcode/config.toml and never be deletable", () => {
    expect(JcodeHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".jcode",
      relativeFilePath: "config.toml",
    });
    const hooks = JcodeHooks.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".jcode",
      relativeFilePath: "config.toml",
      global: true,
    });
    expect(hooks.isDeletable()).toBe(false);
  });

  describe("fromRulesyncHooks", () => {
    it("should map canonical events to [hooks] keys, using a list for several hooks", async () => {
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            sessionStart: [{ command: "start-hook" }],
            sessionEnd: [{ command: "end-hook" }],
            preToolUse: [{ command: "policy-a" }, { command: "policy-b" }],
            postToolUse: [{ command: "audit" }],
            beforeSubmitPrompt: [{ command: "busy" }],
            stop: [{ command: "notify" }],
            subagentStop: [{ command: "unsupported" }],
          },
        }),
      });

      expect(parseHooksTable(hooks.getFileContent())).toEqual({
        session_start: "start-hook",
        session_end: "end-hook",
        pre_tool: ["policy-a", "policy-b"],
        post_tool: "audit",
        turn_start: "busy",
        turn_end: "notify",
      });
    });

    it("should widen a matcher-scoped preToolUse guard to every tool instead of dropping it", async () => {
      const logger = createMockLogger();
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        logger,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preToolUse: [
              { command: "guard-bash", matcher: "Bash" },
              { command: "all", matcher: "*" },
            ],
            sessionStart: [{ command: "start", matcher: "startup" }],
          },
        }),
      });

      expect(parseHooksTable(hooks.getFileContent())).toEqual({
        pre_tool: ["guard-bash", "all"],
        session_start: "start",
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((m) => m.includes('"Bash"') && m.includes("every tool call"))).toBe(
        true,
      );
      expect(warnings.some((m) => m.includes('"startup"') && m.includes("ignored"))).toBe(true);
      // The match-all matcher needs no warning.
      expect(warnings.filter((m) => m.includes("no matcher"))).toHaveLength(2);
    });

    it("should warn about shell syntax, timeouts and failClosed jcode cannot honor", async () => {
      const logger = createMockLogger();
      await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        logger,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preToolUse: [{ command: "a && b", timeout: 5, failClosed: true }],
          },
        }),
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((m) => m.includes("not through a shell"))).toBe(true);
      expect(warnings.some((m) => m.includes("per-hook timeout"))).toBe(true);
      expect(warnings.some((m) => m.includes("fail open"))).toBe(true);
    });

    it("should emit native-only keys from the jcode override block", async () => {
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { stop: [{ command: "shared-stop" }] },
          jcode: {
            hooks: {
              stop: [{ command: "jcode-stop" }],
              post_tool_feedback: [{ command: "vale-hook" }],
            },
          },
        }),
      });
      expect(parseHooksTable(hooks.getFileContent())).toEqual({
        turn_end: "jcode-stop",
        post_tool_feedback: "vale-hook",
      });
    });
  });

  describe("setFileContent", () => {
    it("should keep other settings, table settings and native-only keys this run does not author", async () => {
      const existing = [
        'model = "claude"',
        "",
        "[hooks]",
        'turn_end = "old-notify"',
        'post_tool_feedback = "~/bin/jcode-vale"',
        "pre_tool_timeout_ms = 5000",
        "",
        "[ui]",
        'theme = "dark"',
        "",
      ].join("\n");
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "policy" }] },
        }),
      });
      hooks.setFileContent(existing);

      const parsed = smolToml.parse(hooks.getFileContent()) as Record<string, unknown>;
      expect(parsed.model).toBe("claude");
      expect(parsed.ui).toEqual({ theme: "dark" });
      expect(parsed.hooks).toEqual({
        post_tool_feedback: "~/bin/jcode-vale",
        pre_tool_timeout_ms: 5000,
        pre_tool: "policy",
      });
    });

    it("should not duplicate a hand-written native-only key after import and generate", async () => {
      const existing = [
        "[hooks]",
        'post_tool_feedback = ["one", "two"]',
        'turn_end = "n"',
        "",
      ].join("\n");
      await writeFileContent(join(testDir, ".jcode", "config.toml"), existing);
      const imported = await JcodeHooks.fromFile({ outputRoot: testDir, global: true });
      const rulesyncHooks = imported.toRulesyncHooks();
      expect(rulesyncHooks.getJson()).toMatchObject({
        hooks: { stop: [{ type: "command", command: "n" }] },
        jcode: {
          hooks: {
            post_tool_feedback: [
              { type: "command", command: "one" },
              { type: "command", command: "two" },
            ],
          },
        },
      });

      const regenerated = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks,
      });
      regenerated.setFileContent(existing);
      expect(parseHooksTable(regenerated.getFileContent())).toEqual({
        post_tool_feedback: ["one", "two"],
        turn_end: "n",
      });
    });

    it("should retract owned keys and drop an emptied [hooks] table", async () => {
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
      });
      hooks.setFileContent('model = "x"\n\n[hooks]\nturn_end = "gone"\n');
      expect(smolToml.parse(hooks.getFileContent())).toEqual({ model: "x" });
    });

    it("should refuse an unparseable config instead of replacing it", async () => {
      const hooks = await JcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        global: true,
        rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
      });
      expect(() => hooks.setFileContent("not = = toml")).toThrow();
    });
  });
});
