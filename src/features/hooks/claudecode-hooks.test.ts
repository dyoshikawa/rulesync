import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDECODE_SETTINGS_SCHEMA_URL } from "../../constants/claudecode-paths.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { HooksConfigSchema } from "../../types/hooks.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

describe("ClaudecodeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .claude and settings.json for project mode", () => {
      const paths = ClaudecodeHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".claude", relativeFilePath: "settings.json" });
    });

    it("should return .claude and settings.json for global mode", () => {
      const paths = ClaudecodeHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".claude", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should warn when a command-only field is authored on a non-command hook", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "prompt", prompt: "Review this", shell: "bash", async: true }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const emitted = JSON.parse(claudecodeHooks.getFileContent()).hooks.PreToolUse[0].hooks[0];
      expect(emitted).not.toHaveProperty("shell");
      expect(emitted).not.toHaveProperty("async");
      for (const field of ["shell", "async"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`Dropping "${field}" from a "prompt" hook`),
        );
      }
    });

    it("should filter shared hooks to Claude-supported events and convert to PascalCase", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
    });

    it("should emit the documented per-handler fields and the DirectoryAdded event", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          directoryAdded: [{ command: "on-add-dir.sh" }],
          preToolUse: [
            {
              command: "node",
              args: ["./scripts/check.js", "--strict"],
              async: true,
              asyncRewake: true,
              shell: "bash",
              statusMessage: "Checking",
              once: true,
              continueOnBlock: true,
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.DirectoryAdded).toBeDefined();
      expect(parsed.hooks.PreToolUse[0].hooks[0]).toMatchObject({
        type: "command",
        command: "node",
        args: ["./scripts/check.js", "--strict"],
        async: true,
        asyncRewake: true,
        shell: "bash",
        statusMessage: "Checking",
        once: true,
        continueOnBlock: true,
      });
    });

    it("should use the braced placeholder for an exec-form command", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            // No shell to strip the quotes the shell form adds, but Claude Code
            // substitutes the braced placeholder itself. An empty `args` selects
            // the exec form too — the docs' own example is `"args": []`.
            { command: "./scripts/exec.sh", args: ["--strict"] },
            { command: "./scripts/empty-args.sh", args: [] },
            { command: "./scripts/shell-form.sh" },
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const hooks = JSON.parse(claudecodeHooks.getFileContent()).hooks.PreToolUse[0].hooks;
      expect(hooks[0].command).toBe("${CLAUDE_PROJECT_DIR}/scripts/exec.sh");
      expect(hooks[1].command).toBe("${CLAUDE_PROJECT_DIR}/scripts/empty-args.sh");
      expect(hooks[2].command).toBe('"$CLAUDE_PROJECT_DIR"/scripts/shell-form.sh');
    });

    it("should keep command-only fields off non-command hooks", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          // `args`, `async`, `asyncRewake` and `shell` are documented on command
          // hooks only; `statusMessage` and `once` are common to every type.
          preToolUse: [
            {
              type: "http",
              url: "https://example.com/hook",
              args: ["--strict"],
              async: true,
              asyncRewake: true,
              shell: "bash",
              statusMessage: "Calling",
              once: true,
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const hook = JSON.parse(claudecodeHooks.getFileContent()).hooks.PreToolUse[0].hooks[0];
      expect(hook.args).toBeUndefined();
      expect(hook.async).toBeUndefined();
      expect(hook.asyncRewake).toBeUndefined();
      expect(hook.shell).toBeUndefined();
      expect(hook.statusMessage).toBe("Calling");
      expect(hook.once).toBe(true);
    });

    it("should emit http/mcp_tool/agent hooks with their type-specific payload fields", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          postToolUse: [
            {
              type: "http",
              url: "http://localhost:8080/hooks/post-use",
              headers: { Authorization: "Bearer $MY_TOKEN" },
              allowedEnvVars: ["MY_TOKEN"],
              timeout: 10,
              matcher: "Write|Edit",
            },
            {
              type: "mcp_tool",
              server: "my_server",
              tool: "security_scan",
              input: { file_path: "${tool_input.file_path}" },
              matcher: "Write|Edit",
            },
            { type: "agent", prompt: "Review this change: $ARGUMENTS", model: "haiku" },
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      const groups = parsed.hooks.PostToolUse;
      const allHooks = groups.flatMap((g: { hooks: Record<string, unknown>[] }) => g.hooks);
      const httpHook = allHooks.find((h: { type?: string }) => h.type === "http");
      expect(httpHook).toMatchObject({
        url: "http://localhost:8080/hooks/post-use",
        headers: { Authorization: "Bearer $MY_TOKEN" },
        allowedEnvVars: ["MY_TOKEN"],
        timeout: 10,
      });
      const mcpHook = allHooks.find((h: { type?: string }) => h.type === "mcp_tool");
      expect(mcpHook).toMatchObject({
        server: "my_server",
        tool: "security_scan",
        input: { file_path: "${tool_input.file_path}" },
      });
      const agentHook = allHooks.find((h: { type?: string }) => h.type === "agent");
      expect(agentHook).toMatchObject({
        prompt: "Review this change: $ARGUMENTS",
        model: "haiku",
      });
    });

    it("should emit the tool-event `if` condition on generate (#2225)", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            {
              type: "command",
              command: "block-rm.sh",
              matcher: "Bash",
              if: "Bash(rm *)",
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      const hook = parsed.hooks.PreToolUse[0].hooks[0];
      expect(hook.if).toBe("Bash(rm *)");
      expect(hook.command).toBe("block-rm.sh");
    });

    it("should not leak type-specific fields onto other hook types", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          // A command hook wrongly authored with http/mcp_tool payloads.
          stop: [{ type: "command", command: "audit.sh", url: "https://example.com", server: "s" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      const hook = parsed.hooks.Stop[0].hooks[0];
      expect(hook.command).toBe("audit.sh");
      expect(hook.url).toBeUndefined();
      expect(hook.server).toBeUndefined();
    });

    it("should support the current documented Claude Code hook events (#1628)", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          instructionsLoaded: [{ command: "a.sh" }],
          userPromptExpansion: [{ command: "b.sh" }],
          postToolUseFailure: [{ command: "c.sh" }],
          postToolBatch: [{ command: "d.sh" }],
          permissionDenied: [{ command: "e.sh" }],
          subagentStart: [{ command: "f.sh" }],
          taskCreated: [{ command: "g.sh" }],
          taskCompleted: [{ command: "h.sh" }],
          stopFailure: [{ command: "i.sh" }],
          teammateIdle: [{ command: "j.sh" }],
          configChange: [{ command: "k.sh" }],
          cwdChanged: [{ command: "l.sh" }],
          fileChanged: [{ command: "m.sh" }],
          postCompact: [{ command: "n.sh" }],
          elicitation: [{ command: "o.sh" }],
          elicitationResult: [{ command: "p.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      // Each canonical event is emitted under its documented PascalCase name.
      for (const eventName of [
        "InstructionsLoaded",
        "UserPromptExpansion",
        "PostToolUseFailure",
        "PostToolBatch",
        "PermissionDenied",
        "SubagentStart",
        "TaskCreated",
        "TaskCompleted",
        "StopFailure",
        "TeammateIdle",
        "ConfigChange",
        "CwdChanged",
        "FileChanged",
        "PostCompact",
        "Elicitation",
        "ElicitationResult",
      ]) {
        expect(parsed.hooks[eventName], `missing ${eventName}`).toBeDefined();
      }
    });

    it("omits the matcher for no-matcher events but keeps it for matcher events (#1628)", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          // No-matcher event: matcher must be dropped.
          taskCreated: [{ matcher: "Bash", command: "a.sh" }],
          // Matcher-supporting event: matcher must be preserved.
          postToolUseFailure: [{ matcher: "Bash", command: "b.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.TaskCreated[0].matcher).toBeUndefined();
      expect(parsed.hooks.PostToolUseFailure[0].matcher).toBe("Bash");
    });

    it("keeps the matcher on DirectoryAdded", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            directoryAdded: [{ matcher: "slash_command", command: "a.sh" }],
          },
        }),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.DirectoryAdded[0].matcher).toBe("slash_command");
    });

    it("should only prefix dot-relative commands with $CLAUDE_PROJECT_DIR", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: ".rulesync/hooks/session-start.sh" },
            { type: "command", command: "npx prettier --write ./src/hooks/format.ts" },
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      const sessionStartEntry = parsed.hooks.SessionStart[0];
      expect(sessionStartEntry).toBeDefined();
      expect(sessionStartEntry.matcher).toBeUndefined();
      expect(sessionStartEntry.hooks[0].command).toContain("$CLAUDE_PROJECT_DIR");
      expect(sessionStartEntry.hooks[0].command).toContain(".rulesync/hooks/session-start.sh");
      expect(sessionStartEntry.hooks[1].command).toBe("npx prettier --write ./src/hooks/format.ts");
    });

    it("should quote only the $CLAUDE_PROJECT_DIR variable so it survives word-splitting on project paths with spaces", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "./.rulesync/hooks/session-start.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        '"$CLAUDE_PROJECT_DIR"/.rulesync/hooks/session-start.sh',
      );
    });

    it("should keep trailing arguments outside the quotes so they still split as separate words", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "./scripts/format.sh --fix --quiet" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        '"$CLAUDE_PROJECT_DIR"/scripts/format.sh --fix --quiet',
      );
    });

    it("should merge config.claudecode.hooks on top of shared hooks", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        claudecode: {
          hooks: {
            notification: [
              {
                matcher: "permission_prompt",
                command: "$CLAUDE_PROJECT_DIR/.claude/hooks/notify.sh",
              },
            ],
            sessionStart: [{ type: "command", command: "claude-override.sh" }],
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("claude-override.sh");
      expect(parsed.hooks.Notification).toBeDefined();
      expect(parsed.hooks.Notification[0].matcher).toBe("permission_prompt");
    });

    it("should throw error with descriptive message when existing settings.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        ClaudecodeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse shared config at .*settings\.json/);
    });

    it("should merge rulesync hooks into existing .claude/settings.json content", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ otherKey: "preserved" }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
    });

    it("should keep an existing third-party command on regenerate", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: "echo start" },
                  { type: "command", command: "other-tool-hook claude-hook" },
                ],
              },
            ],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          preserveUnowned: true,
          hooks: { sessionStart: [{ command: "echo start" }] },
        }),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await ClaudecodeHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: false,
          })
        ).getFileContent(),
      );
      const commands = parsed.hooks.SessionStart[0].hooks.map(
        (handler: { command: string }) => handler.command,
      );
      expect(commands).toEqual(["echo start", "other-tool-hook claude-hook"]);
    });

    it("should replace existing third-party commands unless preserveUnowned is set", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: "command", command: "echo start" },
                  { type: "command", command: "other-tool-hook claude-hook" },
                ],
              },
            ],
          },
        }),
      );

      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ command: "echo start" }] },
        }),
        validate: false,
      });

      const parsed = JSON.parse(
        (
          await ClaudecodeHooks.fromRulesyncHooks({
            outputRoot: testDir,
            rulesyncHooks,
            validate: false,
          })
        ).getFileContent(),
      );
      const commands = parsed.hooks.SessionStart[0].hooks.map(
        (handler: { command: string }) => handler.command,
      );
      expect(commands).toEqual(["echo start"]);
    });
  });

  describe("$schema", () => {
    const rulesyncHooks = () =>
      new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { preToolUse: [{ command: "echo hi" }] },
        }),
        validate: false,
      });

    it.each([{ global: false }, { global: true }])(
      "adds $schema first when hooks alone writes a settings file (global: $global)",
      async ({ global }) => {
        const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: rulesyncHooks(),
          validate: false,
          global,
        });

        const content = JSON.parse(claudecodeHooks.getFileContent());
        expect(Object.keys(content)).toEqual(["$schema", "hooks"]);
        expect(content.$schema).toBe(CLAUDECODE_SETTINGS_SCHEMA_URL);
      },
    );

    it("keeps a $schema the settings file already states", async () => {
      const pinned = "https://mirror.example.test/claude-code-settings.json";
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ $schema: pinned, model: "opus" }, null, 2),
      );

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: rulesyncHooks(),
        validate: false,
      });

      const content = JSON.parse(claudecodeHooks.getFileContent());
      expect(content.$schema).toBe(pinned);
      expect(Object.keys(content)).toEqual(["$schema", "model", "hooks"]);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => claudecodeHooks.toRulesyncHooks()).toThrow(
        /Failed to parse Claude hooks content/,
      );
    });

    it("should import DirectoryAdded and the per-handler fields, undoing the exec-form prefix", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            DirectoryAdded: [{ hooks: [{ command: "on-add-dir.sh" }] }],
            PreToolUse: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "${CLAUDE_PROJECT_DIR}/scripts/check.js",
                    args: ["--strict"],
                    async: true,
                    asyncRewake: true,
                    shell: "bash",
                    statusMessage: "Checking",
                    once: true,
                    continueOnBlock: true,
                  },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const parsed = claudecodeHooks.toRulesyncHooks().getJson();
      expect(parsed.hooks.directoryAdded).toBeDefined();
      expect(parsed.hooks.preToolUse?.[0]).toMatchObject({
        type: "command",
        // The braced placeholder generate wrote comes back as the relative path.
        command: "./scripts/check.js",
        args: ["--strict"],
        async: true,
        asyncRewake: true,
        shell: "bash",
        statusMessage: "Checking",
        once: true,
        continueOnBlock: true,
      });
    });

    it("should convert Claude PascalCase hooks to canonical camelCase", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/echo.sh" }] },
            ],
            Stop: [{ hooks: [{ command: "audit.sh" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart?.[0]?.command).toContain("echo.sh");
      expect(json.hooks.stop).toHaveLength(1);
    });

    it("should read the tool-event `if` condition back on import (#2225)", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "block-rm.sh", if: "Bash(rm *)" }],
              },
            ],
          },
        }),
        validate: false,
      });

      const json = claudecodeHooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse?.[0]?.if).toBe("Bash(rm *)");
      expect(json.hooks.preToolUse?.[0]?.matcher).toBe("Bash");
    });

    it("should round-trip the tool-event `if` condition through generate then import (#2225)", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "block-rm.sh", matcher: "Bash", if: "Bash(rm *)" },
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

      const generated = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const reimported = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: generated.getFileContent(),
        validate: false,
      });

      const json = reimported.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse?.[0]?.if).toBe("Bash(rm *)");
    });

    it("should strip the quoted $CLAUDE_PROJECT_DIR prefix back to a ./-relative command", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR"/echo.sh' }] },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("./echo.sh");
    });

    it("should strip the quoted $CLAUDE_PROJECT_DIR prefix while preserving trailing arguments", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: '"$CLAUDE_PROJECT_DIR"/scripts/format.sh --fix --quiet',
                  },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("./scripts/format.sh --fix --quiet");
    });

    it("should preserve http/mcp_tool/agent hooks with their payload fields on import", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PostToolUse: [
              {
                matcher: "Write|Edit",
                hooks: [
                  {
                    type: "http",
                    url: "http://localhost:8080/hooks/post-use",
                    headers: { Authorization: "Bearer $MY_TOKEN" },
                    allowedEnvVars: ["MY_TOKEN"],
                  },
                  {
                    type: "mcp_tool",
                    server: "my_server",
                    tool: "security_scan",
                    input: { file_path: "${tool_input.file_path}" },
                  },
                  { type: "agent", prompt: "Review: $ARGUMENTS", model: "haiku" },
                ],
              },
            ],
          },
        }),
        validate: false,
      });

      const json = claudecodeHooks.toRulesyncHooks().getJson();
      const defs = json.hooks.postToolUse ?? [];
      expect(defs[0]).toMatchObject({
        type: "http",
        url: "http://localhost:8080/hooks/post-use",
        headers: { Authorization: "Bearer $MY_TOKEN" },
        allowedEnvVars: ["MY_TOKEN"],
        matcher: "Write|Edit",
      });
      expect(defs[1]).toMatchObject({
        type: "mcp_tool",
        server: "my_server",
        tool: "security_scan",
        input: { file_path: "${tool_input.file_path}" },
      });
      expect(defs[2]).toMatchObject({
        type: "agent",
        prompt: "Review: $ARGUMENTS",
        model: "haiku",
      });
    });

    it("should coerce unknown hook types to command on import", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "webhook", command: "audit.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = claudecodeHooks.toRulesyncHooks().getJson();
      expect(json.hooks.stop?.[0]).toMatchObject({ type: "command", command: "audit.sh" });
    });

    it("should route unmapped native event names into the claudecode override block", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
            // A hypothetical event Claude Code ships before rulesync maps it.
            BrandNewEvent: [{ hooks: [{ type: "command", command: "echo new" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart?.[0]?.command).toBe("echo start");
      // The unmapped key must not land in the top-level hooks record (whose
      // keys are restricted to canonical event names)...
      expect(json.hooks.BrandNewEvent).toBeUndefined();
      // ...but under the claudecode override block, so the imported file still
      // passes canonical validation on the next generate run.
      const overrideHooks = (json as { claudecode?: { hooks?: Record<string, unknown[]> } })
        .claudecode?.hooks;
      expect(overrideHooks?.BrandNewEvent).toHaveLength(1);
      expect(HooksConfigSchema.safeParse(json).success).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should load from .claude/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const claudecodeHooks = await ClaudecodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(claudecodeHooks).toBeInstanceOf(ClaudecodeHooks);
      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toEqual([]);
    });

    it("should initialize empty hooks when .claude/settings.json does not exist", async () => {
      const claudecodeHooks = await ClaudecodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(claudecodeHooks).toBeInstanceOf(ClaudecodeHooks);
      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncHooks - worktree events", () => {
    it("should generate WorktreeCreate and WorktreeRemove events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: ".rulesync/hooks/worktree-create.sh" }],
          worktreeRemove: [{ type: "command", command: ".rulesync/hooks/worktree-remove.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeRemove).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].hooks[0].command).toContain("worktree-create.sh");
      expect(parsed.hooks.WorktreeRemove[0].hooks[0].command).toContain("worktree-remove.sh");
    });

    it("should NOT emit matcher for worktreeCreate and worktreeRemove even if defined in config", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: "create.sh", matcher: "*.js" }],
          worktreeRemove: [{ type: "command", command: "remove.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].matcher).toBeUndefined();
      expect(parsed.hooks.WorktreeRemove).toBeDefined();
      expect(parsed.hooks.WorktreeRemove[0].matcher).toBeUndefined();
    });

    it("should NOT emit matcher for messageDisplay even if defined in config", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          messageDisplay: [{ type: "command", command: "display.sh", matcher: "*.md" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.MessageDisplay).toBeDefined();
      expect(parsed.hooks.MessageDisplay[0].matcher).toBeUndefined();
    });

    it("should drop a matcher on UserPromptSubmit and Stop, which take none", async () => {
      // Both are in the docs' no-matcher table; before, a matcher authored on
      // them was written into settings.json and silently ignored upstream.
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const warnSpy = vi.spyOn(logger, "warn");

      const config = {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "prompt.sh", matcher: "*.js" }],
          stop: [{ command: "stop.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(claudecodeHooks.getFileContent());
      expect(parsed.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
      expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "beforeSubmitPrompt" hook will be ignored'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.ts" on "stop" hook will be ignored'),
      );
    });

    it("should warn when matcher is defined on worktree events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const warnSpy = vi.spyOn(logger, "warn");

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: "create.sh", matcher: "*.js" }],
          worktreeRemove: [{ type: "command", command: "remove.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "worktreeCreate" hook will be ignored'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.ts" on "worktreeRemove" hook will be ignored'),
      );
    });

    it("should NOT emit matcher for worktree events in claudecode-specific config", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {},
        claudecode: {
          hooks: {
            worktreeCreate: [
              { type: "command", command: "create-claude.sh", matcher: "should-be-ignored" },
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

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].matcher).toBeUndefined();
    });

    it("should keep matcher for non-worktree events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "session.sh", matcher: "*.js" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionStart[0].matcher).toBe("*.js");
    });
  });

  describe("toRulesyncHooks - worktree events", () => {
    it("should import WorktreeCreate and WorktreeRemove back to canonical names", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            WorktreeCreate: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/create.sh" }] },
            ],
            WorktreeRemove: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/remove.sh" }] },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.worktreeCreate).toHaveLength(1);
      expect(json.hooks.worktreeCreate?.[0]?.command).toContain("create.sh");
      expect(json.hooks.worktreeRemove).toHaveLength(1);
      expect(json.hooks.worktreeRemove?.[0]?.command).toContain("remove.sh");
    });
  });

  describe("forDeletion", () => {
    it("should return ClaudecodeHooks instance with empty hooks for deletion path", () => {
      const hooks = ClaudecodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });
      expect(hooks).toBeInstanceOf(ClaudecodeHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
