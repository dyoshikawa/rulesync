import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotHooks } from "./copilot-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("CopilotHooks", () => {
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

  describe("getSettablePaths", () => {
    it("should return .github/hooks and copilot-hooks.json for project mode", () => {
      const paths = CopilotHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
    });

    it("should return .github/hooks and copilot-hooks.json for global mode", () => {
      const paths = CopilotHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Copilot-supported events and convert event names", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          sessionEnd: [{ command: ".rulesync/hooks/session-end.sh" }],
          afterSubmitPrompt: [{ command: ".rulesync/hooks/after-prompt.sh" }],
          preToolUse: [{ command: ".rulesync/hooks/pre-tool.sh" }],
          postToolUse: [{ command: ".rulesync/hooks/post-tool.sh" }],
          afterError: [{ command: ".rulesync/hooks/error.sh" }],
          // This event is NOT supported by Copilot
          stop: [{ command: ".rulesync/hooks/stop.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.sessionEnd).toBeDefined();
      expect(parsed.hooks.userPromptSubmitted).toBeDefined();
      expect(parsed.hooks.preToolUse).toBeDefined();
      expect(parsed.hooks.postToolUse).toBeDefined();
      expect(parsed.hooks.errorOccurred).toBeDefined();
      // stop is not supported by Copilot
      expect(parsed.hooks.stop).toBeUndefined();
    });

    it("should use bash field on non-Windows and timeoutSec instead of timeout", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo hello", timeout: 30 }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      expect(entry.bash).toBe("echo hello");
      expect(entry.powershell).toBeUndefined();
      expect(entry.timeoutSec).toBe(30);
      // Should NOT have command or timeout fields
      expect(entry.command).toBeUndefined();
      expect(entry.timeout).toBeUndefined();
    });

    it("should use powershell field on Windows", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo hello", timeout: 30 }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      expect(entry.powershell).toBe("echo hello");
      expect(entry.bash).toBeUndefined();
      expect(entry.timeoutSec).toBe(30);
    });

    it("should not prefix commands with any path variable", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.bash).toBe(".rulesync/hooks/session-start.sh");
      expect(entry.bash).not.toContain("$CLAUDE_PROJECT_DIR");
    });

    it("should skip hooks with matcher", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "lint.sh", matcher: "Write" },
            { type: "command", command: "all-tools.sh" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // Only the non-matcher hook should be present
      expect(parsed.hooks.preToolUse).toHaveLength(1);
      expect(parsed.hooks.preToolUse[0].bash).toBe("all-tools.sh");
    });

    it("should skip prompt-type hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "prompt", prompt: "Check the code carefully" },
            { type: "command", command: "lint.sh" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.preToolUse).toHaveLength(1);
      expect(parsed.hooks.preToolUse[0].type).toBe("command");
      expect(parsed.hooks.preToolUse[0].bash).toBe("lint.sh");
    });

    it("should merge config.copilot.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        copilot: {
          hooks: {
            sessionStart: [{ type: "command", command: "copilot-override.sh" }],
            afterError: [{ type: "command", command: "error-handler.sh" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // copilot override replaces shared sessionStart
      expect(parsed.hooks.sessionStart[0].bash).toBe("copilot-override.sh");
      // copilot-specific afterError is present
      expect(parsed.hooks.errorOccurred).toBeDefined();
      expect(parsed.hooks.errorOccurred[0].bash).toBe("error-handler.sh");
    });

    it("should produce standalone file without merging existing content", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "echo start" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // Should have exactly version and hooks at top level
      expect(Object.keys(parsed)).toEqual(["version", "hooks"]);
      expect(parsed.version).toBe(1);
    });

    it("should omit events with no valid hooks after filtering", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            // All hooks have matcher or are prompt type — all skipped
            { type: "prompt", prompt: "Check carefully" },
            { type: "command", command: "lint.sh", matcher: "Write" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // preToolUse should be absent since all hooks were filtered out
      expect(parsed.hooks.preToolUse).toBeUndefined();
    });

    it("should pass through unknown keys and keep bash/powershell overrides", async () => {
      const config = {
        version: 1,
        hooks: {},
        copilot: {
          hooks: {
            sessionStart: [
              { type: "command", bash: "run.sh", powershell: "run.ps1", customKey: 123 },
            ],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart[0].bash).toBe("run.sh");
      expect(parsed.hooks.sessionStart[0].powershell).toBe("run.ps1");
      expect(parsed.hooks.sessionStart[0].customKey).toBe(123);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => copilotHooks.toRulesyncHooks()).toThrow(/Failed to parse Copilot hooks content/);
    });

    it("should convert Copilot hooks with bash-only to canonical format", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", bash: "echo start", timeoutSec: 30 }],
            userPromptSubmitted: [{ type: "command", bash: "log-prompt.sh" }],
            errorOccurred: [{ type: "command", bash: "handle-error.sh" }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(json.hooks.sessionStart?.[0]?.timeout).toBe(30);
      expect(json.hooks.afterSubmitPrompt).toHaveLength(1);
      expect(json.hooks.afterSubmitPrompt?.[0]?.command).toBe("log-prompt.sh");
      expect(json.hooks.afterError).toHaveLength(1);
      expect(json.hooks.afterError?.[0]?.command).toBe("handle-error.sh");
    });

    it("should convert Copilot hooks with powershell-only to canonical format", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ type: "command", powershell: "Write-Output start", timeoutSec: 15 }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("Write-Output start");
      expect(json.hooks.sessionStart?.[0]?.timeout).toBe(15);
    });

    it("should use bash when both bash and powershell are present on non-Windows", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      const warnCalls: string[] = [];
      vi.spyOn(await import("../../utils/logger.js"), "logger", "get").mockReturnValue({
        warn: (msg: string) => warnCalls.push(msg),
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      } as never);

      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "echo start", powershell: "Write-Output start" },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(warnCalls.some((msg) => msg.includes("bash") && msg.includes("powershell"))).toBe(
        true,
      );
    });

    it("should use powershell when both bash and powershell are present on Windows", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      const warnCalls: string[] = [];
      vi.spyOn(await import("../../utils/logger.js"), "logger", "get").mockReturnValue({
        warn: (msg: string) => warnCalls.push(msg),
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      } as never);

      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "echo start", powershell: "Write-Output start" },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("Write-Output start");
      expect(warnCalls.some((msg) => msg.includes("bash") && msg.includes("powershell"))).toBe(
        true,
      );
    });

    it("should handle empty hooks", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({ version: 1, hooks: {} }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks).toEqual({});
    });

    it("should skip invalid hook entries", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "valid.sh" },
              "not-an-object",
              { noTypeField: true },
              { type: 123 },
              { type: "command", powershell: 456 },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toBe("valid.sh");
    });

    it("should not import unknown keys when converting to canonical hooks", () => {
      const copilotHooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", bash: "run.sh", powershell: "run.ps1", customKey: 123 },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = copilotHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      const entry = json.hooks.sessionStart?.[0] as Record<string, unknown>;
      expect(entry.command).toBe("run.sh");
      expect(entry.customKey).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should load from .github/hooks/copilot-hooks.json when it exists", async () => {
      await ensureDir(join(testDir, ".github", "hooks"));
      await writeFileContent(
        join(testDir, ".github", "hooks", "copilot-hooks.json"),
        JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", bash: "echo start" }] },
        }),
      );

      const copilotHooks = await CopilotHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(copilotHooks).toBeInstanceOf(CopilotHooks);
      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when copilot-hooks.json does not exist", async () => {
      const copilotHooks = await CopilotHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(copilotHooks).toBeInstanceOf(CopilotHooks);
      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return true (default from ToolFile)", () => {
      const hooks = new CopilotHooks({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: '{"version":1,"hooks":{}}',
        validate: false,
      });
      // CopilotHooks does NOT override isDeletable, so it uses the default (true)
      expect(hooks.isDeletable()).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should return CopilotHooks instance with empty hooks for deletion path", () => {
      const hooks = CopilotHooks.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
      expect(hooks).toBeInstanceOf(CopilotHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
