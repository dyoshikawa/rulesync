import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReasonixHooks } from "./reasonix-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

describe("ReasonixHooks", () => {
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
    it("should return .reasonix and settings.json for project mode", () => {
      const paths = ReasonixHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".reasonix", relativeFilePath: "settings.json" });
    });

    it("should return .reasonix and settings.json for global mode", () => {
      const paths = ReasonixHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".reasonix", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to the four documented Reasonix events", async () => {
      await ensureDir(join(testDir, ".reasonix"));
      await writeFileContent(join(testDir, ".reasonix", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/pre-tool.sh" }],
          postToolUse: [{ command: ".rulesync/hooks/post-tool.sh" }],
          beforeSubmitPrompt: [{ command: ".rulesync/hooks/prompt.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          sessionStart: [{ command: ".rulesync/hooks/session-start.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.PostToolUse).toBeDefined();
      expect(parsed.hooks.UserPromptSubmit).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      // sessionStart has no Reasonix mapping in the scoped event set.
      expect(parsed.hooks.SessionStart).toBeUndefined();
    });

    it("should emit a flat array of hook objects per event (no matcher-group wrapper)", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            {
              command: "node .reasonix/hooks/check-bash.js",
              matcher: "bash",
              description: "Block dangerous shell commands",
              timeout: 5,
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

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toEqual([
        {
          match: "bash",
          command: "node .reasonix/hooks/check-bash.js",
          description: "Block dangerous shell commands",
          timeout: 5000,
        },
      ]);
    });

    it("should convert canonical timeout (seconds) to Reasonix timeout (milliseconds)", async () => {
      const config = {
        version: 1,
        hooks: {
          stop: [{ command: "echo done", timeout: 3 }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.Stop[0].timeout).toBe(3000);
    });

    it("should drop the matcher on non-tool events with a warning", async () => {
      const config = {
        version: 1,
        hooks: {
          stop: [{ command: "echo done", matcher: "bash" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.Stop[0].match).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not support matchers"),
      );
    });

    it("should skip non-command hook types (no Reasonix equivalent)", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "prompt", prompt: "Are you sure?" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeUndefined();
    });

    it("should merge config.reasonix.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          stop: [{ command: "shared.sh" }],
        },
        reasonix: {
          hooks: {
            stop: [{ command: "reasonix-override.sh" }],
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

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.Stop[0].command).toBe("reasonix-override.sh");
    });

    it("should merge into existing .reasonix/settings.json content, preserving other keys", async () => {
      await ensureDir(join(testDir, ".reasonix"));
      await writeFileContent(
        join(testDir, ".reasonix", "settings.json"),
        JSON.stringify({ otherKey: "preserved" }),
      );

      const config = {
        version: 1,
        hooks: { stop: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks.Stop).toBeDefined();
    });

    it("should throw error with descriptive message when existing settings.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".reasonix"));
      await writeFileContent(join(testDir, ".reasonix", "settings.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        ReasonixHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse existing Reasonix settings/);
    });

    it("should write to the global path when global is true", async () => {
      const config = { version: 1, hooks: { stop: [{ command: "echo" }] } };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const reasonixHooks = await ReasonixHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(reasonixHooks.getRelativeDirPath()).toBe(".reasonix");
      expect(reasonixHooks.getRelativeFilePath()).toBe("settings.json");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const reasonixHooks = new ReasonixHooks({
        outputRoot: testDir,
        relativeDirPath: ".reasonix",
        relativeFilePath: "settings.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => reasonixHooks.toRulesyncHooks()).toThrow(/Failed to parse Reasonix hooks/);
    });

    it("should convert Reasonix events to canonical camelCase", () => {
      const reasonixHooks = new ReasonixHooks({
        outputRoot: testDir,
        relativeDirPath: ".reasonix",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [{ match: "bash", command: "echo.sh", timeout: 5000 }],
            Stop: [{ command: "audit.sh" }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = reasonixHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.preToolUse).toHaveLength(1);
      expect(json.hooks.preToolUse?.[0]?.command).toBe("echo.sh");
      expect(json.hooks.preToolUse?.[0]?.matcher).toBe("bash");
      expect(json.hooks.preToolUse?.[0]?.timeout).toBe(5);
      expect(json.hooks.stop).toHaveLength(1);
      expect(json.hooks.stop?.[0]?.command).toBe("audit.sh");
    });

    it("should handle an empty or missing hooks key", () => {
      const reasonixHooks = new ReasonixHooks({
        outputRoot: testDir,
        relativeDirPath: ".reasonix",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({}),
        validate: false,
      });

      const rulesyncHooks = reasonixHooks.toRulesyncHooks();
      expect(rulesyncHooks.getJson().hooks).toEqual({});
    });
  });

  describe("fromFile", () => {
    it("should load from .reasonix/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".reasonix"));
      await writeFileContent(
        join(testDir, ".reasonix", "settings.json"),
        JSON.stringify({ hooks: { Stop: [{ command: "echo" }] } }),
      );

      const reasonixHooks = await ReasonixHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(reasonixHooks).toBeInstanceOf(ReasonixHooks);
      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks.Stop).toEqual([{ command: "echo" }]);
    });

    it("should initialize empty hooks when .reasonix/settings.json does not exist", async () => {
      const reasonixHooks = await ReasonixHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(reasonixHooks).toBeInstanceOf(ReasonixHooks);
      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const reasonixHooks = new ReasonixHooks({
        outputRoot: testDir,
        relativeDirPath: ".reasonix",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(reasonixHooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return ReasonixHooks instance with empty hooks for deletion path", () => {
      const reasonixHooks = ReasonixHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".reasonix",
        relativeFilePath: "settings.json",
      });
      expect(reasonixHooks).toBeInstanceOf(ReasonixHooks);
      const parsed = JSON.parse(reasonixHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
