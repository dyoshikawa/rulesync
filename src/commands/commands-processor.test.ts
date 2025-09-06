import { afterEach, beforeEach, describe, expect, it, MockedFunction, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { findFilesByGlobs } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { CommandsProcessor, CommandsProcessorToolTarget } from "./commands-processor.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

// Mock the dependencies
vi.mock("../utils/file.js");
vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
  },
}));
vi.mock("./rulesync-command.js");
vi.mock("./claudecode-command.js");
vi.mock("./geminicli-command.js");
vi.mock("./roo-command.js");

const mockFindFilesByGlobs = findFilesByGlobs as MockedFunction<typeof findFilesByGlobs>;

describe("CommandsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CommandsProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });
      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should throw error for invalid tool target", () => {
      expect(() => {
        processor = new CommandsProcessor({
          baseDir: expect.any(String),
          toolTarget: "invalid" as CommandsProcessorToolTarget,
        });
      }).toThrow();
    });

    it("should use process.cwd() as default baseDir", () => {
      processor = new CommandsProcessor({
        toolTarget: "claudecode",
      });
      expect(processor).toBeInstanceOf(CommandsProcessor);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    beforeEach(() => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });
    });

    it("should convert rulesync commands to claudecode commands", async () => {
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "test content",
      });

      const mockClaudecodeCommand = new ClaudecodeCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(ClaudecodeCommand.fromRulesyncCommand).mockReturnValue(mockClaudecodeCommand);

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(ClaudecodeCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
      });
      expect(result).toEqual([mockClaudecodeCommand]);
    });

    it("should convert rulesync commands to geminicli commands", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "geminicli",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["geminicli"],
          description: "test description",
        },
        body: "test content",
      });

      const mockGeminiCliCommand = new GeminiCliCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test.md",
        fileContent: "converted content",
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(GeminiCliCommand.fromRulesyncCommand).mockReturnValue(mockGeminiCliCommand);

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(GeminiCliCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
      });
      expect(result).toEqual([mockGeminiCliCommand]);
    });

    it("should convert rulesync commands to roo commands", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "roo",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["roo"],
          description: "test description",
        },
        body: "test content",
      });

      const mockRooCommand = new RooCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        fileContent: "converted content",
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(RooCommand.fromRulesyncCommand).mockReturnValue(mockRooCommand);

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(RooCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
      });
      expect(result).toEqual([mockRooCommand]);
    });

    it("should filter out non-rulesync command files", async () => {
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "test content",
      });

      const mockOtherFile = { type: "other" };

      const result = await processor.convertRulesyncFilesToToolFiles([
        mockRulesyncCommand,
        mockOtherFile as any,
      ]);

      expect(result).toHaveLength(1);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with valid target first, then modify internal target for testing
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });

      // Override the toolTarget property for testing
      (processor as any).toolTarget = "unsupported";

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "test content",
      });

      await expect(
        processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    beforeEach(() => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });
    });

    it("should convert tool commands to rulesync commands", async () => {
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "converted content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "converted content",
      });

      const mockToolCommand = new ClaudecodeCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "test content",
      });

      mockToolCommand.toRulesyncCommand = vi.fn().mockReturnValue(mockRulesyncCommand);

      const result = await processor.convertToolFilesToRulesyncFiles([mockToolCommand]);

      expect(mockToolCommand.toRulesyncCommand).toHaveBeenCalled();
      expect(result).toEqual([mockRulesyncCommand]);
    });

    it("should filter out non-tool command files", async () => {
      const mockToolCommand = new ClaudecodeCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "test content",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "converted content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "converted content",
      });

      mockToolCommand.toRulesyncCommand = vi.fn().mockReturnValue(mockRulesyncCommand);

      const mockOtherFile = { type: "other" };

      const result = await processor.convertToolFilesToRulesyncFiles([
        mockToolCommand,
        mockOtherFile as any,
      ]);

      expect(result).toHaveLength(1);
    });
  });

  describe("loadRulesyncFiles", () => {
    beforeEach(() => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });
    });

    it("should load rulesync command files successfully", async () => {
      const mockPaths = ["test1.md", "test2.md"];
      const mockRulesyncCommands = [
        new RulesyncCommand({
          baseDir: expect.any(String),
          relativeDirPath: ".rulesync/commands",
          relativeFilePath: "test1.md",
          fileContent: "content1",
          frontmatter: {
            targets: ["claudecode"],
            description: "test description 1",
          },
          body: "content1",
        }),
        new RulesyncCommand({
          baseDir: expect.any(String),
          relativeDirPath: ".rulesync/commands",
          relativeFilePath: "test2.md",
          fileContent: "content2",
          frontmatter: {
            targets: ["claudecode"],
            description: "test description 2",
          },
          body: "content2",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(RulesyncCommand.fromFile)
        .mockResolvedValueOnce(mockRulesyncCommands[0])
        .mockResolvedValueOnce(mockRulesyncCommands[1]);

      const result = await processor.loadRulesyncFiles();

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(".rulesync/commands/*.md");
      expect(RulesyncCommand.fromFile).toHaveBeenCalledTimes(2);
      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "test1.md" });
      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "test2.md" });
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 2 rulesync commands");
      expect(result).toEqual(mockRulesyncCommands);
    });

    it("should handle failed file loading gracefully", async () => {
      const mockPaths = ["test1.md", "test2.md"];
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test1.md",
        fileContent: "content1",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "content1",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(RulesyncCommand.fromFile)
        .mockResolvedValueOnce(mockRulesyncCommand)
        .mockRejectedValueOnce(new Error("Failed to load"));

      const result = await processor.loadRulesyncFiles();

      expect(result).toEqual([mockRulesyncCommand]);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 1 rulesync commands");
    });

    it("should return empty array when no files found", async () => {
      mockFindFilesByGlobs.mockResolvedValue([]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 0 rulesync commands");
    });
  });

  describe("loadToolFiles", () => {
    it("should load claudecode commands", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });

      const mockCommands = [
        new ClaudecodeCommand({
          baseDir: expect.any(String),
          relativeDirPath: ".claude/commands",
          relativeFilePath: "test.md",
          frontmatter: {
            description: "test description",
          },
          body: "content",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(ClaudecodeCommand.fromFile).mockResolvedValue(mockCommands[0]);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should load geminicli commands", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "geminicli",
      });

      const mockCommands = [
        new GeminiCliCommand({
          baseDir: expect.any(String),
          relativeDirPath: ".gemini/commands",
          relativeFilePath: "test.md",
          fileContent: "content",
          frontmatter: {
            description: "test description",
          },
          body: "content",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(GeminiCliCommand.fromFile).mockResolvedValue(mockCommands[0]);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should load roo commands", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "roo",
      });

      const mockCommands = [
        new RooCommand({
          baseDir: expect.any(String),
          relativeDirPath: ".roo/commands",
          relativeFilePath: "test.md",
          fileContent: "content",
          frontmatter: {
            description: "test description",
          },
          body: "content",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(RooCommand.fromFile).mockResolvedValue(mockCommands[0]);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should throw error for unsupported tool target", async () => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });

      // Override the toolTarget property for testing
      (processor as any).toolTarget = "unsupported";

      await expect(processor.loadToolFiles()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("loadToolCommandDefault", () => {
    beforeEach(() => {
      processor = new CommandsProcessor({
        baseDir: expect.any(String),
        toolTarget: "claudecode",
      });
    });

    it("should load claudecode commands with correct parameters", async () => {
      const mockPaths = [`${testDir}/.claude/commands/test.md`];
      const mockCommand = new ClaudecodeCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(ClaudecodeCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await (processor as any).loadToolCommandDefault({
        toolTarget: "claudecode",
        relativeDirPath: ".claude/commands",
        extension: "md",
      });

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(
        expect.stringContaining("/.claude/commands/*.md"),
      );
      expect(ClaudecodeCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "test.md" });
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 1 .claude/commands commands");
      expect(result).toEqual([mockCommand]);
    });

    it("should load geminicli commands with correct parameters", async () => {
      const mockPaths = [`${testDir}/.gemini/commands/test.md`];
      const mockCommand = new GeminiCliCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test.md",
        fileContent: "content",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(GeminiCliCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await (processor as any).loadToolCommandDefault({
        toolTarget: "geminicli",
        relativeDirPath: ".gemini/commands",
        extension: "md",
      });

      expect(result).toEqual([mockCommand]);
    });

    it("should load roo commands with correct parameters", async () => {
      const mockPaths = [`${testDir}/.roo/commands/test.md`];
      const mockCommand = new RooCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        fileContent: "content",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(RooCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await (processor as any).loadToolCommandDefault({
        toolTarget: "roo",
        relativeDirPath: ".roo/commands",
        extension: "md",
      });

      expect(result).toEqual([mockCommand]);
    });

    it("should handle failed file loading gracefully", async () => {
      const mockPaths = ["test1.md", "test2.md"];
      const mockCommand = new ClaudecodeCommand({
        baseDir: expect.any(String),
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test1.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(ClaudecodeCommand.fromFile)
        .mockResolvedValueOnce(mockCommand)
        .mockRejectedValueOnce(new Error("Failed to load"));

      const result = await (processor as any).loadToolCommandDefault({
        toolTarget: "claudecode",
        relativeDirPath: ".claude/commands",
        extension: "md",
      });

      expect(result).toEqual([mockCommand]);
      expect(logger.info).toHaveBeenCalledWith("Successfully loaded 1 .claude/commands commands");
    });

    it("should throw error for unsupported tool target", async () => {
      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);

      await expect(
        (processor as any).loadToolCommandDefault({
          toolTarget: "unsupported",
          relativeDirPath: ".test/commands",
          extension: "md",
        }),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("getToolTargets", () => {
    it("should return supported tool targets", () => {
      const targets = CommandsProcessor.getToolTargets();
      expect(targets).toEqual(["claudecode", "geminicli", "roo"]);
    });
  });
});
