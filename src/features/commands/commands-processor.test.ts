import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, MockedFunction, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { ClineCommand } from "./cline-command.js";
import { CommandsProcessor, CommandsProcessorToolTarget } from "./commands-processor.js";
import { CursorCommand } from "./cursor-command.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { KiloCommand } from "./kilo-command.js";
import { OpenCodeCommand } from "./opencode-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ToolCommand } from "./tool-command.js";

/**
 * Creates a mock getFactory that throws an error for unsupported tool targets.
 * Used to test error handling when an invalid tool target is provided.
 */
const createMockGetFactoryThatThrowsUnsupported = () => {
  throw new Error("Unsupported tool target: unsupported");
};

// Mock the dependencies
vi.mock("../../utils/file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/file.js")>();
  return {
    ...actual,
    findFilesByGlobs: vi.fn(),
  };
});
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));
// Mock RulesyncCommand after importing it
vi.mock("./rulesync-command.js");
vi.mock("./claudecode-command.js", () => ({
  ClaudecodeCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./geminicli-command.js", () => ({
  GeminiCliCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./kilo-command.js", () => ({
  KiloCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./opencode-command.js", () => ({
  OpenCodeCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./roo-command.js", () => ({
  RooCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./cline-command.js", () => ({
  ClineCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));
vi.mock("./cursor-command.js", () => ({
  CursorCommand: vi.fn().mockImplementation(function (config) {
    return { ...config, isDeletable: () => true };
  }),
}));

const mockFindFilesByGlobs = findFilesByGlobs as MockedFunction<typeof findFilesByGlobs>;

// Set up RulesyncCommand mock
vi.mocked(RulesyncCommand).mockImplementation(function (config: any) {
  const instance = Object.create(RulesyncCommand.prototype);
  Object.assign(instance, config);
  instance.getRelativeFilePath = () => config.relativeFilePath;
  instance.getRelativeDirPath = () => config.relativeDirPath;
  instance.getBaseDir = () => config.baseDir;
  instance.getFrontmatter = () => config.frontmatter;
  instance.getBody = () => config.body;
  instance.getFileContent = () => config.fileContent;
  instance.withRelativeFilePath = (newPath: string) =>
    new RulesyncCommand({ ...config, relativeFilePath: newPath });
  return instance;
});

// Set up static methods after mocking
vi.mocked(RulesyncCommand).fromFile = vi.fn();
vi.mocked(RulesyncCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH });

