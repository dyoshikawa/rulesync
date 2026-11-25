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
            ],
            SubagentStop: [{ hooks: [{ type: "command", command: "echo done" }] }],
          },
        }),
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toEqual([
        { type: "command", command: "echo read", timeout: 5, matcher: "Read" },
      ]);
      expect(json.hooks.subagentStop).toEqual([{ type: "command", command: "echo done" }]);
    });
  });
});
