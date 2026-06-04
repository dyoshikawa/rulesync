import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

        // Supported canonical events are mapped to their Antigravity names.
        expect(hookEntry.PreToolUse).toBeDefined();
        expect(hookEntry.PreToolUse[0].hooks[0].command).toBe("echo pre");
        expect(hookEntry.Stop).toBeDefined();
        expect(hookEntry.Stop[0].hooks[0].command).toBe("echo stop");

        // The unsupported `sessionStart` event is dropped entirely.
        expect(hookEntry.SessionStart).toBeUndefined();
        expect(hookEntry.sessionStart).toBeUndefined();
      });

      it("should emit matcher-less PreInvocation/PostInvocation handler lists", async () => {
        const rulesyncHooks = new RulesyncHooks(
          createMockAiFileParams({
            fileContent: JSON.stringify({
              version: 1,
              hooks: {
                preModelInvocation: [{ type: "command", command: "echo pre-model" }],
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

        // Model-invocation events map to Antigravity's PascalCase names and are
        // emitted as matcher-less handler lists (no `matcher` field).
        expect(hookEntry.PreInvocation[0]).toEqual({
          hooks: [{ type: "command", command: "echo pre-model" }],
        });
        expect(hookEntry.PostInvocation[0].hooks[0].command).toBe("echo post-model");
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
