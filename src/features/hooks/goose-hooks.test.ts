import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GooseHooks } from "./goose-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const GOOSE_HOOKS_DIR = join(".agents", "plugins", "rulesync", "hooks");

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

describe("GooseHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("getSettablePaths", () => {
    it("should write to the .agents/plugins/rulesync/hooks plugin directory", () => {
      const paths = GooseHooks.getSettablePaths();
      expect(paths.relativeDirPath).toBe(GOOSE_HOOKS_DIR);
      expect(paths.relativeFilePath).toBe("hooks.json");
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should convert canonical hooks to Goose PascalCase events with matcher/hooks arrays", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              preToolUse: [{ command: "./scripts/lint.sh", matcher: "shell", timeout: 30 }],
              afterFileEdit: [{ command: "cargo fmt", matcher: "\\.rs$" }],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo start");
      expect(parsed.hooks.SessionStart[0].hooks[0].type).toBe("command");
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("shell");
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("./scripts/lint.sh");
      expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(30);
      expect(parsed.hooks.AfterFileEdit[0].matcher).toBe("\\.rs$");
    });

    it("should emit a canonical '*' matcher as no matcher", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                { command: "all-tools.sh", matcher: "*" },
                { command: "also-all-tools.sh" },
                { command: "shell-only.sh", matcher: "shell" },
              ],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      // Goose compiles `matcher` as a regex and drops the whole rule when it
      // fails to compile, so "*" must not reach the file; it collapses into the
      // matcher-less group rather than producing a second bare entry.
      expect(parsed.hooks.PreToolUse).toHaveLength(2);
      expect(parsed.hooks.PreToolUse[0].matcher).toBeUndefined();
      expect(parsed.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command)).toEqual([
        "all-tools.sh",
        "also-all-tools.sh",
      ]);
      expect(parsed.hooks.PreToolUse[1].matcher).toBe("shell");
    });

    it("should map all Goose lifecycle events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionEnd: [{ command: "echo end" }],
              stop: [{ command: "echo stop" }],
              beforeSubmitPrompt: [{ command: "echo prompt" }],
              postToolUse: [{ command: "echo post" }],
              postToolUseFailure: [{ command: "echo fail" }],
              beforeReadFile: [{ command: "echo read" }],
              beforeShellExecution: [{ command: "echo before-sh" }],
              afterShellExecution: [{ command: "echo after-sh" }],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionEnd).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.UserPromptSubmit).toBeDefined();
      expect(parsed.hooks.PostToolUse).toBeDefined();
      expect(parsed.hooks.PostToolUseFailure).toBeDefined();
      expect(parsed.hooks.BeforeReadFile).toBeDefined();
      expect(parsed.hooks.BeforeShellExecution).toBeDefined();
      expect(parsed.hooks.AfterShellExecution).toBeDefined();
    });

    it("should drop subagent lifecycle events Goose does not support", async () => {
      // Goose's HookEvent enum has no SubagentStart/SubagentStop arms, so these
      // canonical events must not be emitted (Goose would silently ignore them).
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              subagentStart: [{ command: "echo sub-start" }],
              subagentStop: [{ command: "echo sub-stop" }],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SubagentStart).toBeUndefined();
      expect(parsed.hooks.SubagentStop).toBeUndefined();
    });

    it("should filter unsupported events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo start" }],
              preCompact: [{ command: "echo compact" }],
              notification: [{ command: "echo notify" }],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.PreCompact).toBeUndefined();
      expect(parsed.hooks.Notification).toBeUndefined();
    });

    it("should emit failClosed as on_failure: block on PreToolUse command hooks only (issue #2404)", async () => {
      // Goose v1.48.0+: `on_failure` is read on `PreToolUse` only and must be
      // one of the lowercase keywords `allow` / `block`; `allow` is the default.
      const logger = createMockLogger();
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              preToolUse: [
                { command: "./scripts/guard.sh", matcher: "shell", failClosed: true },
                { command: "./scripts/audit.sh", failClosed: false },
              ],
              postToolUse: [{ command: "./scripts/after.sh", failClosed: true }],
              stop: [{ command: "./scripts/stop.sh", failClosed: false }],
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
        logger,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      const preToolUse = parsed.hooks.PreToolUse.flatMap(
        (entry: { hooks: Array<Record<string, unknown>> }) => entry.hooks,
      );
      expect(preToolUse).toEqual([
        { type: "command", command: "./scripts/guard.sh", on_failure: "block" },
        { type: "command", command: "./scripts/audit.sh" },
      ]);
      expect(parsed.hooks.PostToolUse[0].hooks[0]).toEqual({
        type: "command",
        command: "./scripts/after.sh",
      });
      expect(parsed.hooks.Stop[0].hooks[0]).toEqual({
        type: "command",
        command: "./scripts/stop.sh",
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping "failClosed" from a "command" hook on "postToolUse"'),
      );
    });

    it("should process goose-specific overrides", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
              sessionStart: [{ command: "echo shared" }],
            },
            goose: {
              hooks: {
                sessionStart: [{ command: "echo override" }],
                stop: [{ command: "echo stop" }],
              },
            },
          }),
        }),
      );

      const gooseHooks = await GooseHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: true,
      });

      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo override");
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe("echo stop");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Goose format back to canonical format", () => {
      const gooseHooks = new GooseHooks(
        createMockAiFileParams({
          relativeDirPath: GOOSE_HOOKS_DIR,
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "shell",
                  hooks: [{ type: "command", command: "echo pre", timeout: 1000 }],
                },
              ],
              AfterShellExecution: [{ hooks: [{ command: "echo done" }] }],
            },
          }),
        }),
      );

      const parsed = gooseHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.preToolUse?.[0]).toEqual({
        type: "command",
        command: "echo pre",
        timeout: 1000,
        matcher: "shell",
      });
      expect(parsed.hooks.afterShellExecution?.[0]).toEqual({
        type: "command",
        command: "echo done",
      });
    });

    it("should import on_failure back into failClosed and drop what Goose would not read (issue #2404)", () => {
      const logger = createMockLogger();
      const gooseHooks = new GooseHooks(
        createMockAiFileParams({
          relativeDirPath: GOOSE_HOOKS_DIR,
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  hooks: [
                    { type: "command", command: "echo block", on_failure: "block" },
                    { type: "command", command: "echo allow", on_failure: "allow" },
                    { type: "command", command: "echo typo", on_failure: "Block" },
                  ],
                },
              ],
              PostToolUse: [
                { hooks: [{ type: "command", command: "echo after", on_failure: "block" }] },
              ],
            },
          }),
        }),
      );

      const parsed = gooseHooks.toRulesyncHooks({ logger }).getJson();
      expect(parsed.hooks.preToolUse).toEqual([
        { type: "command", command: "echo block", failClosed: true },
        { type: "command", command: "echo allow", failClosed: false },
        { type: "command", command: "echo typo" },
      ]);
      expect(parsed.hooks.postToolUse).toEqual([{ type: "command", command: "echo after" }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"Block" is not a value this tool documents for it'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping "on_failure" from a "command" hook on "postToolUse"'),
      );
    });

    it("should drop non-Goose SubagentStart/SubagentStop keys on import", () => {
      // Goose never emits these (its HookEvent enum has no such arms), but an
      // old rulesync-generated hooks.json might carry them. They have no
      // canonical mapping anymore, so import drops them while keeping real events.
      const gooseHooks = new GooseHooks(
        createMockAiFileParams({
          relativeDirPath: GOOSE_HOOKS_DIR,
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SessionStart: [{ hooks: [{ command: "echo start" }] }],
              SubagentStart: [{ hooks: [{ command: "echo sub-start" }] }],
              SubagentStop: [{ hooks: [{ command: "echo sub-stop" }] }],
            },
          }),
        }),
      );

      const parsed = gooseHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.sessionStart?.[0]).toEqual({
        type: "command",
        command: "echo start",
      });
      // Neither the canonical camelCase name nor the raw PascalCase key survives.
      expect(parsed.hooks.subagentStart).toBeUndefined();
      expect(parsed.hooks.subagentStop).toBeUndefined();
      expect((parsed.hooks as Record<string, unknown>).SubagentStart).toBeUndefined();
      expect((parsed.hooks as Record<string, unknown>).SubagentStop).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from the plugin hooks.json when it exists", async () => {
      await ensureDir(join(testDir, GOOSE_HOOKS_DIR));
      await writeFileContent(
        join(testDir, GOOSE_HOOKS_DIR, "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
          },
        }),
      );

      const gooseHooks = await GooseHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks.SessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when hooks.json does not exist", async () => {
      const gooseHooks = await GooseHooks.fromFile({ outputRoot: testDir, validate: false });
      const parsed = JSON.parse(gooseHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should create instance with empty hooks", () => {
      const hooks = GooseHooks.forDeletion({
        relativeDirPath: GOOSE_HOOKS_DIR,
        relativeFilePath: "hooks.json",
      });
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
