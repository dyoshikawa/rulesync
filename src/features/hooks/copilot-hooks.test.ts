import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
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

    it("should return the ~/.copilot/hooks user-scope file for global mode", () => {
      const paths = CopilotHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".copilot", "hooks"),
        // Distinct from the Copilot CLI's global `copilot-hooks.json` in the
        // same folder, so the two targets never overwrite each other.
        relativeFilePath: "copilot-ide-hooks.json",
      });
    });

    it("writes the generated global file to the user-scope path", async () => {
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ command: "echo hi" }] },
        }),
        validate: false,
      });

      const hooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        global: true,
      });

      expect(hooks.getRelativeDirPath()).toBe(join(".copilot", "hooks"));
      expect(hooks.getRelativeFilePath()).toBe("copilot-ide-hooks.json");
      expect(JSON.parse(hooks.getFileContent()).hooks.sessionStart).toBeDefined();
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Copilot-supported events and convert event names", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          sessionEnd: [{ command: ".rulesync/hooks/session-end.sh" }],
          beforeSubmitPrompt: [{ command: ".rulesync/hooks/before-prompt.sh" }],
          preToolUse: [{ command: ".rulesync/hooks/pre-tool.sh" }],
          postToolUse: [{ command: ".rulesync/hooks/post-tool.sh" }],
          afterError: [{ command: ".rulesync/hooks/error.sh" }],
          // This event is NOT supported by Copilot
          stop: [{ command: ".rulesync/hooks/stop.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
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

    it("should map canonical stop/subagentStop to agentStop/subagentStop", async () => {
      const config = {
        version: 1,
        hooks: {
          stop: [{ command: ".rulesync/hooks/agent-stop.sh" }],
          subagentStop: [{ command: ".rulesync/hooks/subagent-stop.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(copilotHooks.getFileContent());
      expect(parsed.hooks.agentStop).toBeDefined();
      expect(parsed.hooks.subagentStop).toBeDefined();
      // Canonical names must not leak into the generated Copilot file.
      expect(parsed.hooks.stop).toBeUndefined();
    });

    it("should write the portable command field and timeoutSec instead of timeout", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo hello", timeout: 30 }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      // No canonical `shell` selector, so the cross-platform field is written
      // rather than a shell-specific one chosen from process.platform.
      expect(entry.command).toBe("echo hello");
      expect(entry.bash).toBeUndefined();
      expect(entry.powershell).toBeUndefined();
      expect(entry.timeoutSec).toBe(30);
      expect(entry.timeout).toBeUndefined();
    });

    it("should key the command field off the canonical shell selector", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo hello", shell: "powershell" }],
          preToolUse: [{ type: "command", command: "lint.sh", shell: "bash" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      expect(entry.powershell).toBe("echo hello");
      expect(entry.bash).toBeUndefined();
      expect(entry.command).toBeUndefined();
      expect(parsed.hooks.preToolUse[0].bash).toBe("lint.sh");
      expect(parsed.hooks.preToolUse[0].command).toBeUndefined();
    });

    it("should generate the same file regardless of the platform it runs on", async () => {
      const config = {
        version: 1,
        hooks: { sessionStart: [{ type: "command", command: "echo hello" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      const onWindows = (
        await CopilotHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        })
      ).getFileContent();

      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      const onLinux = (
        await CopilotHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        })
      ).getFileContent();

      // The file is committed to the repository, so it must not vary by
      // generating machine — and a Windows-only `powershell` entry would be
      // ignored outright by the Linux-sandboxed cloud agent.
      expect(onWindows).toBe(onLinux);
      expect(JSON.parse(onLinux).hooks.sessionStart[0].command).toBe("echo hello");
    });

    it("should emit the canonical env map on a command hook", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo hello", env: { LOG_LEVEL: "debug" } }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      // `env` is a canonical key, so it is filtered out of the unknown-key
      // passthrough; it has to be emitted explicitly or it never lands.
      expect(JSON.parse(copilotHooks.getFileContent()).hooks.sessionStart[0].env).toEqual({
        LOG_LEVEL: "debug",
      });
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      const entry = parsed.hooks.sessionStart[0];
      expect(entry.command).toBe(".rulesync/hooks/session-start.sh");
      expect(entry.command).not.toContain("$CLAUDE_PROJECT_DIR");
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // Only the non-matcher hook should be present
      expect(parsed.hooks.preToolUse).toHaveLength(1);
      expect(parsed.hooks.preToolUse[0].command).toBe("all-tools.sh");
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.preToolUse).toHaveLength(1);
      expect(parsed.hooks.preToolUse[0].type).toBe("command");
      expect(parsed.hooks.preToolUse[0].command).toBe("lint.sh");
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      // copilot override replaces shared sessionStart
      expect(parsed.hooks.sessionStart[0].command).toBe("copilot-override.sh");
      // copilot-specific afterError is present
      expect(parsed.hooks.errorOccurred).toBeDefined();
      expect(parsed.hooks.errorOccurred[0].command).toBe("error-handler.sh");
    });

    it("should produce standalone file without merging existing content", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "echo start" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart[0].bash).toBe("run.sh");
      expect(parsed.hooks.sessionStart[0].powershell).toBe("run.ps1");
      expect(parsed.hooks.sessionStart[0].customKey).toBe(123);
    });

    it("should filter out canonical fields including loop_limit", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            {
              type: "command",
              command: "run.sh",
              loop_limit: 5,
              timeout: 10,
              unknownKey: "keep",
            },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const copilotHooks = await CopilotHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);

      const entry = parsed.hooks.sessionStart[0];
      expect(entry.type).toBe("command");
      expect(entry.command).toBe("run.sh");
      expect(entry.timeoutSec).toBe(10);
      expect(entry.unknownKey).toBe("keep");

      expect(entry.timeout).toBeUndefined();
      expect(entry.prompt).toBeUndefined();
      expect(entry.matcher).toBeUndefined();
      expect(entry.loop_limit).toBeUndefined();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => copilotHooks.toRulesyncHooks()).toThrow(/Failed to parse Copilot hooks content/);
    });

    it("should convert Copilot hooks with bash-only to canonical format", () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
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
      expect(json.hooks.beforeSubmitPrompt).toHaveLength(1);
      expect(json.hooks.beforeSubmitPrompt?.[0]?.command).toBe("log-prompt.sh");
      expect(json.hooks.afterError).toHaveLength(1);
      expect(json.hooks.afterError?.[0]?.command).toBe("handle-error.sh");
    });

    it("should map agentStop/subagentStop back to canonical stop/subagentStop", () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            agentStop: [{ type: "command", bash: "agent-stop.sh" }],
            subagentStop: [{ type: "command", bash: "subagent-stop.sh" }],
          },
        }),
        validate: false,
      });

      const json = copilotHooks.toRulesyncHooks().getJson();
      expect(json.hooks.stop).toHaveLength(1);
      expect(json.hooks.stop?.[0]?.command).toBe("agent-stop.sh");
      expect(json.hooks.subagentStop).toHaveLength(1);
      expect(json.hooks.subagentStop?.[0]?.command).toBe("subagent-stop.sh");
    });

    it("should convert Copilot hooks with powershell-only to canonical format", () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
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

    it("should always take bash when both bash and powershell are present", () => {
      const logger = createMockLogger();

      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
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

      const rulesyncHooks = copilotHooks.toRulesyncHooks({ logger });
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(json.hooks.sessionStart?.[0]?.shell).toBe("bash");
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        "Copilot hook has both bash and powershell commands; using bash and ignoring powershell, which the Linux-sandboxed cloud agent does not run.",
      );
    });

    it("should pick bash on Windows too, so import does not depend on the platform", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      const logger = createMockLogger();

      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
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

      const rulesyncHooks = copilotHooks.toRulesyncHooks({ logger });
      const json = rulesyncHooks.getJson();
      // The same file must import to the same canonical config everywhere, and
      // the cloud agent ignores `powershell` outright.
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      expect(json.hooks.sessionStart?.[0]?.shell).toBe("bash");
    });

    it("should round-trip the shell selector and env through import and re-export", async () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [
              { type: "command", powershell: "Write-Output hi", env: { LOG_LEVEL: "debug" } },
            ],
            preToolUse: [{ type: "command", command: "portable.sh" }],
          },
        }),
        validate: false,
      });

      const imported = copilotHooks.toRulesyncHooks().getJson();
      expect(imported.hooks.sessionStart?.[0]?.shell).toBe("powershell");
      expect(imported.hooks.sessionStart?.[0]?.env).toEqual({ LOG_LEVEL: "debug" });
      // A portable entry leaves `shell` unset, so re-export writes it back
      // portable rather than promoting it to a shell-specific field.
      expect(imported.hooks.preToolUse?.[0]?.shell).toBeUndefined();

      const reExported = JSON.parse(
        (
          await CopilotHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks: copilotHooks.toRulesyncHooks(),
            validate: false,
          })
        ).getFileContent(),
      );
      expect(reExported.hooks.sessionStart[0].powershell).toBe("Write-Output hi");
      expect(reExported.hooks.sessionStart[0].env).toEqual({ LOG_LEVEL: "debug" });
      expect(reExported.hooks.preToolUse[0].command).toBe("portable.sh");
    });

    it("should handle empty hooks", () => {
      const copilotHooks = new CopilotHooks({
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        validate: false,
      });
      expect(copilotHooks).toBeInstanceOf(CopilotHooks);
      const content = copilotHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart).toHaveLength(1);
    });

    it("should initialize empty hooks when copilot-hooks.json does not exist", async () => {
      const copilotHooks = await CopilotHooks.fromFile({
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: join(".github", "hooks"),
        relativeFilePath: "copilot-hooks.json",
      });
      expect(hooks).toBeInstanceOf(CopilotHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
