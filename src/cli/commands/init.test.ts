import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { RulesyncCommand } from "../../features/commands/rulesync-command.js";
import { RulesyncIgnore } from "../../features/ignore/rulesync-ignore.js";
import { RulesyncMcp } from "../../features/mcp/rulesync-mcp.js";
import { RulesyncRule } from "../../features/rules/rulesync-rule.js";
import { RulesyncSubagent } from "../../features/subagents/rulesync-subagent.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { initCommand } from "./init.js";

// Mock dependencies
vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");
vi.mock("../../features/commands/rulesync-command.js");
vi.mock("../../features/ignore/rulesync-ignore.js");
vi.mock("../../features/mcp/rulesync-mcp.js");
vi.mock("../../features/rules/rulesync-rule.js");
vi.mock("../../features/subagents/rulesync-subagent.js");

describe("initCommand", () => {
  beforeEach(() => {
    // Setup logger mocks
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup file utility mocks
    vi.mocked(ensureDir).mockResolvedValue(undefined);
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);

    // Setup class mocks
    vi.mocked(RulesyncRule.getSettablePaths).mockReturnValue({
      recommended: { relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH },
    } as any);
    vi.mocked(RulesyncMcp.getSettablePaths).mockReturnValue({
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
      },
    } as any);
    vi.mocked(RulesyncCommand.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    } as any);
    vi.mocked(RulesyncSubagent.getSettablePaths).mockReturnValue({
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    } as any);
    vi.mocked(RulesyncIgnore.getSettablePaths).mockReturnValue({
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      },
      legacy: {
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      },
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should initialize rulesync successfully", async () => {
      await initCommand();

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
      expect(logger.info).toHaveBeenCalledWith("Next steps:");
      expect(logger.info).toHaveBeenCalledWith(
        `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/mcp.json and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        "2. Run 'rulesync generate' to create configuration files",
      );
    });

    it("should create required directories", async () => {
      await initCommand();

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledTimes(6);
    });

    it("should call createSampleFiles", async () => {
      await initCommand();

      // Verify that sample file creation was called
      const expectedFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      expect(fileExists).toHaveBeenCalledWith(expectedFilePath);
      expect(writeFileContent).toHaveBeenCalledWith(expectedFilePath, expect.any(String));
    });
  });

  describe("sample file creation", () => {
    it("should create overview.md sample file when it doesn't exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      expect(fileExists).toHaveBeenCalledWith(expectedFilePath);
      expect(writeFileContent).toHaveBeenCalledWith(
        expectedFilePath,
        expect.stringContaining("# Project Overview"),
      );
      expect(logger.success).toHaveBeenCalledWith(`Created ${expectedFilePath}`);
    });

    it("should skip creating overview.md when it already exists", async () => {
      const expectedFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      vi.mocked(fileExists).mockResolvedValue(true);

      await initCommand();

      expect(fileExists).toHaveBeenCalledWith(expectedFilePath);
      expect(writeFileContent).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(`Skipped ${expectedFilePath} (already exists)`);
    });

    it("should create sample file with correct content structure", async () => {
      await initCommand();

      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      expect(writeCall).toBeDefined();
      const content = writeCall![1];

      // Check frontmatter
      expect(content).toMatch(/^---\s*$/m);
      expect(content).toContain("root: true");
      expect(content).toContain('targets: ["*"]');
      expect(content).toContain(
        'description: "Project overview and general development guidelines"',
      );
      expect(content).toContain('globs: ["**/*"]');

      // Check content sections
      expect(content).toContain("# Project Overview");
      expect(content).toContain("## General Guidelines");
      expect(content).toContain("## Code Style");
      expect(content).toContain("## Architecture Principles");

      // Check specific guidelines
      expect(content).toContain("Use TypeScript for all new code");
      expect(content).toContain("Use 2 spaces for indentation");
      expect(content).toContain("Organize code by feature, not by file type");
    });

    it("should create sample file with proper formatting", async () => {
      await initCommand();

      const writeCall = vi.mocked(writeFileContent).mock.calls[0];
      expect(writeCall).toBeDefined();
      const content = writeCall![1];

      // Check that content is properly formatted
      expect(content).toMatch(/^---[\s\S]*---[\s\S]*# Project Overview/);
      expect(content.split("\n").length).toBeGreaterThan(10); // Should be multiline
      expect(content).toContain("\n\n"); // Should have proper spacing
    });
  });

  describe("error handling", () => {
    it("should handle ensureDir errors for main directory", async () => {
      vi.mocked(ensureDir).mockRejectedValueOnce(new Error("Permission denied"));

      await expect(initCommand()).rejects.toThrow("Permission denied");

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(logger.success).not.toHaveBeenCalled();
    });

    it("should handle ensureDir errors for rules directory", async () => {
      vi.mocked(ensureDir)
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error("Disk full")); // Second call fails

      await expect(initCommand()).rejects.toThrow("Disk full");

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_RELATIVE_DIR_PATH);
    });

    it("should handle fileExists errors", async () => {
      vi.mocked(fileExists).mockRejectedValue(new Error("File system error"));

      await expect(initCommand()).rejects.toThrow("File system error");

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
    });

    it("should handle writeFileContent errors", async () => {
      vi.mocked(writeFileContent).mockRejectedValue(new Error("Write permission denied"));

      await expect(initCommand()).rejects.toThrow("Write permission denied");

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(writeFileContent).toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalledWith(expect.stringContaining("Created"));
    });

    it("should handle RulesyncCommand.getSettablePaths errors", async () => {
      vi.mocked(RulesyncCommand.getSettablePaths).mockImplementation(() => {
        throw new Error("Command configuration error");
      });

      await expect(initCommand()).rejects.toThrow("Command configuration error");

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
    });
  });

  describe("integration scenarios", () => {
    it("should work correctly when some directories already exist", async () => {
      // Mock ensureDir to work normally (it should handle existing directories)
      vi.mocked(ensureDir).mockResolvedValue(undefined);
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
      expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
    });

    it("should complete initialization even when sample file already exists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      await initCommand();

      expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
      expect(logger.info).toHaveBeenCalledWith("Next steps:");
      expect(writeFileContent).not.toHaveBeenCalled();
    });

    it("should create all required directories in correct order", async () => {
      const ensureDirCalls: string[] = [];
      vi.mocked(ensureDir).mockImplementation(async (path: string) => {
        ensureDirCalls.push(path);
      });

      await initCommand();

      expect(ensureDirCalls).toEqual([
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_RULES_RELATIVE_DIR_PATH,
        RULESYNC_RELATIVE_DIR_PATH,
        RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        RULESYNC_RELATIVE_DIR_PATH,
      ]);
    });
  });

  describe("logging behavior", () => {
    it("should log initialization start message first", async () => {
      await initCommand();

      const loggerInfoCalls = vi.mocked(logger.info).mock.calls;
      expect(loggerInfoCalls[0]?.[0]).toBe("Initializing rulesync...");
    });

    it("should log success message after completion", async () => {
      await initCommand();

      expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
    });

    it("should log next steps instructions", async () => {
      await initCommand();

      expect(logger.info).toHaveBeenCalledWith("Next steps:");
      expect(logger.info).toHaveBeenCalledWith(
        `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/mcp.json and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        "2. Run 'rulesync generate' to create configuration files",
      );
    });

    it("should log sample file creation success", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      expect(logger.success).toHaveBeenCalledWith(`Created ${expectedFilePath}`);
    });

    it("should log sample file skip message", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
      expect(logger.info).toHaveBeenCalledWith(`Skipped ${expectedFilePath} (already exists)`);
    });
  });

  describe(".aiignore creation", () => {
    it("should create .aiignore in .rulesync when it doesn't exist", async () => {
      // by default in beforeEach, fileExists resolves to false

      await initCommand();

      const expectedIgnoreFilePath = join(RULESYNC_RELATIVE_DIR_PATH, RULESYNC_AIIGNORE_FILE_NAME);

      expect(writeFileContent).toHaveBeenCalledWith(expectedIgnoreFilePath, expect.any(String));
      expect(logger.success).toHaveBeenCalledWith(`Created ${expectedIgnoreFilePath}`);
    });

    it("should skip creating .aiignore when it already exists", async () => {
      // Make every file appear to exist to trigger skip path
      vi.mocked(fileExists).mockResolvedValue(true);

      await initCommand();

      const expectedIgnoreFilePath = join(RULESYNC_RELATIVE_DIR_PATH, RULESYNC_AIIGNORE_FILE_NAME);

      expect(logger.info).toHaveBeenCalledWith(
        `Skipped ${expectedIgnoreFilePath} (already exists)`,
      );
      // Ensure we did not attempt to write the .aiignore file
      expect(
        vi.mocked(writeFileContent).mock.calls.some((args) => args[0] === expectedIgnoreFilePath),
      ).toBe(false);
    });
  });
});
