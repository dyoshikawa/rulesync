import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig, mockLogger } from "../../test-utils/index.js";

vi.mock("../../core/index.js");
vi.mock("../../core/config/index.js");
vi.mock("../../core/mcp-generator.js");
vi.mock("../../core/mcp-parser.js");
vi.mock("../../core/command-generator.js");
vi.mock("../../utils/index.js");
vi.mock("../../rules/rules-processor.js");
vi.mock("../../commands/commands-processor.js");
vi.mock("../../subagents/subagents-processor.js");
vi.mock("../../utils/logger.js", () => ({
  logger: mockLogger,
}));
vi.mock("node:fs/promises");

import { CommandsProcessor } from "../../commands/commands-processor.js";
import { generateCommands } from "../../core/command-generator.js";
import { CliParser, ConfigResolver } from "../../core/config/index.js";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigurations } from "../../core/mcp-generator.js";
import { parseMcpConfig } from "../../core/mcp-parser.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import type { ToolTarget } from "../../types/index.js";
import {
  fileExists,
  removeClaudeGeneratedFiles,
  removeDirectory,
  writeFileContent,
} from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { generateCommand } from "./generate.js";

const mockGenerateConfigurations = vi.mocked(generateConfigurations);
const mockParseRulesFromDirectory = vi.mocked(parseRulesFromDirectory);
const mockGenerateMcpConfigurations = vi.mocked(generateMcpConfigurations);
const mockParseMcpConfig = vi.mocked(parseMcpConfig);
const mockGenerateCommands = vi.mocked(generateCommands);
const mockFileExists = vi.mocked(fileExists);
const mockWriteFileContent = vi.mocked(writeFileContent);
const mockRemoveDirectory = vi.mocked(removeDirectory);
const mockRemoveClaudeGeneratedFiles = vi.mocked(removeClaudeGeneratedFiles);
const mockCliParser = vi.mocked(CliParser);
const mockConfigResolver = vi.mocked(ConfigResolver);
const mockRulesProcessor = vi.mocked(RulesProcessor);
const mockCommandsProcessor = vi.mocked(CommandsProcessor);
const mockSubagentsProcessor = vi.mocked(SubagentsProcessor);

const mockConfig = createMockConfig();

const mockRules = [
  {
    filename: "test",
    filepath: ".rulesync/test.md",
    frontmatter: {
      targets: ["*"] satisfies ["*"],
      root: true,
      description: "Test rule",
      globs: ["**/*.ts"],
    },
    content: "Test content",
  },
];

const mockOutputs = [
  {
    tool: "copilot" as const,
    filepath: ".github/instructions/test.md",
    content: "Generated content",
  },
];

