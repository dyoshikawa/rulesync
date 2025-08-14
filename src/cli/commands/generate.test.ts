import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger.js";
import { generateCommands } from "../../core/command-generator.js";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigurations } from "../../core/mcp-generator.js";
import { parseMcpConfig } from "../../core/mcp-parser.js";
import { createMockConfig, mockLogger } from "../../test-utils/index.js";
import type { ToolTarget } from "../../types/index.js";
import {
  fileExists,
  getDefaultConfig,
  loadConfig,
  mergeWithCliOptions,
  removeClaudeGeneratedFiles,
  removeDirectory,
  writeFileContent,
} from "../../utils/index.js";
import { generateCommand } from "./generate.js";

vi.mock("../../core/index.js");
vi.mock("../../core/mcp-generator.js");
vi.mock("../../core/mcp-parser.js");
vi.mock("../../core/command-generator.js");
vi.mock("../../utils/index.js");
vi.mock("../../utils/logger.js", () => ({
  logger: mockLogger,
}));
vi.mock("node:fs/promises");

const mockGenerateConfigurations = vi.mocked(generateConfigurations);
const mockParseRulesFromDirectory = vi.mocked(parseRulesFromDirectory);
const mockGenerateMcpConfigurations = vi.mocked(generateMcpConfigurations);
const mockParseMcpConfig = vi.mocked(parseMcpConfig);
const mockGenerateCommands = vi.mocked(generateCommands);
const mockFileExists = vi.mocked(fileExists);
const mockGetDefaultConfig = vi.mocked(getDefaultConfig);
const mockLoadConfig = vi.mocked(loadConfig);
const mockMergeWithCliOptions = vi.mocked(mergeWithCliOptions);
const mockWriteFileContent = vi.mocked(writeFileContent);
const mockRemoveDirectory = vi.mocked(removeDirectory);
const mockRemoveClaudeGeneratedFiles = vi.mocked(removeClaudeGeneratedFiles);

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
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);
    mockWriteFileContent.mockResolvedValue();
    mockRemoveDirectory.mockResolvedValue();
    mockRemoveClaudeGeneratedFiles.mockResolvedValue();
    mockGenerateMcpConfigurations.mockResolvedValue([]);
    mockParseMcpConfig.mockReturnValue(null);
    mockGenerateCommands.mockResolvedValue([]);

    mockLoadConfig.mockResolvedValue({
      config: mockConfig,
      isEmpty: true,
    });
    mockMergeWithCliOptions.mockImplementation((config, cliOptions) => ({
      ...config,
      ...cliOptions,
      defaultTargets: cliOptions.tools || config.defaultTargets,
    }));

    // Mock fs.promises.readdir
    const { readdir } = await import("node:fs/promises");
    const mockReaddir = vi.mocked(readdir);
    mockReaddir.mockResolvedValue([]);

    // Mock console methods
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("should generate configurations successfully", async () => {
    await generateCommand();

    expect(mockFileExists).toHaveBeenCalledWith(".rulesync");
    expect(mockParseRulesFromDirectory).toHaveBeenCalledWith(".rulesync");
    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      mockConfig,
      mockConfig.defaultTargets,
      process.cwd(),
    );
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      ".github/instructions/test.md",
      "Generated content",
    );
  });

  it("should exit if .rulesync directory does not exist", async () => {
    mockFileExists.mockResolvedValue(false);

    await expect(generateCommand()).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ .rulesync directory not found. Run 'rulesync init' first.",
    );
  });

  it("should warn if no rules found", async () => {
    mockParseRulesFromDirectory.mockResolvedValue([]);

    await generateCommand();

    expect(mockLogger.warn).toHaveBeenCalledWith("⚠️  No rules found in .rulesync directory");
  });

  it("should warn if no configurations generated", async () => {
    mockGenerateConfigurations.mockResolvedValue([]);

    await generateCommand();

    expect(mockLogger.warn).toHaveBeenCalledWith("⚠️  No configurations generated");
  });

  it("should handle verbose mode", async () => {
    await generateCommand({ verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("Parsing rules from .rulesync...");
    expect(mockLogger.info).toHaveBeenCalledWith("Found 1 rule(s)");
  });

  it("should handle specific tools option", async () => {
    await generateCommand({ tools: ["copilot"] });

    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      expect.objectContaining({
        ...mockConfig,
        defaultTargets: ["copilot"],
      }),
      ["copilot"],
      process.cwd(),
    );
  });

  it("should handle errors gracefully", async () => {
    mockParseRulesFromDirectory.mockRejectedValue(new Error("Parse error"));

    await expect(generateCommand()).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ Failed to generate configurations:",
      expect.any(Error),
    );
  });

  it("should delete output directories when --delete option is used", async () => {
    await generateCommand({ delete: true });

    expect(mockRemoveDirectory).toHaveBeenCalledWith(".github/instructions");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".cursor/rules");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".clinerules");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".roo/rules");
  });

  it("should delete only specified tool directories when --delete option is used with specific tools", async () => {
    await generateCommand({ delete: true, tools: ["copilot", "cursor"] });

    expect(mockRemoveDirectory).toHaveBeenCalledWith(".github/instructions");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".cursor/rules");
    expect(mockRemoveDirectory).not.toHaveBeenCalledWith(".clinerules");
    expect(mockRemoveDirectory).not.toHaveBeenCalledWith(".roo/rules");
  });

  it("should show verbose output when deleting directories", async () => {
    await generateCommand({ delete: true, verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("Deleting existing output directories...");
    expect(mockLogger.info).toHaveBeenCalledWith("Deleted existing output directories");
  });

  it("should warn when CLI tools differ from config targets", async () => {
    const configWithTargets = {
      ...mockConfig,
      defaultTargets: ["copilot", "cursor", "claudecode"] as ToolTarget[],
    };

    mockLoadConfig.mockResolvedValue({
      config: configWithTargets,
      isEmpty: false,
    });

    mockMergeWithCliOptions.mockImplementation((config) => config);

    await generateCommand({ tools: ["claudecode", "geminicli"] });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "⚠️  Warning: CLI tool selection differs from configuration!",
    );
    expect(mockLogger.warn).toHaveBeenCalledWith("   Config targets: copilot, cursor, claudecode");
    expect(mockLogger.warn).toHaveBeenCalledWith("   CLI specified: claudecode, geminicli");
    expect(mockLogger.warn).toHaveBeenCalledWith("   Tools specified but not in config: geminicli");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "   Tools in config but not specified: copilot, cursor",
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "\n   The configuration file targets will be used.",
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "   To change targets, update your rulesync config file.",
    );

    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      configWithTargets,
      ["copilot", "cursor", "claudecode"],
      process.cwd(),
    );
  });

  it("should not warn when CLI tools match config targets", async () => {
    // Set up config with specific targets
    const configWithTargets = {
      ...mockConfig,
      defaultTargets: ["copilot", "cursor"] as ToolTarget[],
    };

    mockLoadConfig.mockResolvedValue({
      config: configWithTargets,
      isEmpty: false,
    });

    mockMergeWithCliOptions.mockImplementation((config) => config);

    // Generate with same tools via CLI
    await generateCommand({ tools: ["copilot", "cursor"] });

    // Should not warn
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      "⚠️  Warning: CLI tool selection differs from configuration!",
    );

    // Should use config targets
    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      configWithTargets,
      ["copilot", "cursor"],
      process.cwd(),
    );
  });

  it("should handle multiple base directories", async () => {
    const baseDirs = ["./package1", "./package2"];
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);

    await generateCommand({ baseDirs, verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith(
      "\nGenerating configurations for base directory: ./package1",
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      "\nGenerating configurations for base directory: ./package2",
    );
    expect(mockGenerateConfigurations).toHaveBeenCalledTimes(2);
  });

  it("should handle config file path option", async () => {
    await generateCommand({ config: "./custom-config.json" });

    expect(mockLoadConfig).toHaveBeenCalledWith({
      configPath: "./custom-config.json",
    });
  });

  it("should handle noConfig option", async () => {
    await generateCommand({ noConfig: true });

    expect(mockLoadConfig).toHaveBeenCalledWith({
      noConfig: true,
    });
  });

  it("should show config file path in verbose mode", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { ...mockConfig, verbose: true },
      isEmpty: false,
      filepath: "/path/to/config.json",
    });

    await generateCommand({ verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("Loaded configuration from: /path/to/config.json");
  });

  it("should handle baseDir from config", async () => {
    const configWithBaseDir = {
      ...mockConfig,
      baseDir: ["./src", "./lib"],
    };

    mockLoadConfig.mockResolvedValue({
      config: configWithBaseDir,
      isEmpty: false,
    });

    await generateCommand({ verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("Base directories: ./src, ./lib");
    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      expect.objectContaining({
        ...configWithBaseDir,
        verbose: true,
      }),
      configWithBaseDir.defaultTargets,
      "./src",
    );
    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      expect.objectContaining({
        ...configWithBaseDir,
        verbose: true,
      }),
      configWithBaseDir.defaultTargets,
      "./lib",
    );
  });

  it("should handle string baseDir from config", async () => {
    const configWithBaseDir = {
      ...mockConfig,
      baseDir: "./single-base",
    };

    mockLoadConfig.mockResolvedValue({
      config: configWithBaseDir,
      isEmpty: false,
    });

    await generateCommand();

    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      configWithBaseDir,
      configWithBaseDir.defaultTargets,
      "./single-base",
    );
  });

  it("should warn when no configurations generated for a specific base directory", async () => {
    mockGenerateConfigurations.mockResolvedValue([]);

    await generateCommand({ baseDirs: ["./empty-dir"], verbose: true });

    expect(mockLogger.warn).toHaveBeenCalledWith("⚠️  No configurations generated for ./empty-dir");
  });

  it("should handle MCP configuration generation", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test-server",
        },
      },
    };
    const mcpResults = [{ tool: "copilot", filepath: ".vscode/mcp.json", content: "{}" }];

    mockParseMcpConfig.mockReturnValue(mcpConfig);
    mockGenerateMcpConfigurations.mockResolvedValue(mcpResults);

    await generateCommand({ verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("\nGenerating MCP configurations...");
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Generated copilot MCP configuration: .vscode/mcp.json",
    );
  });

  it("should handle delete operation for different tools", async () => {
    const configWithSpecificTools = {
      ...mockConfig,
      defaultTargets: ["augmentcode", "augmentcode-legacy", "claudecode", "junie"] as ToolTarget[],
    };

    mockLoadConfig.mockResolvedValue({
      config: configWithSpecificTools,
      isEmpty: false,
    });

    await generateCommand({ delete: true });

    expect(mockRemoveDirectory).toHaveBeenCalledWith(expect.stringContaining(".augment/rules"));
    expect(mockRemoveDirectory).toHaveBeenCalledWith(expect.stringContaining(".augment/ignore"));
    expect(mockRemoveClaudeGeneratedFiles).toHaveBeenCalledTimes(2); // Once for augmentcode-legacy, once for claudecode
  });

  it("should handle final success message with MCP outputs", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test-server",
        },
      },
    };
    const mcpResults = [{ tool: "copilot", filepath: ".vscode/mcp.json", content: "{}" }];

    mockParseMcpConfig.mockReturnValue(mcpConfig);
    mockGenerateMcpConfigurations.mockResolvedValue(mcpResults);

    await generateCommand();

    expect(mockLogger.success).toHaveBeenCalledWith(
      "\n🎉 All done! Generated 2 file(s) total (1 configurations + 1 MCP configurations)",
    );
  });

  it("should not delete command directories when no .rulesync/commands/*.md files exist", async () => {
    // Mock fs.promises.readdir - reset to default first
    const { readdir } = await import("node:fs/promises");
    const mockReaddir = vi.mocked(readdir);
    vi.clearAllMocks();

    // Set up all the standard mocks again
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);
    mockWriteFileContent.mockResolvedValue();
    mockRemoveDirectory.mockResolvedValue();
    mockRemoveClaudeGeneratedFiles.mockResolvedValue();
    mockGenerateMcpConfigurations.mockResolvedValue([]);
    mockParseMcpConfig.mockReturnValue(null);
    mockGenerateCommands.mockResolvedValue([]);

    mockLoadConfig.mockResolvedValue({
      config: mockConfig,
      isEmpty: true,
    });

    // Mock that commands directory exists but no .md files
    mockFileExists.mockImplementation((path: string) => {
      if (path.includes("commands")) {
        return Promise.resolve(true); // commands directory exists
      }
      return Promise.resolve(true);
    });

    mockReaddir.mockResolvedValue([] as any[]); // No files in commands directory

    const configWithCommands = {
      ...mockConfig,
      defaultTargets: ["claudecode", "roo", "geminicli"] as ToolTarget[],
      delete: true,
    };
    mockMergeWithCliOptions.mockReturnValue(configWithCommands);

    await generateCommand({ delete: true });

    // Should not call removeDirectory for commands
    expect(mockRemoveDirectory).not.toHaveBeenCalledWith(".claude/commands");
    expect(mockRemoveDirectory).not.toHaveBeenCalledWith(".roo/commands");
    expect(mockRemoveDirectory).not.toHaveBeenCalledWith(".gemini/commands");
  });

  it("should delete command directories only when .rulesync/commands/*.md files exist", async () => {
    // Mock fs.promises.readdir - reset to default first
    const { readdir } = await import("node:fs/promises");
    const mockReaddir = vi.mocked(readdir);
    vi.clearAllMocks();

    // Set up all the standard mocks again
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);
    mockWriteFileContent.mockResolvedValue();
    mockRemoveDirectory.mockResolvedValue();
    mockRemoveClaudeGeneratedFiles.mockResolvedValue();
    mockGenerateMcpConfigurations.mockResolvedValue([]);
    mockParseMcpConfig.mockReturnValue(null);
    mockGenerateCommands.mockResolvedValue([]);

    mockLoadConfig.mockResolvedValue({
      config: mockConfig,
      isEmpty: true,
    });

    // Mock that commands directory exists with .md files
    mockFileExists.mockImplementation((path: string) => {
      if (path.includes("commands")) {
        return Promise.resolve(true); // commands directory exists
      }
      return Promise.resolve(true);
    });

    mockReaddir.mockResolvedValue(["test-command.md", "other-file.txt"] as any[]);

    const configWithCommands = {
      ...mockConfig,
      defaultTargets: ["claudecode", "roo", "geminicli"] as ToolTarget[],
      delete: true,
    };
    mockMergeWithCliOptions.mockReturnValue(configWithCommands);

    await generateCommand({ delete: true });

    // Should call removeDirectory for commands since .md files exist
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".claude/commands");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".roo/commands");
    expect(mockRemoveDirectory).toHaveBeenCalledWith(".gemini/commands");
  });

  it("should handle case when no MCP configurations are found", async () => {
    mockParseMcpConfig.mockReturnValue(null);

    await generateCommand({ verbose: true });

    expect(mockLogger.info).toHaveBeenCalledWith("No MCP configuration found for " + process.cwd());
  });

  it("should generate MCP configurations for claudecode tool", async () => {
    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "test-server",
        },
      },
    };
    const mcpResults = [{ tool: "claudecode", filepath: "./.mcp.json", content: "{}" }];

    mockParseMcpConfig.mockReturnValue(mcpConfig);
    mockGenerateMcpConfigurations.mockResolvedValue(mcpResults);

    // Create a new config with claudecode as target
    const claudecodeConfig = {
      ...mockConfig,
      defaultTargets: ["claudecode" as ToolTarget],
    };
    mockMergeWithCliOptions.mockReturnValue(claudecodeConfig);

    await generateCommand({ tools: ["claudecode"] });

    // Verify that MCP configuration was generated
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Generated claudecode MCP configuration: ./.mcp.json",
    );
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining("1 MCP configuration"));
  });
});
