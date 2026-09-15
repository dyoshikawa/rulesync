import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
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
            postToolUse: [{ type: "command", command: "./hooks/after.sh" }],
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
      // The prompt hook and the postToolUse event are both reported.
      expect(logger.warn).toHaveBeenCalledTimes(2);
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
            "PostToolUse": [{ "command": "./after.sh" }],
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
      });
      expect(json.crush).toEqual({
        hooks: { PostToolUse: [{ type: "command", command: "./after.sh" }] },
      });
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
