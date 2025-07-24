import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigs } from "../../core/mcp-generator.js";
import { createMockConfig } from "../../test-utils/index.js";
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
});