// Set up static methods after mocking
vi.mocked(ClaudecodeCommand).fromFile = vi.fn();
vi.mocked(ClaudecodeCommand).fromRulesyncCommand = vi.fn();
vi.mocked(ClaudecodeCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(ClaudecodeCommand).getSettablePaths = vi.fn().mockImplementation((_options = {}) => ({
  relativeDirPath: join(".claude", "commands"),
}));
vi.mocked(ClaudecodeCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(GeminiCliCommand).fromFile = vi.fn();
vi.mocked(GeminiCliCommand).fromRulesyncCommand = vi.fn();
vi.mocked(GeminiCliCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(GeminiCliCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: join(".gemini", "commands") });
vi.mocked(GeminiCliCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(KiloCommand).fromFile = vi.fn();
vi.mocked(KiloCommand).fromRulesyncCommand = vi.fn();
vi.mocked(KiloCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(KiloCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: join(".kilocode", "workflows") });
vi.mocked(KiloCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(OpenCodeCommand).fromFile = vi.fn();
vi.mocked(OpenCodeCommand).fromRulesyncCommand = vi.fn();
vi.mocked(OpenCodeCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(OpenCodeCommand).getSettablePaths = vi.fn().mockImplementation((options = {}) => ({
  relativeDirPath: options.global
    ? join(".config", "opencode", "command")
    : join(".opencode", "command"),
}));
vi.mocked(OpenCodeCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(RooCommand).fromFile = vi.fn();
vi.mocked(RooCommand).fromRulesyncCommand = vi.fn();
vi.mocked(RooCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(RooCommand).getSettablePaths = vi
  .fn()
  .mockReturnValue({ relativeDirPath: join(".roo", "commands") });
vi.mocked(RooCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(ClineCommand).fromFile = vi.fn();
vi.mocked(ClineCommand).fromRulesyncCommand = vi.fn();
vi.mocked(ClineCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(ClineCommand).getSettablePaths = vi.fn().mockImplementation((options = {}) => ({
  relativeDirPath: options.global
    ? join("Documents", "Cline", "Workflows")
    : join(".clinerules", "workflows"),
}));
vi.mocked(ClineCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

// Set up static methods after mocking
vi.mocked(CursorCommand).fromFile = vi.fn();
vi.mocked(CursorCommand).fromRulesyncCommand = vi.fn();
vi.mocked(CursorCommand).isTargetedByRulesyncCommand = vi.fn().mockReturnValue(true);
vi.mocked(CursorCommand).getSettablePaths = vi.fn().mockImplementation((_options = {}) => ({
  relativeDirPath: join(".cursor", "commands"),
}));
vi.mocked(CursorCommand).forDeletion = vi.fn().mockImplementation((params) => ({
  ...params,
  isDeletable: () => true,
  getRelativeFilePath: () => params.relativeFilePath,
}));

describe("CommandsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CommandsProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
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

    it("should create instance with claudecode-legacy tool target", () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
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

    it("should accept global parameter", () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });
      expect(processor).toBeInstanceOf(CommandsProcessor);
    });

    it("should default global to false", () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
      expect((processor as any).global).toBe(false);
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
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
        relativeDirPath: join(".claude", "commands"),
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
        global: false,
      });
      expect(result).toEqual([mockClaudecodeCommand]);
    });

    it("should pass global parameter to ClaudecodeCommand.fromRulesyncCommand", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(ClaudecodeCommand.fromRulesyncCommand).mockReturnValue(mockClaudecodeCommand);

      await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(ClaudecodeCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
        global: true,
      });
    });

    it("should convert rulesync commands to geminicli commands", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
        relativeDirPath: join(".gemini", "commands"),
        relativeFilePath: "test.md",
        fileContent: `description = "test description"\nprompt = """\nconverted content\n"""`,
      });

      vi.mocked(GeminiCliCommand.fromRulesyncCommand).mockReturnValue(mockGeminiCliCommand);

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(GeminiCliCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
        global: false,
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
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
        relativeDirPath: join(".roo", "commands"),
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
        global: false,
      });
      expect(result).toEqual([mockRooCommand]);
    });

    it("should pass global parameter to CursorCommand.fromRulesyncCommand", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
        global: true,
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter: {
          targets: ["cursor"],
          description: "test description",
        },
        body: "test content",
      });

      const mockCursorCommand = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: join(".cursor", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "converted content",
      });

      vi.mocked(CursorCommand.fromRulesyncCommand).mockReturnValue(mockCursorCommand);

      await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      expect(CursorCommand.fromRulesyncCommand).toHaveBeenCalledWith({
        baseDir: expect.any(String),
        rulesyncCommand: mockRulesyncCommand,
        global: true,
      });
    });

    it("should flatten subdirectory path for supportsSubdirectory=false tools (generate)", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: join("pj", "test.md"),
        fileContent: "test content",
        frontmatter: {
          targets: ["cursor"],
          description: "test description",
        },
        body: "test content",
      });

      const mockCursorCommand = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: join(".cursor", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "converted content",
      });

      vi.mocked(CursorCommand.fromRulesyncCommand).mockReturnValue(mockCursorCommand);

      await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      const calledArgs = vi.mocked(CursorCommand.fromRulesyncCommand).mock.calls[0]![0]!;
      expect(calledArgs.rulesyncCommand.getRelativeFilePath()).toBe("test.md");
    });

    it("should preserve subdirectory path for supportsSubdirectory=true tools (generate)", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: join("pj", "test.md"),
        fileContent: "test content",
        frontmatter: {
          targets: ["claudecode"],
          description: "test description",
        },
        body: "test content",
      });

      const mockClaudecodeCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: join("pj", "test.md"),
        frontmatter: {
          description: "test description",
        },
        body: "converted content",
      });

      vi.mocked(ClaudecodeCommand.fromRulesyncCommand).mockReturnValue(mockClaudecodeCommand);

      await processor.convertRulesyncFilesToToolFiles([mockRulesyncCommand]);

      const calledArgs = vi.mocked(ClaudecodeCommand.fromRulesyncCommand).mock.calls[0]![0]!;
      expect(calledArgs.rulesyncCommand.getRelativeFilePath()).toBe(join("pj", "test.md"));
    });

    it("should warn when flattened command paths collide for supportsSubdirectory=false tools", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const commandInPj = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: join("pj", "test.md"),
        fileContent: "content from pj",
        frontmatter: {
          targets: ["cursor"],
          description: "pj command",
        },
        body: "content from pj",
      });
      const commandInOps = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: join("ops", "test.md"),
        fileContent: "content from ops",
        frontmatter: {
          targets: ["cursor"],
          description: "ops command",
        },
        body: "content from ops",
      });

      vi.mocked(CursorCommand.fromRulesyncCommand)
        .mockReturnValueOnce(
          new CursorCommand({
            baseDir: testDir,
            relativeDirPath: join(".cursor", "commands"),
            relativeFilePath: "test.md",
            frontmatter: {},
            body: "converted from pj",
          }),
        )
        .mockReturnValueOnce(
          new CursorCommand({
            baseDir: testDir,
            relativeDirPath: join(".cursor", "commands"),
            relativeFilePath: "test.md",
            frontmatter: {},
            body: "converted from ops",
          }),
        );

      const result = await processor.convertRulesyncFilesToToolFiles([commandInPj, commandInOps]);

      expect(result).toHaveLength(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'both map to "test.md". Only the last processed command will be used',
        ),
      );
    });

    it("should filter out non-rulesync command files", async () => {
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
        relativeDirPath: join(".claude", "commands"),
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
      Object.setPrototypeOf(mockToolCommand, ToolCommand.prototype);

      const result = await processor.convertToolFilesToRulesyncFiles([mockToolCommand as any]);

      expect(result).toHaveLength(1);
      expect(mockToolCommand.toRulesyncCommand).toHaveBeenCalled();
      expect(result[0]).toBe(mockRulesyncCommand);
    });

    it("should preserve subdirectory path through toRulesyncCommand in import flow", async () => {
      const mockRulesyncCommand = {
        getBody: () => "subdirectory content",
        getRelativeFilePath: () => join("pj", "test.md"),
        getFrontmatter: () => ({
          targets: ["claudecode"],
          description: "subdirectory command",
        }),
      };

      const mockToolCommand = {
        toRulesyncCommand: vi.fn().mockReturnValue(mockRulesyncCommand),
      };

      Object.setPrototypeOf(mockToolCommand, ToolCommand.prototype);

      const result = await processor.convertToolFilesToRulesyncFiles([mockToolCommand as any]);

      expect(result).toHaveLength(1);
      expect(result[0]!.getRelativeFilePath()).toBe(join("pj", "test.md"));
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
      const mockPaths = [
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "test1.md"),
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "test2.md"),
      ];
      const mockRulesyncCommands = [
        new RulesyncCommand({
          baseDir: testDir,
          relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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
          relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "**", "*.md"),
      );
      expect(RulesyncCommand.fromFile).toHaveBeenCalledTimes(2);
      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "test1.md" });
      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "test2.md" });
      expect(logger.debug).toHaveBeenCalledWith("Successfully loaded 2 rulesync commands");
      expect(result).toEqual(mockRulesyncCommands);
    });

    it("should throw error when file loading fails", async () => {
      const mockPaths = [
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "test1.md"),
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "test2.md"),
      ];
      const mockRulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
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

      await expect(processor.loadRulesyncFiles()).rejects.toThrow("Failed to load");
    });

    it("should return empty array when no files found", async () => {
      mockFindFilesByGlobs.mockResolvedValue([]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith("Successfully loaded 0 rulesync commands");
    });

    it("should load rulesync command files from subdirectories", async () => {
      const mockPaths = [
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "pj", "foo.md"),
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "bar.md"),
      ];
      const mockRulesyncCommands = [
        new RulesyncCommand({
          baseDir: testDir,
          relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
          relativeFilePath: join("pj", "foo.md"),
          fileContent: "content1",
          frontmatter: {
            targets: ["claudecode"],
            description: "subdirectory command",
          },
          body: "content1",
        }),
        new RulesyncCommand({
          baseDir: testDir,
          relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
          relativeFilePath: "bar.md",
          fileContent: "content2",
          frontmatter: {
            targets: ["claudecode"],
            description: "flat command",
          },
          body: "content2",
        }),
      ];

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(RulesyncCommand.fromFile)
        .mockResolvedValueOnce(mockRulesyncCommands[0]!)
        .mockResolvedValueOnce(mockRulesyncCommands[1]!);

      const result = await processor.loadRulesyncFiles();

      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({
        relativeFilePath: join("pj", "foo.md"),
      });
      expect(RulesyncCommand.fromFile).toHaveBeenCalledWith({ relativeFilePath: "bar.md" });
      expect(result).toEqual(mockRulesyncCommands);
    });

    it("should reject path traversal in loadRulesyncFiles", async () => {
      mockFindFilesByGlobs.mockResolvedValue([
        join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "..", "..", "etc", "passwd"),
      ]);

      await expect(processor.loadRulesyncFiles()).rejects.toThrow("Path traversal detected");
    });
  });

  describe("loadToolFiles", () => {
    it("should load claudecode commands with correct parameters", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockPaths = [join(testDir, ".claude", "commands", "test.md")];
      const mockCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(ClaudecodeCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await processor.loadToolFiles();

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(
        expect.stringContaining(join(".claude", "commands", "**", "*.md")),
      );
      expect(ClaudecodeCommand.fromFile).toHaveBeenCalledWith({
        baseDir: testDir,
        relativeFilePath: "test.md",
        global: false,
      });
      expect(logger.debug).toHaveBeenCalledWith("Successfully loaded 1 .claude/commands commands");
      expect(result).toEqual([mockCommand]);
    });

    it("should load geminicli commands with correct parameters", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const mockPaths = [join(testDir, ".gemini", "commands", "test.toml")];
      const mockCommand = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: join(".gemini", "commands"),
        relativeFilePath: "test.toml",
        fileContent: `description = "test description"\nprompt = """\ncontent\n"""`,
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(GeminiCliCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await processor.loadToolFiles();

      expect(result).toEqual([mockCommand]);
    });

    it("should load roo commands with correct parameters", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockPaths = [join(testDir, ".roo", "commands", "test.md")];
      const mockCommand = new RooCommand({
        baseDir: testDir,
        relativeDirPath: join(".roo", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
        fileContent: '---\ndescription: "test description"\n---\n\ncontent',
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(RooCommand.fromFile).mockResolvedValue(mockCommand);

      const result = await processor.loadToolFiles();

      expect(result).toEqual([mockCommand]);
    });

    it("should throw error when file loading fails", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockPaths = [
        join(testDir, ".claude", "commands", "test1.md"),
        join(testDir, ".claude", "commands", "test2.md"),
      ];
      const mockCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
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

      await expect(processor.loadToolFiles()).rejects.toThrow("Failed to load");
    });

    it("should pass global parameter when loading claudecode commands", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const mockPaths = [join(testDir, ".claude", "commands", "test.md")];
      const mockCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "test description",
        },
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(ClaudecodeCommand.fromFile).mockResolvedValue(mockCommand);

      await processor.loadToolFiles();

      expect(ClaudecodeCommand.fromFile).toHaveBeenCalledWith({
        baseDir: testDir,
        relativeFilePath: "test.md",
        global: true,
      });
    });

    it("should pass global parameter when loading cursor commands", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
        global: true,
      });

      const mockPaths = [join(testDir, ".cursor", "commands", "test.md")];
      const mockCommand = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: join(".cursor", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "content",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(CursorCommand.fromFile).mockResolvedValue(mockCommand);

      await processor.loadToolFiles();

      expect(CursorCommand.fromFile).toHaveBeenCalledWith({
        baseDir: testDir,
        relativeFilePath: "test.md",
        global: true,
      });
    });

    it("should load tool commands from subdirectories", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockPaths = [
        join(testDir, ".claude", "commands", "pj", "foo.md"),
        join(testDir, ".claude", "commands", "bar.md"),
      ];
      const mockCommand1 = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: join("pj", "foo.md"),
        frontmatter: { description: "subdirectory command" },
        body: "content1",
      });
      const mockCommand2 = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "bar.md",
        frontmatter: { description: "flat command" },
        body: "content2",
      });

      mockFindFilesByGlobs.mockResolvedValue(mockPaths);
      vi.mocked(ClaudecodeCommand.fromFile)
        .mockResolvedValueOnce(mockCommand1)
        .mockResolvedValueOnce(mockCommand2);

      const result = await processor.loadToolFiles();

      expect(ClaudecodeCommand.fromFile).toHaveBeenCalledWith({
        baseDir: testDir,
        relativeFilePath: join("pj", "foo.md"),
        global: false,
      });
      expect(ClaudecodeCommand.fromFile).toHaveBeenCalledWith({
        baseDir: testDir,
        relativeFilePath: "bar.md",
        global: false,
      });
      expect(result).toEqual([mockCommand1, mockCommand2]);
    });

    it("should load tool commands from subdirectories for deletion", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "pj", "foo.md"),
      ]);

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toHaveLength(1);
      expect(vi.mocked(ClaudecodeCommand).forDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: testDir,
          relativeFilePath: join("pj", "foo.md"),
        }),
      );
    });

    it("should produce correct relative paths for deeply nested files in forDeletion mode", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "pj", "sub", "deep.md"),
      ]);

      await processor.loadToolFiles({ forDeletion: true });

      expect(vi.mocked(ClaudecodeCommand).forDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: testDir,
          relativeFilePath: join("pj", "sub", "deep.md"),
        }),
      );
    });

    it("should throw error for unsupported tool target", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        getFactory: createMockGetFactoryThatThrowsUnsupported,
      });

      await expect(processor.loadToolFiles()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });

    it("should use top-level only glob for supportsSubdirectory=false tools (import)", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      mockFindFilesByGlobs.mockResolvedValue([]);

      await processor.loadToolFiles();

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(
        expect.stringContaining(join(".cursor", "commands", "*.md")),
      );
      // Should NOT contain "**" in the glob pattern
      const calledGlob = mockFindFilesByGlobs.mock.calls[0]![0] as string;
      expect(calledGlob).not.toContain(join("**", "*.md"));
    });

    it("should use recursive glob for supportsSubdirectory=true tools (import)", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([]);

      await processor.loadToolFiles();

      expect(mockFindFilesByGlobs).toHaveBeenCalledWith(
        expect.stringContaining(join(".claude", "commands", "**", "*.md")),
      );
    });
  });

  describe("getToolTargets", () => {
    it("should exclude simulated targets by default", () => {
      const targets = CommandsProcessor.getToolTargets();
      expect(new Set(targets)).toEqual(
        new Set([
          "antigravity",
          "claudecode",
          "claudecode-legacy",
          "cline",
          "copilot",
          "cursor",
          "geminicli",
          "kilo",
          "kiro",
          "opencode",
          "roo",
        ]),
      );
    });

    it("should include simulated targets when includeSimulated is true", () => {
      const targets = CommandsProcessor.getToolTargets({ includeSimulated: true });
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsmd",
          "antigravity",
          "claudecode",
          "claudecode-legacy",
          "cline",
          "copilot",
          "cursor",
          "factorydroid",
          "geminicli",
          "kilo",
          "kiro",
          "opencode",
          "roo",
        ]),
      );
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return claudecode and cursor for global mode", () => {
      const targets = CommandsProcessor.getToolTargets({ global: true });
      expect(new Set(targets)).toEqual(
        new Set([
          "claudecode",
          "claudecode-legacy",
          "cline",
          "cursor",
          "factorydroid",
          "geminicli",
          "codexcli",
          "kilo",
          "opencode",
        ]),
      );
    });
  });

  describe("loadToolFiles with forDeletion: true", () => {
    it("should return files with correct paths for deletion", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([join(testDir, ".claude", "commands", "test.md")]);

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe("test.md");
      expect(vi.mocked(ClaudecodeCommand).forDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: testDir,
          relativeFilePath: "test.md",
        }),
      );
    });

    it("should work for all supported tool targets", async () => {
      const targets: CommandsProcessorToolTarget[] = [
        "claudecode",
        "claudecode-legacy",
        "cline",
        "geminicli",
        "kilo",
        "roo",
      ];

      for (const target of targets) {
        processor = new CommandsProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        mockFindFilesByGlobs.mockResolvedValue([]);

        const filesToDelete = await processor.loadToolFiles({ forDeletion: true });
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should filter out non-deletable files when forDeletion is true", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "deletable.md"),
        join(testDir, ".claude", "commands", "non-deletable.md"),
      ]);

      // Mock forDeletion to return instances with different isDeletable results
      (vi.mocked(ClaudecodeCommand).forDeletion as ReturnType<typeof vi.fn>).mockImplementation(
        (params: { relativeFilePath: string }) => ({
          ...params,
          isDeletable: () => params.relativeFilePath !== "non-deletable.md",
          getRelativeFilePath: () => params.relativeFilePath,
        }),
      );

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });
      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe("deletable.md");
    });

    it("should reject path traversal in loadToolFiles", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "..", "..", "etc", "passwd"),
      ]);

      await expect(processor.loadToolFiles()).rejects.toThrow("Path traversal detected");
    });

    it("should reject path traversal in loadToolFiles with forDeletion", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "..", "..", "etc", "passwd"),
      ]);

      await expect(processor.loadToolFiles({ forDeletion: true })).rejects.toThrow(
        "Path traversal detected",
      );
    });

    it("should return all files when forDeletion is false regardless of isDeletable", async () => {
      processor = new CommandsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const deletableCommand = {
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "deletable.md",
        isDeletable: () => true,
      };
      const nonDeletableCommand = {
        baseDir: testDir,
        relativeDirPath: join(".claude", "commands"),
        relativeFilePath: "non-deletable.md",
        isDeletable: () => false,
      };

      mockFindFilesByGlobs.mockResolvedValue([
        join(testDir, ".claude", "commands", "deletable.md"),
        join(testDir, ".claude", "commands", "non-deletable.md"),
      ]);
      vi.mocked(ClaudecodeCommand.fromFile)
        .mockResolvedValueOnce(deletableCommand as unknown as ClaudecodeCommand)
        .mockResolvedValueOnce(nonDeletableCommand as unknown as ClaudecodeCommand);

      const toolFiles = await processor.loadToolFiles({ forDeletion: false });
      expect(toolFiles).toHaveLength(2);
    });
  });
});
