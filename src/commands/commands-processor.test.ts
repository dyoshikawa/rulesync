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
// Mock RulesyncCommand after importing it
vi.mock("./rulesync-command.js");
vi.mock("./claudecode-command.js", () => ({
  ClaudecodeCommand: vi.fn().mockImplementation((config) => config),
}));
vi.mock("./geminicli-command.js", () => ({
  GeminiCliCommand: vi.fn().mockImplementation((config) => config),
}));
vi.mock("./roo-command.js", () => ({
  RooCommand: vi.fn().mockImplementation((config) => config),
}));

const mockFindFilesByGlobs = findFilesByGlobs as MockedFunction<typeof findFilesByGlobs>;

// Set up RulesyncCommand mock
vi.mocked(RulesyncCommand).mockImplementation((config: any) => {
  const instance = Object.create(RulesyncCommand.prototype);
  return Object.assign(instance, config);
});

// Set up static methods after mocking
vi.mocked(RulesyncCommand).fromFile = vi.fn();
vi.mocked(RulesyncCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: ".rulesync/commands" });

// Set up static methods after mocking
vi.mocked(ClaudecodeCommand).fromFile = vi.fn();
vi.mocked(ClaudecodeCommand).fromRulesyncCommand = vi.fn();
vi.mocked(ClaudecodeCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: ".claude/commands" });

// Set up static methods after mocking
vi.mocked(GeminiCliCommand).fromFile = vi.fn();
vi.mocked(GeminiCliCommand).fromRulesyncCommand = vi.fn();
vi.mocked(GeminiCliCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: ".gemini/commands" });

// Set up static methods after mocking
vi.mocked(RooCommand).fromFile = vi.fn();
vi.mocked(RooCommand).fromRulesyncCommand = vi.fn();
vi.mocked(RooCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: ".roo/commands" });

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
        baseDir: testDir,
        toolTarget: "claudecode",
      });
      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should throw error for invalid tool target", () => {
      expect(() => {
        processor = new CommandsProcessor({
          baseDir: testDir,
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
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert rulesync commands to claudecode commands", async () => {
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
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
        baseDir: testDir,
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
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
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
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test.md",
        fileContent: `description = "test description"\nprompt = """\nconverted content\n"""`,
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
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
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
        baseDir: testDir,
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
        baseDir: testDir,
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
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(ClaudecodeCommand.fromRulesyncCommand).mockReturnValue(mockClaudecodeCommand);

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
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Override the toolTarget property for testing
      (processor as any).toolTarget = "unsupported";

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
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
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert tool commands to rulesync commands", async () => {
      // Since the mocking is interfering with instanceof checks, let's test the behavior more directly
      // We'll create a minimal mock that the method can actually work with
      const mockRulesyncCommand = {
        getBody: () => "converted content",
        getFrontmatter: () => ({
          targets: ["claudecode"],
          description: "test description",
        }),
      };

      const mockToolCommand = {
        toRulesyncCommand: vi.fn().mockReturnValue(mockRulesyncCommand),
        // Add the ToolCommand constructor properties to make instanceof work
        constructor: { name: "ToolCommand" },
      };

      // Manually set the prototype to make instanceof ToolCommand return true
      const { ToolCommand } = await import("./tool-command.js");
      Object.setPrototypeOf(mockToolCommand, ToolCommand.prototype);

      const result = await processor.convertToolFilesToRulesyncFiles([mockToolCommand as any]);

      expect(result).toHaveLength(1);
      expect(mockToolCommand.toRulesyncCommand).toHaveBeenCalled();
      expect(result[0]).toBe(mockRulesyncCommand);
    });

    it("should filter out non-tool command files", async () => {
      const mockRulesyncCommand = {
        getBody: () => "converted content",
        getFrontmatter: () => ({
          targets: ["claudecode"],
          description: "test description",
        }),
      };

      const mockToolCommand = {
        toRulesyncCommand: vi.fn().mockReturnValue(mockRulesyncCommand),
      };

      // Set prototype to make instanceof ToolCommand return true
      const { ToolCommand } = await import("./tool-command.js");
      Object.setPrototypeOf(mockToolCommand, ToolCommand.prototype);

      const mockOtherFile = { type: "other" };

      const result = await processor.convertToolFilesToRulesyncFiles([
        mockToolCommand as any,
        mockOtherFile as any,
      ]);

      // Only the ToolCommand should be processed, the other file should be filtered out
      expect(result).toHaveLength(1);
      expect(mockToolCommand.toRulesyncCommand).toHaveBeenCalled();
    });
  });

  describe("loadRulesyncFiles", () => {
    beforeEach(() => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should load rulesync command files successfully", async () => {
      const mockPaths = ["test1.md", "test2.md"];
      const mockRulesyncCommands = [
        new RulesyncCommand({
          baseDir: testDir,
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
          baseDir: testDir,
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
        .mockResolvedValueOnce(mockRulesyncCommands[0]!)
        .mockResolvedValueOnce(mockRulesyncCommands[1]!);

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
        baseDir: testDir,
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
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockCommands = [
        new ClaudecodeCommand({
          baseDir: testDir,
          relativeDirPath: ".claude/commands",
          relativeFilePath: "test.md",
          frontmatter: {
            description: "test description",
          },
          body: "content",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(ClaudecodeCommand.fromFile).mockResolvedValue(mockCommands[0]!);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should load geminicli commands", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockCommands = [
        new GeminiCliCommand({
          baseDir: testDir,
          relativeDirPath: ".gemini/commands",
          relativeFilePath: "test.md",
          fileContent: `description = "test description"\nprompt = """\ncontent\n"""`,
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(GeminiCliCommand.fromFile).mockResolvedValue(mockCommands[0]!);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should load roo commands", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockCommands = [
        new RooCommand({
          baseDir: testDir,
          relativeDirPath: ".roo/commands",
          relativeFilePath: "test.md",
          frontmatter: {
            description: "test description",
          },
          body: "content",
          fileContent: '---\ndescription: "test description"\n---\n\ncontent',
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(["test.md"]);
      vi.mocked(RooCommand.fromFile).mockResolvedValue(mockCommands[0]!);

      const result = await processor.loadToolFiles();

      expect(result).toEqual(mockCommands);
    });

    it("should throw error for unsupported tool target", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
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
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should load claudecode commands with correct parameters", async () => {
      const mockPaths = [`${testDir}/.claude/commands/test.md`];
      const mockCommand = new ClaudecodeCommand({
        baseDir: testDir,
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
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test.md",
        fileContent: `description = "test description"\nprompt = """\ncontent\n"""`,
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
        baseDir: testDir,
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
        fileContent: '---\ndescription: "test description"\n---\n\ncontent',
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
        baseDir: testDir,
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
    it("should exclude simulated targets by default", () => {
      const targets = CommandsProcessor.getToolTargets();
      expect(targets).toEqual(["claudecode", "geminicli", "roo"]);
    });

    it("should include simulated targets when includeSimulated is true", () => {
      const targets = CommandsProcessor.getToolTargets({ includeSimulated: true });
      expect(targets).toEqual(["claudecode", "geminicli", "roo", "copilot", "cursor", "codexcli"]);
    });
  });
});