describe("generateCommand", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);
    mockWriteFileContent.mockResolvedValue();
    mockRemoveDirectory.mockResolvedValue();
    mockRemoveClaudeGeneratedFiles.mockResolvedValue();
    mockGenerateMcpConfigurations.mockResolvedValue([]);
    mockParseMcpConfig.mockReturnValue(null);
    mockGenerateCommands.mockResolvedValue([]);

    // Mock the new config system
    const mockResolutionResult = {
      value: {
        ...mockConfig,
        aiRulesDir: ".rulesync",
        defaultTargets: ["copilot"] as ToolTarget[],
        watchEnabled: false,
        verbose: false,
        delete: false,
      },
      source: "CLI arguments",
    };

    const mockResolverInstance = {
      resolve: vi.fn().mockResolvedValue(mockResolutionResult),
    };
    const mockParserInstance = {
      parse: vi.fn().mockReturnValue({}),
    };

    mockConfigResolver.mockImplementation(() => mockResolverInstance as any);
    mockCliParser.mockImplementation(() => mockParserInstance as any);

    // Mock processor instances
    const mockRulesProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };
    const mockCommandsProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    const mockSubagentsProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };

    mockRulesProcessor.mockImplementation(() => mockRulesProcessorInstance as any);
    mockCommandsProcessor.mockImplementation(() => mockCommandsProcessorInstance as any);
    mockSubagentsProcessor.mockImplementation(() => mockSubagentsProcessorInstance as any);

    // Mock static getToolTargets methods
    mockRulesProcessor.getToolTargets = vi
      .fn()
      .mockReturnValue(["copilot", "cursor", "claudecode"]);
    mockCommandsProcessor.getToolTargets = vi
      .fn()
      .mockReturnValue(["claudecode", "roo", "geminicli"]);
    mockSubagentsProcessor.getToolTargets = vi.fn().mockReturnValue(["claudecode"]);

    // Mock fs.promises.readdir
    const { readdir } = await import("node:fs/promises");
    const mockReaddir = vi.mocked(readdir);
    mockReaddir.mockResolvedValue([]);

    // Mock console methods
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "success").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("should generate configurations successfully", async () => {
    await generateCommand({ tools: ["copilot"] });

    expect(mockFileExists).toHaveBeenCalledWith(".rulesync");
    expect(mockRulesProcessor).toHaveBeenCalledWith({
      baseDir: expect.any(String),
      toolTarget: "copilot",
    });
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining("Generated 1 copilot rule(s)"),
    );
  });

  it("should exit if no tools are specified", async () => {
    // Mock config with no default targets
    const mockResolverInstance = {
      resolve: vi.fn().mockResolvedValue({
        value: {
          ...mockConfig,
          aiRulesDir: ".rulesync",
          defaultTargets: [],
          watchEnabled: false,
        },
        source: "CLI arguments",
      }),
    };
    mockConfigResolver.mockImplementation(() => mockResolverInstance as any);

    await expect(generateCommand()).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("❌ Error: At least one tool must be specified."),
    );
  });

  it("should exit if .rulesync directory does not exist", async () => {
    mockFileExists.mockResolvedValue(false);

    await expect(generateCommand({ tools: ["copilot"] })).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ .rulesync directory not found. Run 'rulesync init' first.",
    );
  });

  it("should warn if no rules found", async () => {
    // Mock processors to return 0 files generated
    const mockRulesProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    mockRulesProcessor.mockImplementation(() => mockRulesProcessorInstance as any);

    await generateCommand({ tools: ["copilot"] });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "⚠️  No files generated for enabled features: rules, commands, mcp, ignore, subagents",
    );
  });

  it("should warn if no configurations generated", async () => {
    // Mock all processors to return 0 files generated
    const mockRulesProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    const mockCommandsProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };
    const mockSubagentsProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockResolvedValue([]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };

    mockRulesProcessor.mockImplementation(() => mockRulesProcessorInstance as any);
    mockCommandsProcessor.mockImplementation(() => mockCommandsProcessorInstance as any);
    mockSubagentsProcessor.mockImplementation(() => mockSubagentsProcessorInstance as any);

    await generateCommand({ tools: ["copilot"] });

    // Check that --features warning is shown
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("⚠️  Warning: No --features option specified"),
    );

    // Check that no files generated warning is shown
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "⚠️  No files generated for enabled features: rules, commands, mcp, ignore, subagents",
    );
  });

  it("should handle verbose mode", async () => {
    const mockResolverInstance = {
      resolve: vi.fn().mockResolvedValue({
        value: {
          ...mockConfig,
          aiRulesDir: ".rulesync",
          defaultTargets: ["copilot"] as ToolTarget[],
          watchEnabled: false,
          verbose: true,
        },
        source: "CLI arguments",
      }),
    };
    mockConfigResolver.mockImplementation(() => mockResolverInstance as any);

    await generateCommand({ tools: ["copilot"], verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("Configuration resolved from: CLI arguments");
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Base directories:"));
  });

  it("should handle specific tools option", async () => {
    await generateCommand({ tools: ["copilot"] });

    expect(mockRulesProcessor).toHaveBeenCalledWith({
      baseDir: expect.any(String),
      toolTarget: "copilot",
    });
  });

  it("should handle tools specified via targets field in config", async () => {
    const mockResolverInstance = {
      resolve: vi.fn().mockResolvedValue({
        value: {
          ...mockConfig,
          aiRulesDir: ".rulesync",
          defaultTargets: ["copilot", "cursor"],
          targets: ["copilot", "cursor"], // targets from config
          watchEnabled: false,
        },
        source: "Configuration file",
      }),
    };
    mockConfigResolver.mockImplementation(() => mockResolverInstance as any);

    await generateCommand({ tools: ["copilot", "cursor"] });

    expect(mockRulesProcessor).toHaveBeenCalledWith({
      baseDir: expect.any(String),
      toolTarget: "copilot",
    });
    expect(mockRulesProcessor).toHaveBeenCalledWith({
      baseDir: expect.any(String),
      toolTarget: "cursor",
    });
  });

  it("should handle errors gracefully", async () => {
    // Mock processor to throw an error
    const mockRulesProcessorInstance = {
      loadRulesyncFiles: vi.fn().mockRejectedValue(new Error("Load error")),
      convertRulesyncFilesToToolFiles: vi.fn(),
      writeAiFiles: vi.fn(),
    };
    mockRulesProcessor.mockImplementation(() => mockRulesProcessorInstance as any);

    await expect(generateCommand({ tools: ["copilot"] })).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ Failed to generate configurations:",
      expect.any(Error),
    );
  });

  it("should delete output directories when --delete option is used", async () => {
    const mockResolverInstance = {
      resolve: vi.fn().mockResolvedValue({
        value: {
          ...mockConfig,
          aiRulesDir: ".rulesync",
          defaultTargets: ["copilot", "cursor", "cline", "roo"] as ToolTarget[],
          watchEnabled: false,
          delete: true,
        },
        source: "CLI arguments",
      }),
    };
    mockConfigResolver.mockImplementation(() => mockResolverInstance as any);

    await generateCommand({ tools: ["copilot", "cursor", "cline", "roo"], delete: true });

    expect(mockRemoveDirectory).toHaveBeenCalledWith(".github/instructions");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".cursor/rules");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".clinerules");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".roo/rules");
  });
});
