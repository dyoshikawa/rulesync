import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesyncCommand } from "../../commands/rulesync-command.js";
import { RULESYNC_DIR, RULESYNC_RULES_DIR, RULESYNC_SUBAGENTS_DIR } from "../../constants/paths.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { initCommand } from "./init.js";

// Mock dependencies
vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");
vi.mock("../../commands/rulesync-command.js");

describe("initCommand", () => {
  beforeEach(() => {
    // Setup logger mocks
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup file utility mocks
    vi.mocked(ensureDir).mockResolvedValue(undefined);
    vi.mocked(fileExists).mockResolvedValue(false);
    vi.mocked(writeFileContent).mockResolvedValue(undefined);

    // Setup RulesyncCommand mock
    vi.mocked(RulesyncCommand.getSettablePaths).mockReturnValue({
      relativeDirPath: ".rulesync/commands",
    });
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
      expect(logger.info).toHaveBeenCalledWith(`1. Edit rule files in ${RULESYNC_RULES_DIR}/`);
      expect(logger.info).toHaveBeenCalledWith(
        "2. Run 'rulesync generate' to create configuration files",
      );
    });

    it("should create required directories", async () => {
      await initCommand();

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_DIR);
      expect(ensureDir).toHaveBeenCalledWith(".rulesync/commands");
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_DIR);
      expect(ensureDir).toHaveBeenCalledTimes(4);
    });

    it("should call createSampleFiles", async () => {
      await initCommand();

      // Verify that sample file creation was called
      const expectedFilePath = join(RULESYNC_RULES_DIR, "overview.md");
      expect(fileExists).toHaveBeenCalledWith(expectedFilePath);
      expect(writeFileContent).toHaveBeenCalledWith(expectedFilePath, expect.any(String));
    });
  });

  describe("sample file creation", () => {
    it("should create overview.md sample file when it doesn't exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_DIR, "overview.md");
      expect(fileExists).toHaveBeenCalledWith(expectedFilePath);
      expect(writeFileContent).toHaveBeenCalledWith(
        expectedFilePath,
        expect.stringContaining("# Project Overview"),
      );
      expect(logger.success).toHaveBeenCalledWith(`Created ${expectedFilePath}`);
    });

    it("should skip creating overview.md when it already exists", async () => {
      const expectedFilePath = join(RULESYNC_RULES_DIR, "overview.md");
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
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
      expect(logger.success).not.toHaveBeenCalled();
    });

    it("should handle ensureDir errors for rules directory", async () => {
      vi.mocked(ensureDir)
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error("Disk full")); // Second call fails

      await expect(initCommand()).rejects.toThrow("Disk full");

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_DIR);
    });

    it("should handle fileExists errors", async () => {
      vi.mocked(fileExists).mockRejectedValue(new Error("File system error"));

      await expect(initCommand()).rejects.toThrow("File system error");

      expect(logger.info).toHaveBeenCalledWith("Initializing rulesync...");
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
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

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_DIR);
    });
  });

  describe("integration scenarios", () => {
    it("should work correctly when some directories already exist", async () => {
      // Mock ensureDir to work normally (it should handle existing directories)
      vi.mocked(ensureDir).mockResolvedValue(undefined);
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_DIR);
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_RULES_DIR);
      expect(ensureDir).toHaveBeenCalledWith(".rulesync/commands");
      expect(ensureDir).toHaveBeenCalledWith(RULESYNC_SUBAGENTS_DIR);
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
        RULESYNC_DIR,
        RULESYNC_RULES_DIR,
        ".rulesync/commands",
        RULESYNC_SUBAGENTS_DIR,
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
      expect(logger.info).toHaveBeenCalledWith(`1. Edit rule files in ${RULESYNC_RULES_DIR}/`);
      expect(logger.info).toHaveBeenCalledWith(
        "2. Run 'rulesync generate' to create configuration files",
      );
    });

    it("should log sample file creation success", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_DIR, "overview.md");
      expect(logger.success).toHaveBeenCalledWith(`Created ${expectedFilePath}`);
    });

    it("should log sample file skip message", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      await initCommand();

      const expectedFilePath = join(RULESYNC_RULES_DIR, "overview.md");
      expect(logger.info).toHaveBeenCalledWith(`Skipped ${expectedFilePath} (already exists)`);
    });
  });
});
