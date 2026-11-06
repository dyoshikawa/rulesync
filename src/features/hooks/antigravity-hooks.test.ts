import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { AntigravityCliHooks, AntigravityIdeHooks } from "./antigravity-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

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

// Both Antigravity subclasses share identical behavior except for which
// per-target override key they read from the rulesync hooks config.
const subclasses = [
  { name: "AntigravityIdeHooks", HooksClass: AntigravityIdeHooks, overrideKey: "antigravity-ide" },
  { name: "AntigravityCliHooks", HooksClass: AntigravityCliHooks, overrideKey: "antigravity-cli" },
] as const;

describe("AntigravityHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe.each(subclasses)("$name", ({ HooksClass, overrideKey }) => {
    describe("getSettablePaths", () => {
      it("should return the project hooks path by default", () => {
        const paths = HooksClass.getSettablePaths();

        expect(paths.relativeDirPath).toBe(".agents");
        expect(paths.relativeFilePath).toBe("hooks.json");
      });

      it("should return the shared global hooks path when global is true", () => {
        const paths = HooksClass.getSettablePaths({ global: true });

        expect(paths.relativeDirPath).toBe(join(".gemini", "config"));
        expect(paths.relativeFilePath).toBe("hooks.json");
      });
    });

    describe("fromRulesyncHooks", () => {
      it("should write supported events at the top level and drop unsupported ones", async () => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              version: 1,
              hooks: {
                sessionStart: [{ type: "command", command: "echo start" }],
                preToolUse: [{ type: "command", command: "echo pre" }],
                stop: [{ type: "command", command: "echo stop" }],
                sessionEnd: [{ type: "command", command: "echo end" }],
              },
            }),
          }),
        );

        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: true,
        });

        const parsed = JSON.parse(hooks.getFileContent());

        // The event map is nested under the generated `rulesync` hook name.
        expect(parsed.hooks).toBeUndefined();
        const hookEntry = parsed.rulesync;
        expect(hookEntry).toBeDefined();

        // Tool events keep the matcher-group shape; SessionStart and Stop are
        // flat handler lists.
        expect(hookEntry.PreToolUse).toEqual([
          { hooks: [{ type: "command", command: "echo pre" }] },
        ]);
        expect(hookEntry.SessionStart).toEqual([{ type: "command", command: "echo start" }]);
        expect(hookEntry.Stop).toEqual([{ type: "command", command: "echo stop" }]);

        // The unsupported `sessionEnd` event is dropped entirely.
        expect(Object.keys(hookEntry).toSorted()).toEqual(["PreToolUse", "SessionStart", "Stop"]);
      });

      it("should emit matcher-less events as flat handler lists", async () => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              version: 1,
              hooks: {
                preModelInvocation: [
                  { type: "command", command: "echo pre-model", timeout: 10 },
                  { type: "command", command: "echo pre-model-2", matcher: "ignored" },
                ],
                postModelInvocation: [{ type: "command", command: "echo post-model" }],
              },
            }),
          }),
        );

        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: true,
        });

        const hookEntry = JSON.parse(hooks.getFileContent()).rulesync;

        // Model-invocation events map to Antigravity's PascalCase names, and
        // their handlers sit directly under the event key: Antigravity rejects
        // a `{ hooks: [...] }` group there and skips the whole file. Handlers
        // from different matcher groups are merged into the one list.
        expect(hookEntry.PreInvocation).toEqual([
          { type: "command", command: "echo pre-model", timeout: 10 },
          { type: "command", command: "echo pre-model-2" },
        ]);
        expect(hookEntry.PostInvocation).toEqual([{ type: "command", command: "echo post-model" }]);
      });

      it(`should apply the ${overrideKey} per-target override`, async () => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              version: 1,
              hooks: {
                preToolUse: [{ type: "command", command: "echo pre" }],
              },
              [overrideKey]: {
                hooks: {
                  preToolUse: [{ type: "command", command: "echo ide-override" }],
                  postToolUse: [{ type: "command", command: "echo post-override" }],
                },
              },
            }),
          }),
        );

        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: true,
        });

        const hookEntry = JSON.parse(hooks.getFileContent()).rulesync;

        // The per-target override replaces the shared definition.
        expect(hookEntry.PreToolUse[0].hooks[0].command).toBe("echo ide-override");
        expect(hookEntry.PostToolUse[0].hooks[0].command).toBe("echo post-override");
      });
    });

    describe("matcher translation", () => {
      const generate = async (matcher: string) => {
        const logger = createMockLogger();
        const warnSpy = vi.spyOn(logger, "warn");
        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: new RulesyncHooks(
            createMockAiFileParams({
              fileContent: JSON.stringify({
                version: 1,
                hooks: { preToolUse: [{ type: "command", command: "echo pre", matcher }] },
              }),
            }),
          ),
          validate: true,
          logger,
        });
        return {
          matcher: JSON.parse(hooks.getFileContent()).rulesync.PreToolUse[0].matcher,
          warnSpy,
        };
      };

      it("should translate canonical tool names to the names Antigravity reports", async () => {
        const { matcher, warnSpy } = await generate("Bash|Read|Write|Edit|WebSearch");

        expect(matcher).toBe(
          "run_command|(?:read_file|view_file)|(?:write_file|write_to_file)|" +
            "(?:edit_file|replace_file_content)|search_web",
        );
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("should keep a translated file tool one regex unit inside an anchored matcher", async () => {
        const { matcher } = await generate("^Read$");

        expect(matcher).toBe("^(?:read_file|view_file)$");
        const pattern = new RegExp(matcher);
        expect(pattern.test("read_file")).toBe(true);
        expect(pattern.test("view_file")).toBe(true);
        expect(pattern.test("read_file_extra")).toBe(false);
      });

      it("should translate postToolUse matchers", async () => {
        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: new RulesyncHooks(
            createMockAiFileParams({
              fileContent: JSON.stringify({
                version: 1,
                hooks: {
                  postToolUse: [{ type: "command", command: "echo post", matcher: "Bash|Edit" }],
                },
              }),
            }),
          ),
          validate: true,
        });

        expect(JSON.parse(hooks.getFileContent()).rulesync.PostToolUse[0].matcher).toBe(
          "run_command|(?:edit_file|replace_file_content)",
        );
      });

      it(`should put a ${overrideKey} override matcher and the canonical name it translates from in one group`, async () => {
        const hooks = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: new RulesyncHooks(
            createMockAiFileParams({
              fileContent: JSON.stringify({
                version: 1,
                hooks: {},
                [overrideKey]: {
                  hooks: {
                    preToolUse: [
                      { type: "command", command: "echo native", matcher: "run_command" },
                      { type: "command", command: "echo canonical", matcher: "Bash" },
                    ],
                  },
                },
              }),
            }),
          ),
          validate: true,
        });

        expect(JSON.parse(hooks.getFileContent()).rulesync.PreToolUse).toEqual([
          {
            matcher: "run_command",
            hooks: [
              { type: "command", command: "echo native" },
              { type: "command", command: "echo canonical" },
            ],
          },
        ]);
      });

      it("should leave Antigravity names, MCP names and regex syntax as written", async () => {
        const { matcher, warnSpy } = await generate("run_command|browser_.*|mcp__srv__Bash");

        expect(matcher).toBe("run_command|browser_.*|mcp__srv__Bash");
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("should translate a whole name between regex escapes", async () => {
        const { matcher } = await generate("\\bRead\\b");

        expect(matcher).toBe("\\b(?:read_file|view_file)\\b");
      });

      it("should warn once about a capitalized name it cannot translate", async () => {
        const { matcher, warnSpy } = await generate("Glob|Edit|Glob");

        expect(matcher).toBe("Glob|(?:edit_file|replace_file_content)|Glob");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"Glob"'));
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Antigravity reports lowercase tool names"),
        );
      });

      it("should name the documented candidates for untranslated tools in the warning", async () => {
        const { matcher, warnSpy } = await generate("Grep|Glob|WebFetch|MultiEdit|Task");

        expect(matcher).toBe("Grep|Glob|WebFetch|MultiEdit|Task");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [message] = warnSpy.mock.calls[0] ?? [];
        for (const candidate of [
          '`grep_search` for "Grep"',
          '`find_by_name` for "Glob"',
          '`read_url_content` for "WebFetch"',
          '`multi_replace_file_content` for "MultiEdit"',
        ]) {
          expect(message).toContain(candidate);
        }
        expect(message).not.toContain('for "Task"');
      });

      it("should import Antigravity tool names as canonical names", () => {
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              rulesync: {
                PreToolUse: [
                  {
                    matcher: "write_file|edit_file|read_file|run_command|search_web",
                    hooks: [{ type: "command", command: "echo pre" }],
                  },
                ],
              },
            }),
          }),
        );

        expect(hooks.toRulesyncHooks().getJson().hooks.preToolUse?.[0]?.matcher).toBe(
          "Write|Edit|Read|Bash|WebSearch",
        );
      });

      it("should import the documented file tool names as canonical names", () => {
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              rulesync: {
                PreToolUse: [
                  {
                    matcher: "^(view_file|write_to_file|replace_file_content|grep_search)$",
                    hooks: [{ type: "command", command: "echo pre" }],
                  },
                ],
              },
            }),
          }),
        );

        expect(hooks.toRulesyncHooks().getJson().hooks.preToolUse?.[0]?.matcher).toBe(
          "^(Read|Write|Edit|grep_search)$",
        );
      });

      it("should round-trip the alternation groups back to canonical names", async () => {
        const generated = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: new RulesyncHooks(
            createMockAiFileParams({
              fileContent: JSON.stringify({
                version: 1,
                hooks: {
                  preToolUse: [
                    { type: "command", command: "echo pre", matcher: "^(Read|Write|Edit|Bash)$" },
                  ],
                  postToolUse: [{ type: "command", command: "echo post", matcher: "\\bEdit\\b" }],
                },
              }),
            }),
          ),
          validate: true,
        });

        const imported = new HooksClass(
          createMockAiFileParams({ fileContent: generated.getFileContent() }),
        )
          .toRulesyncHooks()
          .getJson();

        expect(imported.hooks.preToolUse?.[0]?.matcher).toBe("^(Read|Write|Edit|Bash)$");
        expect(imported.hooks.postToolUse?.[0]?.matcher).toBe("\\bEdit\\b");
      });
    });

    describe("toRulesyncHooks", () => {
      it("should convert a top-level Antigravity hook map back to canonical events", () => {
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
              Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
            }),
          }),
        );

        const rulesyncHooks = hooks.toRulesyncHooks();
        const parsed = rulesyncHooks.getJson();

        expect(parsed.hooks.preToolUse).toBeDefined();
        expect(parsed.hooks.preToolUse?.[0]).toEqual({
          type: "command",
          command: "echo pre",
        });
        expect(parsed.hooks.stop).toBeDefined();
        expect(parsed.hooks.stop?.[0]).toEqual({
          type: "command",
          command: "echo stop",
        });
      });

      it("should import flat handler lists for matcher-less events", () => {
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              rulesync: {
                SessionStart: [{ type: "command", command: "echo start" }],
                PreToolUse: [
                  { matcher: "run_command", hooks: [{ type: "command", command: "echo pre" }] },
                ],
                PreInvocation: [{ type: "command", command: "echo pre-model", timeout: 5 }],
                PostInvocation: [{ command: "echo post-model" }],
                Stop: [
                  { type: "command", command: "echo stop-1" },
                  { type: "command", command: "echo stop-2" },
                ],
              },
            }),
          }),
        );

        const parsed = hooks.toRulesyncHooks().getJson();

        expect(parsed.hooks).toEqual({
          sessionStart: [{ type: "command", command: "echo start" }],
          preToolUse: [{ type: "command", command: "echo pre", matcher: "Bash" }],
          preModelInvocation: [{ type: "command", command: "echo pre-model", timeout: 5 }],
          postModelInvocation: [{ type: "command", command: "echo post-model" }],
          stop: [
            { type: "command", command: "echo stop-1" },
            { type: "command", command: "echo stop-2" },
          ],
        });
      });

      it("should round-trip generated matcher-less events", async () => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              version: 1,
              hooks: {
                sessionStart: [{ type: "command", command: "echo start" }],
                stop: [{ type: "command", command: "echo stop", timeout: 3 }],
              },
            }),
          }),
        );
        const generated = await HooksClass.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: true,
        });

        const parsed = new HooksClass(
          createMockAiFileParams({ fileContent: generated.getFileContent() }),
        )
          .toRulesyncHooks()
          .getJson();

        expect(parsed.hooks).toEqual({
          sessionStart: [{ type: "command", command: "echo start" }],
          stop: [{ type: "command", command: "echo stop", timeout: 3 }],
        });
      });

      it("should unwrap the named-hook wrapper (ignoring `enabled`) on import", () => {
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              rulesync: {
                enabled: false,
                PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
                PreInvocation: [{ hooks: [{ type: "command", command: "echo pre-model" }] }],
              },
            }),
          }),
        );

        const parsed = hooks.toRulesyncHooks().getJson();

        expect(parsed.hooks.preToolUse?.[0]).toEqual({ type: "command", command: "echo pre" });
        expect(parsed.hooks.preModelInvocation?.[0]).toEqual({
          type: "command",
          command: "echo pre-model",
        });
      });

      it("should ignore prototype-pollution event keys without crashing", () => {
        // A crafted hooks file with a `__proto__` event key must not make the
        // flatten step resolve `flat["__proto__"]` to `Object.prototype` (which
        // would throw `existing is not iterable`). The key is skipped on both
        // the legacy-flat and the named-hook-wrapper paths.
        const hooks = new HooksClass(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              __proto__: [{ hooks: [{ type: "command", command: "echo flat-proto" }] }],
              rulesync: {
                __proto__: [{ hooks: [{ type: "command", command: "echo wrapped-proto" }] }],
                Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
              },
            }),
          }),
        );

        const parsed = hooks.toRulesyncHooks().getJson();

        // The valid event still imports; the `__proto__` keys are dropped and
        // Object.prototype is untouched.
        expect(parsed.hooks.stop?.[0]).toEqual({ type: "command", command: "echo stop" });
        expect(({} as Record<string, unknown>).hooks).toBeUndefined();
      });
    });

    describe("validate", () => {
      it("should return success", () => {
        const hooks = new HooksClass(createMockAiFileParams());

        const result = hooks.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      });
    });
  });
});
