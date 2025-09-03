import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRulesyncCommand, createMockToolFile } from "../test-utils/mock-factories.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { CommandsProcessor } from "./commands-processor.js";

// import { RulesyncCommand } from "./rulesync-command.js"; // Now using mock factories

// Only mock specific functions, not the entire module to avoid conflicts with setupTestDirectory
vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual("../utils/file.js");
  return {
    ...actual,
    directoryExists: vi.fn(),
    listDirectoryFiles: vi.fn(),
    findFiles: vi.fn(),
    readFileContent: vi.fn(),
  };
});
vi.mock("../utils/logger.js");

describe("CommandsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with claudecode target", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should create instance with geminicli target", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should create instance with roo target", () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should use current working directory as default baseDir", () => {
      const processor = new CommandsProcessor({
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should validate tool target", () => {
      expect(() => {
        void new CommandsProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return supported tool targets", () => {
      const targets = CommandsProcessor.getToolTargets();

      expect(targets).toEqual(["claudecode", "geminicli", "roo"]);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync commands to claudecode commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncCommand = createMockRulesyncCommand({
        testDir,
        fileName: "test-command.js",
        content: "console.log('test command');",
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".claude/commands/test-command.js");
    });

    it("should convert rulesync commands to geminicli commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockRulesyncCommand = createMockRulesyncCommand({
        testDir,
        fileName: "test-command.js",
        content: "console.log('test command');",
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".gemini/commands/test-command.js");
    });

    it("should convert rulesync commands to roo commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockRulesyncCommand = createMockRulesyncCommand({
        testDir,
        fileName: "test-command.js",
        content: "console.log('test command');",
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".roo/commands/test-command.js");
    });

    it("should filter non-command files", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockNonCommand = {
        filePath: "some/other/file.md",
        content: "not a command",
      };

      const result = await processor.convertRulesyncFilesToToolFiles([mockNonCommand as any]);

      expect(result).toHaveLength(0);
    });

    it("should handle multiple command files", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockCommand1 = createMockRulesyncCommand({
        testDir,
        fileName: "command1.js",
        content: "console.log('command1');",
      });

      const mockCommand2 = createMockRulesyncCommand({
        testDir,
        fileName: "command2.js",
        content: "console.log('command2');",
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockCommand1, mockCommand2]);

      expect(result).toHaveLength(2);
      expect(result[0]?.getFilePath()).toContain("command1.js");
      expect(result[1]?.getFilePath()).toContain("command2.js");
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load command files from .rulesync/commands directory", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const commandsDir = join(testDir, ".rulesync", "commands");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.findFiles).mockResolvedValue([
        join(commandsDir, "command1.md"),
        join(commandsDir, "command2.md"),
      ]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(2);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(commandsDir);
    });

    it("should return empty array when commands directory doesn't exist", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });

    it("should handle empty commands directory", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.findFiles).mockResolvedValue([]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert tool files back to rulesync files for claudecode", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = [
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".claude", "commands", "test-command.js"),
          content: "console.log('test');",
        }),
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".rulesync/commands/test-command.js");
    });

    it("should convert tool files back to rulesync files for geminicli", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const toolFiles = [
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".gemini", "commands", "test-command.js"),
          content: "console.log('test');",
        }),
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".rulesync/commands/test-command.js");
    });

    it("should convert tool files back to rulesync files for roo", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const toolFiles = [
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".roo", "commands", "test-command.js"),
          content: "console.log('test');",
        }),
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".rulesync/commands/test-command.js");
    });
  });
});
