import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { CommandsProcessor } from "./commands-processor.js";
import { RulesyncCommand } from "./rulesync-command.js";

vi.mock("../utils/file.js");
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
        new CommandsProcessor({
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

      const mockRulesyncCommand = {
        filePath: join(testDir, ".rulesync", "commands", "test-command.js"),
        content: "console.log('test command');",
      } as RulesyncCommand;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".claude/commands/test-command.js");
    });

    it("should convert rulesync commands to geminicli commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockRulesyncCommand = {
        filePath: join(testDir, ".rulesync", "commands", "test-command.js"),
        content: "console.log('test command');",
      } as RulesyncCommand;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".gemini/commands/test-command.js");
    });

    it("should convert rulesync commands to roo commands", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockRulesyncCommand = {
        filePath: join(testDir, ".rulesync", "commands", "test-command.js"),
        content: "console.log('test command');",
      } as RulesyncCommand;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".roo/commands/test-command.js");
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

      const mockCommand1 = {
        filePath: join(testDir, ".rulesync", "commands", "command1.js"),
        content: "console.log('command1');",
      } as RulesyncCommand;

      const mockCommand2 = {
        filePath: join(testDir, ".rulesync", "commands", "command2.js"),
        content: "console.log('command2');",
      } as RulesyncCommand;

      const result = await processor.convertRulesyncFilesToToolFiles([mockCommand1, mockCommand2]);

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toContain("command1.js");
      expect(result[1].filePath).toContain("command2.js");
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
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["command1.js", "command2.ts"]);
      vi.mocked(fileUtils.readFileContent).mockImplementation(async (path: string) => {
        if (path.includes("command1.js")) return "console.log('command1');";
        if (path.includes("command2.ts")) return "console.log('command2');";
        return "";
      });

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
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue([]);

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
        {
          filePath: join(testDir, ".claude", "commands", "test-command.js"),
          content: "console.log('test');",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".rulesync/commands/test-command.js");
    });

    it("should convert tool files back to rulesync files for geminicli", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".gemini", "commands", "test-command.js"),
          content: "console.log('test');",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".rulesync/commands/test-command.js");
    });

    it("should convert tool files back to rulesync files for roo", async () => {
      const processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".roo", "commands", "test-command.js"),
          content: "console.log('test');",
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toContain(".rulesync/commands/test-command.js");
    });
  });
});
