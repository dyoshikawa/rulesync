import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
              preToolUse: [
                { command: "./scripts/lint.sh", matcher: "developer__shell", timeout: 30 },
              ],
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
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("developer__shell");
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("./scripts/lint.sh");
      expect(parsed.hooks.PreToolUse[0].hooks[0].timeout).toBe(30);
      expect(parsed.hooks.AfterFileEdit[0].matcher).toBe("\\.rs$");
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

    it("should map subagent lifecycle events", async () => {
      const rulesyncHooks = new RulesyncHooks(
        createMockAiFileParams({
          fileContent: JSON.stringify({
            hooks: {
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
      expect(parsed.hooks.SubagentStart).toBeDefined();
      expect(parsed.hooks.SubagentStop).toBeDefined();
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
                  matcher: "developer__shell",
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
        matcher: "developer__shell",
      });
      expect(parsed.hooks.afterShellExecution?.[0]).toEqual({
        type: "command",
        command: "echo done",
      });
    });

    it("should convert SubagentStart/SubagentStop back to canonical events", () => {
      const gooseHooks = new GooseHooks(
        createMockAiFileParams({
          relativeDirPath: GOOSE_HOOKS_DIR,
          relativeFilePath: "hooks.json",
          fileContent: JSON.stringify({
            hooks: {
              SubagentStart: [{ hooks: [{ command: "echo sub-start" }] }],
              SubagentStop: [{ hooks: [{ command: "echo sub-stop" }] }],
            },
          }),
        }),
      );

      const parsed = gooseHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.subagentStart?.[0]).toEqual({
        type: "command",
        command: "echo sub-start",
      });
      expect(parsed.hooks.subagentStop?.[0]).toEqual({
        type: "command",
        command: "echo sub-stop",
      });
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
