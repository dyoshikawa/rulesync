import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig, mockLogger } from "../../test-utils/index.js";

vi.mock("../../core/index.js");
vi.mock("../../core/config/index.js");
vi.mock("../../core/mcp-generator.js");
vi.mock("../../core/mcp-parser.js");
vi.mock("../../core/command-generator.js");
vi.mock("../../utils/index.js");
vi.mock("../../utils/logger.js", () => ({
  logger: mockLogger,
}));
vi.mock("node:fs/promises");

import { generateCommands } from "../../core/command-generator.js";
import { CliParser, ConfigResolver } from "../../core/config/index.js";
import { generateConfigurations, parseRulesFromDirectory } from "../../core/index.js";
import { generateMcpConfigurations } from "../../core/mcp-generator.js";
import { parseMcpConfig } from "../../core/mcp-parser.js";
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
    expect(mockParseRulesFromDirectory).toHaveBeenCalledWith(".rulesync");
    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      expect.objectContaining({
        aiRulesDir: ".rulesync",
        defaultTargets: ["copilot"],
      }),
      ["copilot"],
      "/workspace",
    );
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      ".github/instructions/test.md",
      "Generated content",
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
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Available tools:"));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("--copilot"));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("--cursor"));
  });

  it("should exit if .rulesync directory does not exist", async () => {
    mockFileExists.mockResolvedValue(false);

    await expect(generateCommand({ tools: ["copilot"] })).rejects.toThrow("process.exit called");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ .rulesync directory not found. Run 'rulesync init' first.",
    );
  });

  it("should warn if no rules found", async () => {
    mockParseRulesFromDirectory.mockResolvedValue([]);

    await generateCommand({ tools: ["copilot"] });

    expect(mockLogger.warn).toHaveBeenCalledWith("⚠️  No rules found in .rulesync directory");
  });

  it("should warn if no configurations generated", async () => {
    mockGenerateConfigurations.mockResolvedValue([]);

    await generateCommand({ tools: ["copilot"] });

    expect(mockLogger.warn).toHaveBeenCalledWith("⚠️  No configurations generated");
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

    expect(mockLogger.info).toHaveBeenCalledWith("Parsing rules from .rulesync...");
    expect(mockLogger.info).toHaveBeenCalledWith("Found 1 rule(s)");
  });

  it("should handle specific tools option", async () => {
    await generateCommand({ tools: ["copilot"] });

    expect(mockGenerateConfigurations).toHaveBeenCalledWith(
      mockRules,
      expect.objectContaining({
        aiRulesDir: ".rulesync",
        defaultTargets: ["copilot"],
      }),
      ["copilot"],
      "/workspace",
    );
  });

  it("should handle errors gracefully", async () => {
    mockParseRulesFromDirectory.mockRejectedValue(new Error("Parse error"));

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
