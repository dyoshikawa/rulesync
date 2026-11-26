import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { OpenbitfunHooks } from "./openbitfun-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function makeRulesyncHooks(config: unknown): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
  });
}

describe("OpenbitfunHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should use .openbitfun/config/hooks.json in project scope", () => {
      expect(OpenbitfunHooks.getSettablePaths()).toEqual({
        relativeDirPath: join(".openbitfun", "config"),
        relativeFilePath: "hooks.json",
      });
    });

    it.each([
      ["linux", join(".config", "openbitfun", "config")],
      ["darwin", join("Library", "Application Support", "openbitfun", "config")],
      ["win32", join("AppData", "Roaming", "openbitfun", "config")],
    ] as const)("should use the %s user config dir in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(OpenbitfunHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: expected,
        relativeFilePath: "hooks.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should write the Codex hooks.json shape with PascalCase event names", async () => {
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            sessionStart: [{ command: "echo start" }],
            preToolUse: [{ command: "./scripts/lint.sh", matcher: "ExecCommand", timeout: 30 }],
            beforeSubmitPrompt: [{ command: "echo prompt" }],
          },
        }),
      });

      expect(hooks.getRelativeDirPath()).toBe(join(".openbitfun", "config"));
      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
          PreToolUse: [
            {
              matcher: "ExecCommand",
              hooks: [{ type: "command", command: "./scripts/lint.sh", timeout: 30 }],
            },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }],
        },
      });
    });

    it("should drop events and handler types OpenBitFun does not run", async () => {
      const logger = createMockLogger();
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            stopCancelled: [{ command: "echo interrupt" }],
            preModelInvocation: [{ command: "echo model" }],
            stop: [{ type: "prompt", prompt: "Are you done?" }, { command: "echo stop" }],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] },
      });
    });

    it("should translate a Bash matcher to OpenBitFun's ExecCommand tool", async () => {
      const logger = createMockLogger();
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [
              { command: "./guard.sh", matcher: "Bash" },
              { command: "./edit-guard.sh", matcher: "^(Bash|Edit)$" },
            ],
            permissionRequest: [{ command: "./ask.sh", matcher: "Bash" }],
          },
        }),
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.PreToolUse.map((group: { matcher: string }) => group.matcher)).toEqual([
        "ExecCommand",
        "^(ExecCommand|Edit)$",
      ]);
      expect(parsed.hooks.PermissionRequest[0].matcher).toBe("ExecCommand");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn about tool-gating matchers naming tools OpenBitFun lacks", async () => {
      const logger = createMockLogger();
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [{ command: "./guard.sh", matcher: "MultiEdit|Write" }],
            postToolUse: [{ command: "./log.sh", matcher: "NotebookEdit" }],
          },
        }),
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("MultiEdit|Write");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain('"MultiEdit"');
    });

    it("should warn about tool-gating matchers spelling a tool name in another case (issue #3971)", async () => {
      const logger = createMockLogger();
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [
              { command: "./guard.sh", matcher: "bash" },
              { command: "./ci-guard.sh", matcher: "(?i)bash" },
              { command: "./read-guard.sh", matcher: "read|Write" },
            ],
            postToolUse: [{ command: "./log.sh", matcher: "bash" }],
          },
        }),
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.PreToolUse.map((group: { matcher: string }) => group.matcher)).toEqual([
        "bash",
        "(?i)bash",
        "read|Write",
      ]);
      const messages = logger.warn.mock.calls.map(([message]) => String(message));
      expect(messages).toHaveLength(3);
      expect(messages[0]).toContain('"bash" in the "preToolUse" matcher "bash" never matches');
      expect(messages[0]).toContain('"ExecCommand"');
      expect(messages[1]).toContain('matcher "(?i)bash"');
      expect(messages[2]).toContain('"read" in the "preToolUse" matcher "read|Write"');
      expect(messages[2]).toContain('"Read"');
    });

    it("should not warn about a case-insensitive matcher that still matches OpenBitFun's spelling (issue #3971)", async () => {
      const logger = createMockLogger();
      await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            preToolUse: [
              { command: "./read-guard.sh", matcher: "(?i)read|edit" },
              { command: "./mcp-guard.sh", matcher: "mcp__github__.*" },
            ],
          },
        }),
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should skip a handler whose timeout OpenBitFun treats as invalid", async () => {
      const logger = createMockLogger();
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        logger,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {
            stop: [
              { command: "echo zero", timeout: 0 },
              { command: "echo ok", timeout: 5 },
            ],
          },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo ok", timeout: 5 }] }] },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("is not a positive integer"),
      );
    });

    it("should merge hooks from the openbitfun override section", async () => {
      const hooks = await OpenbitfunHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          hooks: {},
          openbitfun: { hooks: { postCompact: [{ command: "echo compacted" }] } },
          codexcli: { hooks: { postCompact: [{ command: "echo codex-only" }] } },
        }),
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        hooks: { PostCompact: [{ hooks: [{ type: "command", command: "echo compacted" }] }] },
      });
    });
  });

  describe("fromFile", () => {
    it("should warn about a moved XDG config home when importing globally (issue #3971)", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.stubEnv("HOME_DIR", testDir);
      vi.stubEnv("XDG_CONFIG_HOME", join("/", "srv", "openbitfun-hooks-import-xdg"));
      const logger = createMockLogger();
      try {
        await OpenbitfunHooks.fromFile({ outputRoot: testDir, global: true, logger });
      } finally {
        vi.unstubAllEnvs();
      }

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("$XDG_CONFIG_HOME"));
    });

    it("should not warn about XDG variables when importing a project", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.stubEnv("XDG_CONFIG_HOME", join("/", "srv", "openbitfun-hooks-project-xdg"));
      const logger = createMockLogger();
      try {
        await OpenbitfunHooks.fromFile({ outputRoot: testDir, logger });
      } finally {
        vi.unstubAllEnvs();
      }

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import a hooks.json back to canonical hooks", () => {
      const hooks = new OpenbitfunHooks({
        outputRoot: testDir,
        relativeDirPath: join(".openbitfun", "config"),
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: "Read", hooks: [{ type: "command", command: "echo read", timeout: 5 }] },
              { matcher: "^ExecCommand$", hooks: [{ type: "command", command: "echo shell" }] },
            ],
            SubagentStop: [{ hooks: [{ type: "command", command: "echo done" }] }],
          },
        }),
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([
        { type: "command", command: "echo read", timeout: 5, matcher: "Read" },
        { type: "command", command: "echo shell", matcher: "^Bash$" },
      ]);
      expect(json.hooks.subagentStop).toEqual([{ type: "command", command: "echo done" }]);
    });
  });
});
