import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContentOrNull, writeFileContent } from "../../utils/file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { VibeHooks } from "./vibe-hooks.js";

function createMockAiFileParams(
  override: Partial<ConstructorParameters<typeof RulesyncHooks>[0]> = {},
) {
  return {
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: "{}",
    ...override,
  };
}

describe("VibeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getSettablePaths", () => {
    it("should target .vibe/hooks.toml", () => {
      const paths = VibeHooks.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".vibe");
      expect(paths.relativeFilePath).toBe("hooks.toml");
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to a Vibe [[hooks]] TOML array with snake_case events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                {
                  command: "uv run python ./guard-bash",
                  matcher: "bash",
                  timeout: 30,
                  name: "deny-rm-rf",
                  description: "Reject dangerous shell commands.",
                },
              ],
              postToolUse: [{ command: "echo done", matcher: "re:^serena_.*$" }],
              stop: [{ command: "echo turn-end" }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(parsed.hooks)).toBe(true);

      const byType = Object.fromEntries(parsed.hooks.map((h) => [h.type, h]));
      expect(byType.pre_tool).toBeDefined();
      // A canonical shell matcher also catches background commands (`process_start`).
      expect(byType.pre_tool.match).toBe("re:bash|process_start");
      expect(byType.pre_tool.command).toBe("uv run python ./guard-bash");
      expect(byType.pre_tool.timeout).toBe(30);
      expect(byType.pre_tool.name).toBe("deny-rm-rf");
      expect(byType.pre_tool.description).toBe("Reject dangerous shell commands.");

      expect(byType.post_tool).toBeDefined();
      expect(byType.post_tool.match).toBe("re:^serena_.*$");

      expect(byType.post_agent).toBeDefined();
      // Canonical `stop` is main-agent-only; a bare post_agent would also run
      // after every subagent (Vibe v3.0.2+).
      expect(byType.post_agent.match).toBe("main");
    });

    it("should scope canonical stop to the main agent even when it carries a matcher", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: { stop: [{ command: "./check", matcher: "reviewer" }] },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toEqual([
        { name: "post_agent-0", type: "post_agent", match: "main", command: "./check" },
      ]);
    });

    it("should write subagentStop as post_agent matched on the subagent name", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              stop: [{ command: "./main-check" }],
              subagentStop: [
                { command: "make check", matcher: "reviewer", name: "after-reviewer" },
                { command: "./unnamed", matcher: "explorer" },
              ],
            },
          }),
        }),
      );
      const logger = createMockLogger();

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        logger,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toEqual([
        { name: "post_agent-0", type: "post_agent", match: "main", command: "./main-check" },
        { name: "after-reviewer", type: "post_agent", match: "reviewer", command: "make check" },
        // Numbered after the stop entry, so the two generated names stay distinct.
        { name: "post_agent-2", type: "post_agent", match: "explorer", command: "./unnamed" },
      ]);
      expect(logger.warn).not.toHaveBeenCalled();

      const imported = vibeHooks.toRulesyncHooks().getJson().hooks;
      expect(imported.stop).toEqual([
        { type: "command", command: "./main-check", name: "post_agent-0" },
      ]);
      expect(imported.subagentStop).toEqual([
        { type: "command", command: "make check", matcher: "reviewer", name: "after-reviewer" },
        { type: "command", command: "./unnamed", matcher: "explorer", name: "post_agent-2" },
      ]);
    });

    it.each([undefined, "", "*", "main", "MAIN"])(
      "should skip a subagentStop hook with matcher %s and warn",
      async (matcher) => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              hooks: { subagentStop: [{ command: "./check", matcher }] },
            }),
          }),
        );
        const logger = createMockLogger();

        const vibeHooks = await VibeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          logger,
        });

        const parsed = smolToml.parse(vibeHooks.getFileContent()) as { hooks?: unknown[] };
        expect(parsed.hooks ?? []).toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("subagentStop"));
      },
    );

    it.each(["Bash", "bash", "BASH"])(
      "should widen the canonical %s matcher to catch background commands",
      async (matcher) => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              hooks: { preToolUse: [{ command: "./guard", matcher }] },
            }),
          }),
        );

        const vibeHooks = await VibeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
        });

        const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
          hooks: Array<Record<string, unknown>>;
        };
        expect(parsed.hooks[0]?.match).toBe("re:bash|process_start");
        expect(vibeHooks.toRulesyncHooks().getJson().hooks.preToolUse?.[0]?.matcher).toBe("Bash");
      },
    );

    it("should keep any other matcher verbatim, including a broader shell regex", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                { command: "./a", matcher: "bash*" },
                { command: "./b", matcher: "re:bash|process_start|git_bash" },
              ],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks.map((hook) => hook.match)).toEqual([
        "bash*",
        "re:bash|process_start|git_bash",
      ]);
    });

    it("should drop unsupported events and non-command hook types", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              permissionRequest: [{ command: "echo approve" }],
              preToolUse: [
                { type: "command", command: "echo keep" },
                { type: "prompt", command: "summarize" },
              ],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]?.type).toBe("pre_tool");
      expect(parsed.hooks[0]?.command).toBe("echo keep");
    });

    it("should carry through the strict flag for tool hooks", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo guard", strict: true }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks[0]?.strict).toBe(true);
    });

    it("should map the v3.1 hook types and pass their matchers through", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              beforeSubmitPrompt: [{ command: "echo prompt", strict: true }],
              sessionStart: [{ command: "echo start", matcher: "resume" }],
              sessionEnd: [{ command: "echo end" }],
              notification: [{ command: "echo notify", matcher: "approval_requested" }],
              preModelInvocation: [{ command: "echo pre-llm", strict: true }],
              postModelInvocation: [{ command: "echo post-llm", matcher: "reviewer" }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toEqual([
        // `pre_agent` also runs before subagent turns, so the prompt hook is
        // scoped to the main agent.
        {
          name: "pre_agent-0",
          type: "pre_agent",
          match: "main",
          command: "echo prompt",
          strict: true,
        },
        { name: "session_start-0", type: "session_start", match: "resume", command: "echo start" },
        { name: "session_end-0", type: "session_end", command: "echo end" },
        {
          name: "notification-0",
          type: "notification",
          match: "approval_requested",
          command: "echo notify",
        },
        { name: "pre_llm-0", type: "pre_llm", command: "echo pre-llm", strict: true },
        { name: "post_llm-0", type: "post_llm", match: "reviewer", command: "echo post-llm" },
      ]);
    });

    it("should drop strict on hook types Vibe rejects it for", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              stop: [{ command: "echo stop", strict: true }],
              sessionStart: [{ command: "echo start", strict: true }],
              notification: [{ command: "echo notify", strict: false }],
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(3);
      for (const hook of parsed.hooks) {
        expect(hook).not.toHaveProperty("strict");
      }
    });

    it("should apply tool-specific vibe overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [{ command: "echo shared" }],
            },
            vibe: {
              hooks: {
                preToolUse: [{ command: "echo override" }],
              },
            },
          }),
        }),
      );

      const vibeHooks = await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
      expect(parsed.hooks[0]?.command).toBe("echo override");
    });

    it("should not write config.toml as a side effect", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({ hooks: { preToolUse: [{ command: "echo x" }] } }),
        }),
      );

      await VibeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const configContent = await readFileContentOrNull(join(testDir, ".vibe", "config.toml"));
      expect(configContent).toBeNull();
    });

    describe("backslash in command", () => {
      // Vibe v2.25.1 to v2.25.4 skipped a hook whose command contained a
      // backslash; v2.25.5 removed that skip and runs hook commands through
      // the shell again, so the command is written verbatim without a warning.
      it("should write a backslash command verbatim without warning", async () => {
        const logger = createMockLogger();
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              hooks: {
                preToolUse: [
                  { name: "win-guard", command: "python C:\\tools\\guard.py", matcher: "bash" },
                ],
                stop: [{ command: "grep -q '\\.ts$' changed.txt" }],
              },
            }),
          }),
        );

        const vibeHooks = await VibeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: true,
          logger,
        });

        const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
          hooks: Array<Record<string, unknown>>;
        };
        expect(parsed.hooks).toHaveLength(2);
        expect(parsed.hooks[0]?.command).toBe("python C:\\tools\\guard.py");
        expect(parsed.hooks[1]?.command).toBe("grep -q '\\.ts$' changed.txt");
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("toRulesyncHooks (round-trip import)", () => {
    it("should convert a Vibe hooks.toml back to canonical hooks", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          {
            name: "deny-rm-rf",
            type: "pre_tool",
            match: "bash",
            command: "uv run python ./guard-bash",
            timeout: 60,
            strict: false,
            description: "Reject dangerous shell commands.",
          },
          { name: "turn", type: "post_agent", match: "*", command: "echo done" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({
        type: "command",
        command: "uv run python ./guard-bash",
        matcher: "bash",
        timeout: 60,
        name: "deny-rm-rf",
        description: "Reject dangerous shell commands.",
      });
      // A wildcard "*" matcher round-trips to no matcher.
      expect(parsed.hooks.stop?.[0]).toMatchObject({
        type: "command",
        command: "echo done",
      });
      expect(parsed.hooks.stop?.[0]?.matcher).toBeUndefined();
    });

    it("should import the v3.1 hook types with their matchers", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          {
            name: "prompt",
            type: "pre_agent",
            match: "main",
            command: "echo prompt",
            strict: true,
          },
          { name: "review-prompt", type: "pre_agent", match: "reviewer", command: "echo review" },
          { name: "start", type: "session_start", match: "startup", command: "echo start" },
          { name: "end", type: "session_end", command: "echo end" },
          { name: "notify", type: "notification", match: "*", command: "echo notify" },
          { name: "pre", type: "pre_llm", command: "echo pre-llm" },
          { name: "post", type: "post_llm", match: "bash", command: "echo post-llm" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.beforeSubmitPrompt).toEqual([
        { type: "command", command: "echo prompt", name: "prompt", strict: true },
        { type: "command", command: "echo review", name: "review-prompt", matcher: "reviewer" },
      ]);
      expect(parsed.hooks.sessionStart).toEqual([
        { type: "command", command: "echo start", name: "start", matcher: "startup" },
      ]);
      expect(parsed.hooks.sessionEnd).toEqual([
        { type: "command", command: "echo end", name: "end" },
      ]);
      expect(parsed.hooks.notification).toEqual([
        { type: "command", command: "echo notify", name: "notify" },
      ]);
      expect(parsed.hooks.preModelInvocation).toEqual([
        { type: "command", command: "echo pre-llm", name: "pre" },
      ]);
      // An agent match is not a tool name, so `bash` is not lifted to `Bash`.
      expect(parsed.hooks.postModelInvocation).toEqual([
        { type: "command", command: "echo post-llm", name: "post", matcher: "bash" },
      ]);
    });

    it("should import post_agent by its agent match: main or none as stop, others as subagentStop", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          { name: "a", type: "post_agent", command: "./a" },
          { name: "b", type: "post_agent", match: "main", command: "./b" },
          { name: "c", type: "post_agent", match: "reviewer", command: "./c" },
        ],
      });
      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.stop).toEqual([
        { type: "command", command: "./a", name: "a" },
        { type: "command", command: "./b", name: "b" },
      ]);
      expect(parsed.hooks.subagentStop).toEqual([
        { type: "command", command: "./c", matcher: "reviewer", name: "c" },
      ]);
      expect(parsed.vibe).toBeUndefined();
    });

    it.each(["re:review.*", "review*"])(
      "should keep subagentStop hooks in the vibe override when a post_agent match is the pattern %s",
      async (pattern) => {
        const fileContent = smolToml.stringify({
          hooks: [
            { name: "a", type: "post_agent", match: "main", command: "./a" },
            { name: "c", type: "post_agent", match: "reviewer", command: "./c" },
            { name: "d", type: "post_agent", match: pattern, command: "./d" },
          ],
        });
        const vibeHooks = new VibeHooks(
          createMockAiFileParams({
            relativeDirPath: ".vibe",
            relativeFilePath: "hooks.toml",
            fileContent,
          }),
        );
        const logger = createMockLogger();

        const imported = vibeHooks.toRulesyncHooks({ logger });
        const parsed = imported.getJson();
        expect(parsed.hooks.stop).toEqual([{ type: "command", command: "./a", name: "a" }]);
        expect(parsed.hooks.subagentStop).toBeUndefined();
        expect(parsed.vibe?.hooks?.subagentStop).toEqual([
          { type: "command", command: "./c", matcher: "reviewer", name: "c" },
          { type: "command", command: "./d", matcher: pattern, name: "d" },
        ]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("vibe override"));

        // The override regenerates the same entries.
        const regenerated = await VibeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: imported,
        });
        const toml = smolToml.parse(regenerated.getFileContent()) as {
          hooks: Array<Record<string, unknown>>;
        };
        expect(toml.hooks.map((hook) => hook.match)).toEqual(["main", "reviewer", pattern]);
      },
    );

    it("should read the pre-2.21.0 event spellings and emit the renamed ones", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          { name: "guard", type: "before_tool", match: "bash", command: "./guard" },
          { name: "audit", type: "after_tool", match: "bash", command: "./audit" },
          { name: "turn", type: "post_agent_turn", command: "echo done" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({ command: "./guard", matcher: "bash" });
      expect(parsed.hooks.postToolUse?.[0]).toMatchObject({ command: "./audit", matcher: "bash" });
      expect(parsed.hooks.stop?.[0]).toMatchObject({ command: "echo done" });
      // The legacy names must not survive into a tool override block.
      expect(parsed.hooks.vibe).toBeUndefined();
    });

    it("should drop a prototype-pollution event name instead of keying by a prototype member", () => {
      const fileContent = smolToml.stringify({
        hooks: [
          { name: "crafted", type: "__proto__", command: "echo crafted" },
          { name: "ctor", type: "constructor", command: "echo ctor" },
          { name: "ok", type: "pre_tool", match: "bash", command: "./guard" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      // The legitimate entry still imports.
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({ command: "./guard", matcher: "bash" });
      // The crafted names are dropped rather than resolving through the lookup
      // map's prototype and landing in the tool override block under a
      // stringified prototype member (e.g. "[object Object]").
      expect(Object.keys(parsed.hooks)).toEqual(["preToolUse"]);
      expect(parsed.vibe).toBeUndefined();
    });

    it("should carry an event type named toString through as a plain string key (#2757)", () => {
      // `toString` is not a prototype-pollution key, so it reaches the event
      // name lookup; the lookup must not resolve Object.prototype.toString.
      const fileContent = smolToml.stringify({
        hooks: [
          { name: "ok", type: "pre_tool", match: "bash", command: "./guard" },
          { name: "crafted", type: "toString", command: "./crafted" },
        ],
      });

      const vibeHooks = new VibeHooks(
        createMockAiFileParams({
          relativeDirPath: ".vibe",
          relativeFilePath: "hooks.toml",
          fileContent,
        }),
      );

      const parsed = vibeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({ command: "./guard", matcher: "bash" });
      expect(Object.keys(parsed.hooks)).toEqual(["preToolUse"]);
      // The unmapped name must fall through verbatim rather than resolving to
      // Object.prototype.toString and landing under its stringified source.
      const overrideHooks = (parsed as { vibe?: { hooks?: Record<string, unknown[]> } }).vibe
        ?.hooks;
      expect(Object.keys(overrideHooks ?? {})).toEqual(["toString"]);
      expect(overrideHooks?.["toString"]?.[0]).toMatchObject({ command: "./crafted" });
    });
  });

  describe("fromFile", () => {
    it("should load from .vibe/hooks.toml when it exists", async () => {
      await ensureDir(join(testDir, ".vibe"));
      await writeFileContent(
        join(testDir, ".vibe", "hooks.toml"),
        smolToml.stringify({
          hooks: [{ name: "h", type: "pre_tool", match: "bash", command: "echo hi" }],
        }),
      );

      const vibeHooks = await VibeHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = smolToml.parse(vibeHooks.getFileContent()) as {
        hooks: Array<Record<string, unknown>>;
      };
      expect(parsed.hooks).toHaveLength(1);
    });

    it("should initialize empty content when hooks.toml does not exist", async () => {
      const vibeHooks = await VibeHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = smolToml.parse(vibeHooks.getFileContent());
      expect(parsed).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("hooks.toml should be deletable", () => {
      const hooks = new VibeHooks(
        createMockAiFileParams({ relativeDirPath: ".vibe", relativeFilePath: "hooks.toml" }),
      );
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});
