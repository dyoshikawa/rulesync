import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigs } from "../../core/mcp-generator.js";
import { createMockConfig } from "../../test-utils/index.js";
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
vi.mock("../../utils/index.js");

const mockGenerateConfigurations = vi.mocked(generateConfigurations);
const mockParseRulesFromDirectory = vi.mocked(parseRulesFromDirectory);
const mockGenerateMcpConfigs = vi.mocked(generateMcpConfigs);
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockFileExists.mockResolvedValue(true);
    mockParseRulesFromDirectory.mockResolvedValue(mockRules);
    mockGenerateConfigurations.mockResolvedValue(mockOutputs);
    mockWriteFileContent.mockResolvedValue();
    mockRemoveDirectory.mockResolvedValue();
    mockRemoveClaudeGeneratedFiles.mockResolvedValue();
    mockGenerateMcpConfigs.mockResolvedValue([]);

    mockLoadConfig.mockResolvedValue({
      config: mockConfig,
      isEmpty: true,
    });
    mockMergeWithCliOptions.mockImplementation((config, cliOptions) => ({
      ...config,
      ...cliOptions,
      defaultTargets: cliOptions.tools || config.defaultTargets,
    }));

    // Mock console methods
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(console.error).toHaveBeenCalledWith(
      "❌ .rulesync directory not found. Run 'rulesync init' first.",
    );
  });

  it("should warn if no rules found", async () => {
    mockParseRulesFromDirectory.mockResolvedValue([]);

    await generateCommand();

    expect(console.warn).toHaveBeenCalledWith("⚠️  No rules found in .rulesync directory");
  });

  it("should warn if no configurations generated", async () => {
    mockGenerateConfigurations.mockResolvedValue([]);

    await generateCommand();

    expect(console.warn).toHaveBeenCalledWith("⚠️  No configurations generated");
  });

  it("should handle verbose mode", async () => {
    await generateCommand({ verbose: true });

    expect(console.log).toHaveBeenCalledWith("Parsing rules from .rulesync...");
    expect(console.log).toHaveBeenCalledWith("Found 1 rule(s)");
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
    expect(console.error).toHaveBeenCalledWith(
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

    expect(console.log).toHaveBeenCalledWith("Deleting existing output directories...");
    expect(console.log).toHaveBeenCalledWith("Deleted existing output directories");
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

    expect(console.warn).toHaveBeenCalledWith(
      "⚠️  Warning: CLI tool selection differs from configuration!",
    );
    expect(console.warn).toHaveBeenCalledWith("   Config targets: copilot, cursor, claudecode");
    expect(console.warn).toHaveBeenCalledWith("   CLI specified: claudecode, geminicli");
    expect(console.warn).toHaveBeenCalledWith("   Tools specified but not in config: geminicli");
    expect(console.warn).toHaveBeenCalledWith(
      "   Tools in config but not specified: copilot, cursor",
    );
    expect(console.warn).toHaveBeenCalledWith("\n   The configuration file targets will be used.");
    expect(console.warn).toHaveBeenCalledWith(
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
    expect(console.warn).not.toHaveBeenCalledWith(
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

    expect(console.log).toHaveBeenCalledWith(
      "\nGenerating configurations for base directory: ./package1",
    );
    expect(console.log).toHaveBeenCalledWith(
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

    expect(console.log).toHaveBeenCalledWith("Loaded configuration from: /path/to/config.json");
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

    expect(console.log).toHaveBeenCalledWith("Base directories: ./src, ./lib");
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

    expect(console.warn).toHaveBeenCalledWith("⚠️  No configurations generated for ./empty-dir");
  });

  it("should handle MCP configuration generation", async () => {
    const mcpResults = [
      { tool: "copilot-editor", status: "success" as const, path: ".vscode/mcp.json" },
      {
        tool: "claude-project",
        status: "error" as const,
        path: ".claude/settings.json",
        error: "Failed to write",
      },
      { tool: "cursor-project", status: "skipped" as const, path: ".cursor/mcp.json" },
    ];
    mockGenerateMcpConfigs.mockResolvedValue(mcpResults);

    await generateCommand({ verbose: true });

    expect(console.log).toHaveBeenCalledWith("\nGenerating MCP configurations...");
    expect(console.log).toHaveBeenCalledWith(
      "✅ Generated copilot-editor MCP configuration: .vscode/mcp.json",
    );
    expect(console.error).toHaveBeenCalledWith(
      "❌ Failed to generate claude-project MCP configuration: Failed to write",
    );
    expect(console.log).toHaveBeenCalledWith(
      "⏭️  Skipped cursor-project MCP configuration (no servers configured)",
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
    const mcpResults = [
      { tool: "copilot-editor", status: "success" as const, path: ".vscode/mcp.json" },
    ];
    mockGenerateMcpConfigs.mockResolvedValue(mcpResults);

    await generateCommand();

    expect(console.log).toHaveBeenCalledWith(
      "\n🎉 All done! Generated 2 file(s) total (1 configurations + 1 MCP configurations)",
    );
  });

  it("should handle case when no MCP configurations are found", async () => {
    mockGenerateMcpConfigs.mockResolvedValue([]);

    await generateCommand({ verbose: true });

    expect(console.log).toHaveBeenCalledWith("No MCP configuration found for " + process.cwd());
  });
});
