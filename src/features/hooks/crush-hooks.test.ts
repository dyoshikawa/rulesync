import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileContentIsEmptyPayload } from "../../utils/content-equivalence.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushHooks } from "./crush-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("CrushHooks", () => {
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

  const buildRulesyncHooks = (config: Record<string, unknown>): RulesyncHooks =>
    new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should point to crush.json in project mode", () => {
      expect(CrushHooks.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
    });

    it("should point to .config/crush/crush.json in global mode", () => {
      expect(CrushHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should emit PreToolUse command hooks with name, matcher and timeout", async () => {
      const logger = createMockLogger();
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            preToolUse: [
              {
                type: "command",
                name: "no-rm-rf",
                matcher: "^bash$",
                command: "./hooks/guard.sh",
                timeout: 10,
              },
              { command: "./hooks/log.sh", matcher: "*" },
              { type: "prompt", prompt: "Check the diff" },
            ],
            subagentStop: [{ type: "command", command: "./hooks/subagent.sh" }],
          },
        }),
        logger,
      });

      expect(hooks.getJson()).toEqual({
        hooks: {
          PreToolUse: [
            { name: "no-rm-rf", matcher: "^bash$", command: "./hooks/guard.sh", timeout: 10 },
            { command: "./hooks/log.sh" },
          ],
        },
      });
      // The prompt hook and the subagentStop event (which Crush does not
      // fire) are reported by the HooksProcessor, not a second time here.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn about and skip a command hook without a command", async () => {
      const logger = createMockLogger();
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ type: "command", name: "broken" }, { command: "./ok.sh" }] },
        }),
        logger,
      });

      expect(hooks.getJson()).toEqual({ hooks: { PreToolUse: [{ command: "./ok.sh" }] } });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"broken"'));
    });

    it("should round a fractional timeout up to whole seconds", async () => {
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./a.sh", timeout: 2.2 }] },
        }),
      });

      expect(hooks.getJson()).toEqual({
        hooks: { PreToolUse: [{ command: "./a.sh", timeout: 3 }] },
      });
    });

    it("should not create the config file for an empty payload at either scope", async () => {
      for (const global of [false, true]) {
        const hooks = await CrushHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
          global,
        });
        expect(
          fileContentIsEmptyPayload({
            filePath: hooks.getFilePath(),
            content: hooks.getFileContent(),
          }),
        ).toBe(true);
        expect(hooks.shouldSkipCreationWhenPayloadEmpty()).toBe(true);
      }
    });

    it("should map every canonical event Crush fires to its Crush name", async () => {
      const logger = createMockLogger();
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            postToolUse: [{ command: "./a.sh", matcher: "^edit$" }],
            postToolUseFailure: [{ command: "./b.sh", matcher: "^bash$" }],
            permissionRequest: [{ command: "./c.sh", matcher: "^mcp_" }],
            sessionStart: [{ command: "./d.sh" }],
            sessionEnd: [{ command: "./e.sh" }],
            beforeSubmitPrompt: [{ command: "./f.sh" }],
            stop: [{ command: "./g.sh" }],
            stopFailure: [{ command: "./h.sh" }],
            stopCancelled: [{ command: "./i.sh" }],
            preCompact: [{ command: "./j.sh" }],
            postCompact: [{ command: "./k.sh" }],
          },
        }),
        logger,
      });

      expect(hooks.getJson()).toEqual({
        hooks: {
          PostToolUse: [{ command: "./a.sh", matcher: "^edit$" }],
          PostToolUseFailure: [{ command: "./b.sh", matcher: "^bash$" }],
          PermissionRequest: [{ command: "./c.sh", matcher: "^mcp_" }],
          SessionStart: [{ command: "./d.sh" }],
          SessionEnd: [{ command: "./e.sh" }],
          TurnStart: [{ command: "./f.sh" }],
          TurnEnd: [{ command: "./g.sh" }],
          StopFailure: [{ command: "./h.sh" }],
          Interrupt: [{ command: "./i.sh" }],
          PreCompact: [{ command: "./j.sh" }],
          PostCompact: [{ command: "./k.sh" }],
        },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should drop a matcher with a warning on an event that carries no tool", async () => {
      const logger = createMockLogger();
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: {
            sessionStart: [{ command: "./start.sh", matcher: "startup" }],
            stop: [{ command: "./stop.sh", matcher: "*" }],
          },
          crush: {
            hooks: {
              turn_start: [{ command: "./turn.sh", matcher: "^bash$" }],
              PermissionResult: [{ command: "./result.sh", matcher: "^bash$" }],
            },
          },
        }),
        logger,
      });

      expect(hooks.getJson()).toEqual({
        hooks: {
          SessionStart: [{ command: "./start.sh" }],
          TurnEnd: [{ command: "./stop.sh" }],
          turn_start: [{ command: "./turn.sh" }],
          PermissionResult: [{ command: "./result.sh", matcher: "^bash$" }],
        },
      });
      // `*` already means "no matcher", so only the two real matchers warn.
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('on "sessionStart" hook'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('on "turn_start" hook'));
    });

    it("should apply the crush override per event", async () => {
      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./shared.sh" }] },
          crush: { hooks: { preToolUse: [{ command: "./crush-only.sh" }] } },
        }),
      });

      expect(hooks.getJson()).toEqual({
        hooks: { PreToolUse: [{ command: "./crush-only.sh" }] },
      });
    });

    it("should emit an event under the crush override verbatim so an import round-trips", async () => {
      await writeFileContent(
        join(testDir, "crush.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ command: "./pre.sh" }],
            PermissionResult: [{ command: "./result.sh", matcher: "bash" }],
          },
        }),
      );
      const imported = (await CrushHooks.fromFile({ outputRoot: testDir })).toRulesyncHooks();
      expect(imported.getJson()).toEqual({
        version: 1,
        hooks: { preToolUse: [{ type: "command", command: "./pre.sh" }] },
        crush: {
          hooks: {
            PermissionResult: [{ type: "command", command: "./result.sh", matcher: "bash" }],
          },
        },
      });

      const logger = createMockLogger();
      const regenerated = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks(imported.getJson()),
        logger,
      });
      expect(regenerated.getJson()).toEqual({
        hooks: {
          PreToolUse: [{ command: "./pre.sh" }],
          PermissionResult: [{ command: "./result.sh", matcher: "bash" }],
        },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should preserve unrelated keys and replace the hooks block wholesale", async () => {
      await writeFileContent(
        join(testDir, "crush.json"),
        JSON.stringify({
          providers: { anthropic: {} },
          mcp: { fs: { type: "stdio", command: "fs" } },
          hooks: { PreToolUse: [{ command: "./stale.sh" }], Stale: [{ command: "./x.sh" }] },
        }),
      );

      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./fresh.sh" }] },
        }),
      });

      expect(hooks.getJson()).toEqual({
        providers: { anthropic: {} },
        mcp: { fs: { type: "stdio", command: "fs" } },
        hooks: { PreToolUse: [{ command: "./fresh.sh" }] },
      });
    });

    it("should write into an existing .crush.json instead of crush.json", async () => {
      await writeFileContent(join(testDir, ".crush.json"), JSON.stringify({ options: {} }));

      const hooks = await CrushHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks({
          version: 1,
          hooks: { preToolUse: [{ command: "./a.sh" }] },
        }),
      });

      expect(hooks.getRelativeFilePath()).toBe(".crush.json");
      expect(hooks.getJson()).toEqual({
        options: {},
        hooks: { PreToolUse: [{ command: "./a.sh" }] },
      });
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(join(testDir, "crush.json"), "{ not json");

      await expect(
        CrushHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks: buildRulesyncHooks({ version: 1, hooks: {} }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read the global config from .config/crush/", async () => {
      await writeFileContent(
        join(testDir, ".config", "crush", "crush.json"),
        JSON.stringify({ hooks: { PreToolUse: [{ command: "./a.sh" }] } }),
      );

      const hooks = await CrushHooks.fromFile({ outputRoot: testDir, global: true });
      expect(hooks.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(hooks.getJson().hooks).toEqual({ PreToolUse: [{ command: "./a.sh" }] });
    });

    it("should default to an empty document when the file is missing", async () => {
      const hooks = await CrushHooks.fromFile({ outputRoot: testDir });
      expect(hooks.getJson()).toEqual({});
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map PreToolUse back to preToolUse and file unknown events under the override", () => {
      const hooks = new CrushHooks({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        // Raw JSON so `__proto__` is a real key rather than an object-literal
        // prototype assignment.
        fileContent: `{
          "providers": {},
          "hooks": {
            "PreToolUse": [
              { "name": "guard", "matcher": "^bash$", "command": "./guard.sh", "timeout": 10 },
              { "command": "./log.sh" },
              { "matcher": "no command" }
            ],
            "TurnEnd": [{ "command": "./after.sh" }],
            "PermissionResult": [{ "command": "./result.sh" }],
            "__proto__": [{ "command": "./evil.sh" }]
          }
        }`,
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({
        preToolUse: [
          { type: "command", name: "guard", matcher: "^bash$", command: "./guard.sh", timeout: 10 },
          { type: "command", command: "./log.sh" },
        ],
        stop: [{ type: "command", command: "./after.sh" }],
      });
      expect(json.crush).toEqual({
        hooks: { PermissionResult: [{ type: "command", command: "./result.sh" }] },
      });
    });

    it("should map every Crush event with a canonical counterpart back to it", () => {
      const hooks = new CrushHooks({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: JSON.stringify({
          hooks: {
            PostToolUse: [{ command: "./a.sh", matcher: "^bash$" }],
            PostToolUseFailure: [{ command: "./b.sh" }],
            PermissionRequest: [{ command: "./c.sh" }],
            SessionStart: [{ command: "./d.sh" }],
            SessionEnd: [{ command: "./e.sh" }],
            TurnStart: [{ command: "./f.sh" }],
            turn_end: [{ command: "./g.sh" }],
            StopFailure: [{ command: "./h.sh" }],
            Interrupt: [{ command: "./i.sh" }],
            PreCompact: [{ command: "./j.sh" }],
            PostCompact: [{ command: "./k.sh" }],
          },
        }),
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({
        postToolUse: [{ type: "command", command: "./a.sh", matcher: "^bash$" }],
        postToolUseFailure: [{ type: "command", command: "./b.sh" }],
        permissionRequest: [{ type: "command", command: "./c.sh" }],
        sessionStart: [{ type: "command", command: "./d.sh" }],
        sessionEnd: [{ type: "command", command: "./e.sh" }],
        beforeSubmitPrompt: [{ type: "command", command: "./f.sh" }],
        stop: [{ type: "command", command: "./g.sh" }],
        stopFailure: [{ type: "command", command: "./h.sh" }],
        stopCancelled: [{ type: "command", command: "./i.sh" }],
        preCompact: [{ type: "command", command: "./j.sh" }],
        postCompact: [{ type: "command", command: "./k.sh" }],
      });
      expect(json.crush).toBeUndefined();
    });

    it("should fold the case- and underscore-insensitive spellings Crush accepts", () => {
      const hooks = new CrushHooks({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: JSON.stringify({
          hooks: {
            pre_tool_use: [{ command: "./a.sh" }],
            Pre_Tool_Use: [{ command: "./b.sh" }],
          },
        }),
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({
        preToolUse: [
          { type: "command", command: "./a.sh" },
          { type: "command", command: "./b.sh" },
        ],
      });
      expect(json.crush).toBeUndefined();
    });

    it("should yield no hooks when the config has no hooks block", () => {
      const hooks = new CrushHooks({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(hooks.toRulesyncHooks().getJson().hooks).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should return a well-formed, non-deletable instance", () => {
      const hooks = CrushHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
      expect(hooks.getJson()).toEqual({ hooks: {} });
      expect(hooks.isDeletable()).toBe(false);
    });
  });
});
