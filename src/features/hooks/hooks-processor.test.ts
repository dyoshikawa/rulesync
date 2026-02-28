import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { CursorHooks } from "./cursor-hooks.js";
import { HooksProcessor } from "./hooks-processor.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ToolHooks } from "./tool-hooks.js";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("HooksProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with cursor target", () => {
      const processor = new HooksProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });
      expect(processor).toBeInstanceOf(HooksProcessor);
    });

    it("should create instance with claudecode target", () => {
      const processor = new HooksProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
      expect(processor).toBeInstanceOf(HooksProcessor);
    });

    it("should create instance with opencode target", () => {
      const processor = new HooksProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });
      expect(processor).toBeInstanceOf(HooksProcessor);
    });

    it("should throw for invalid tool target", () => {
      expect(() => {
        const _p = new HooksProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as "cursor",
        });
      }).toThrow("Invalid tool target for HooksProcessor");
    });

    it("should accept global option for claudecode", () => {
      const processor = new HooksProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });
      expect(processor).toBeInstanceOf(HooksProcessor);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load rulesync hooks file when it exists", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
        JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", command: "echo" }] },
        }),
      );

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(RulesyncHooks);
      expect((files[0] as RulesyncHooks).getJson().hooks.sessionStart).toHaveLength(1);
    });

    it("should return empty array when hooks file does not exist", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load Rulesync hooks file"),
      );
    });

    it("should load rulesync files from cwd even when baseDir is different (global mode)", async () => {
      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
        JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", command: "echo hello" }] },
        }),
      );

      // Use a different baseDir to simulate global mode (baseDir = homeDir)
      const differentBaseDir = join(testDir, "fake-home");
      await ensureDir(differentBaseDir);

      const processor = new HooksProcessor({
        baseDir: differentBaseDir,
        toolTarget: "claudecode",
        global: true,
      });
      const files = await processor.loadRulesyncFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(RulesyncHooks);
    });
  });

  describe("loadToolFiles", () => {
    it("should load Cursor hooks when .cursor/hooks.json exists", async () => {
      await ensureDir(join(testDir, ".cursor"));
      await writeFileContent(
        join(testDir, ".cursor", "hooks.json"),
        JSON.stringify({ version: 1, hooks: { sessionStart: [] } }),
      );

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(CursorHooks);
    });

    it("should return empty array when Cursor hooks file does not exist", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load hooks files"),
      );
    });

    it("should load Claudecode hooks when .claude/settings.json exists", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "claudecode" });
      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(ClaudecodeHooks);
    });

    it("should load Claudecode hooks when .claude/settings.json does not exist (initializes empty)", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "claudecode" });
      const files = await processor.loadToolFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(ClaudecodeHooks);
    });
  });

  describe("loadToolFiles with forDeletion", () => {
    it("should return Cursor hooks file for deletion when path exists", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const files = await processor.loadToolFiles({ forDeletion: true });
      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(CursorHooks);
      expect(files[0]?.getRelativeFilePath()).toBe("hooks.json");
    });

    it("should return empty array for claudecode when forDeletion (not deletable)", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "claudecode" });
      const files = await processor.loadToolFiles({ forDeletion: true });
      expect(files).toHaveLength(0);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync hooks to Cursor hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);
      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(CursorHooks);

      const content = (toolFiles[0] as CursorHooks).getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.sessionStart).toHaveLength(1);
      expect(parsed.hooks.sessionStart[0].command).toBe(".rulesync/hooks/session-start.sh");
      expect(parsed.hooks.stop).toHaveLength(1);
    });

    it("should convert rulesync hooks to Claudecode hooks with PascalCase", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

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

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "claudecode" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);
      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeHooks);

      const content = (toolFiles[0] as ClaudecodeHooks).getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(Array.isArray(parsed.hooks.SessionStart)).toBe(true);
    });

    it("should throw when no rulesync hooks file in list", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      await expect(processor.convertRulesyncFilesToToolFiles([])).rejects.toThrow(
        `No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`,
      );
    });

    it("should log warning when config has events not supported by target", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ command: "echo" }],
          notification: [{ command: "echo" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skipped hook event(s) for cursor (not supported): notification"),
      );
    });

    it("should log warning when prompt-type hooks exist and target does not support them", async () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: "echo start" },
            { type: "prompt", prompt: "Remember to use TypeScript" },
          ],
          preToolUse: [{ type: "prompt", prompt: "Check lint" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "opencode" });
      await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skipped prompt-type hook(s) for opencode (not supported)"),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("sessionStart"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("preToolUse"));
    });

    it("should not log prompt-type warning for targets that support prompt hooks", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "prompt", prompt: "Remember to use TypeScript" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "claudecode" });
      await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("prompt-type"));
    });

    it("should log warning when matcher hooks exist and target does not support them", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "lint.sh", matcher: "Write" },
            { type: "command", command: "all-tools.sh" },
          ],
          postToolUse: [{ type: "command", command: "format.sh", matcher: "Edit" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "copilot" });
      await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skipped matcher hook(s) for copilot (not supported)"),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("preToolUse"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("postToolUse"));
    });

    it("should not log matcher warning for targets that support matchers", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "opencode" });
      await processor.convertRulesyncFilesToToolFiles([rulesyncHooks]);

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("matcher"));
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert tool hooks to rulesync hooks", async () => {
      const cursorHooks = new CursorHooks({
        baseDir: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: { sessionStart: [{ type: "command", command: "echo" }] },
        }),
        validate: false,
      });

      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([cursorHooks]);
      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncHooks);
      const json = (rulesyncFiles[0] as RulesyncHooks).getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
    });

    it("should filter out non-ToolHooks files", async () => {
      const processor = new HooksProcessor({ baseDir: testDir, toolTarget: "cursor" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([
        { getFilePath: () => "/path" } as ToolHooks,
      ]);
      expect(rulesyncFiles).toHaveLength(0);
    });
  });

  describe("getToolTargets", () => {
    it("should return cursor, claudecode, copilot, opencode, and factorydroid for project mode", () => {
      const targets = HooksProcessor.getToolTargets({ global: false });
      expect(targets).toEqual(["cursor", "claudecode", "copilot", "opencode", "factorydroid"]);
    });

    it("should return claudecode, opencode, and factorydroid for global mode", () => {
      const targets = HooksProcessor.getToolTargets({ global: true });
      expect(targets).toEqual(["claudecode", "opencode", "factorydroid"]);
    });

    it("should exclude non-importable targets when importOnly is true", () => {
      const targets = HooksProcessor.getToolTargets({ global: false, importOnly: true });
      expect(targets).toEqual(["cursor", "claudecode", "copilot", "factorydroid"]);
    });

    it("should exclude non-importable targets when importOnly is true in global mode", () => {
      const targets = HooksProcessor.getToolTargets({ global: true, importOnly: true });
      expect(targets).toEqual(["claudecode", "factorydroid"]);
    });
  });
});
