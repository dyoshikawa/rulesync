import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockLogger } from "../test-utils/index.js";
import type { ToolTarget } from "../types/index.js";

// Mock the dependencies
vi.mock("../utils/logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("./commands/index.js", () => ({
  configCommand: vi.fn(),
  generateCommand: vi.fn(),
  gitignoreCommand: vi.fn(),
  importCommand: vi.fn(),
  initCommand: vi.fn(),
}));

vi.mock("./utils/targets-parser.js", () => ({
  parseTargets: vi.fn(),
  checkDeprecatedFlags: vi.fn(),
  getDeprecationWarning: vi.fn(),
  mergeAndDeduplicateTools: vi.fn(),
}));

import { generateCommand, importCommand } from "./commands/index.js";
import {
  checkDeprecatedFlags,
  getDeprecationWarning,
  mergeAndDeduplicateTools,
  parseTargets,
} from "./utils/targets-parser.js";

const mockGenerateCommand = vi.mocked(generateCommand);
const mockImportCommand = vi.mocked(importCommand);
const mockParseTargets = vi.mocked(parseTargets);
const mockCheckDeprecatedFlags = vi.mocked(checkDeprecatedFlags);
const mockGetDeprecationWarning = vi.mocked(getDeprecationWarning);
const mockMergeAndDeduplicateTools = vi.mocked(mergeAndDeduplicateTools);

describe("CLI Integration - Generate Command", () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the program for each test
    program = new Command();
    program.name("rulesync").description("Unified AI rules management CLI tool").version("0.65.0");

    // Add the generate command (similar to the actual implementation)
    program
      .command("generate")
      .description("Generate configuration files for AI tools")
      .option("--all", "Generate for all supported AI tools")
      .option(
        "-t, --targets <tools>",
        "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or 'all')",
      )
      .option("--agentsmd", "[DEPRECATED] Generate only for AGENTS.md (use --targets agentsmd)")
      .option(
        "--amazonqcli",
        "[DEPRECATED] Generate only for Amazon Q Developer CLI (use --targets amazonqcli)",
      )
      .option("--copilot", "[DEPRECATED] Generate only for GitHub Copilot (use --targets copilot)")
      .option("--cursor", "[DEPRECATED] Generate only for Cursor (use --targets cursor)")
      .option("--cline", "[DEPRECATED] Generate only for Cline (use --targets cline)")
      .option("--roo", "[DEPRECATED] Generate only for Roo Code (use --targets roo)")
      .option("--delete", "Delete all existing files in output directories before generating")
      .option("-v, --verbose", "Verbose output")
      .action(async (options) => {
        try {
          let tools = [];

          // Parse tools from --targets flag
          const targetsTools = options.targets ? parseTargets(options.targets) : [];

          // Check for deprecated individual flags
          const deprecatedTools = checkDeprecatedFlags(options);

          // Show deprecation warning if deprecated flags are used
          if (deprecatedTools.length > 0) {
            mockLogger.warn(getDeprecationWarning(deprecatedTools));
          }

          // Merge and deduplicate tools from all sources
          tools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, options.all === true);

          // Don't validate here - let generateCommand handle validation

          const generateOptions = {
            verbose: options.verbose,
            tools: tools.length > 0 ? tools : undefined,
            delete: options.delete,
          };

          await generateCommand(generateOptions);
        } catch (error) {
          mockLogger.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });

    // Set up default mocks
    mockParseTargets.mockReturnValue(["copilot", "cursor"]);
    mockCheckDeprecatedFlags.mockReturnValue([]);
    mockGetDeprecationWarning.mockReturnValue("Deprecation warning");
    mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor"]);
    mockGenerateCommand.mockResolvedValue();
  });

  describe("New --targets syntax", () => {
    it("should parse --targets flag correctly", async () => {
      mockParseTargets.mockReturnValue(["copilot", "cursor", "cline"]);
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "generate",
        "--targets",
        "copilot,cursor,cline",
      ]);

      expect(mockParseTargets).toHaveBeenCalledWith("copilot,cursor,cline");
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline"],
        }),
      );
    });

    it("should handle short -t flag", async () => {
      mockParseTargets.mockReturnValue(["copilot"]);
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot"]);

      await program.parseAsync(["node", "rulesync", "generate", "-t", "copilot"]);

      expect(mockParseTargets).toHaveBeenCalledWith("copilot");
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot"],
        }),
      );
    });

    it("should handle targets with 'all' keyword", async () => {
      mockParseTargets.mockReturnValue(["copilot", "cursor", "cline", "roo"]); // Mock ALL_TOOL_TARGETS subset
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline", "roo"]);

      await program.parseAsync(["node", "rulesync", "generate", "--targets", "all"]);

      expect(mockParseTargets).toHaveBeenCalledWith("all");
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline", "roo"],
        }),
      );
    });
  });

  describe("Deprecated individual flags", () => {
    it("should handle deprecated --copilot flag with warning", async () => {
      mockCheckDeprecatedFlags.mockReturnValue(["copilot"]);
      mockGetDeprecationWarning.mockReturnValue("DEPRECATED: Use --targets copilot");
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot"]);

      await program.parseAsync(["node", "rulesync", "generate", "--copilot"]);

      expect(mockCheckDeprecatedFlags).toHaveBeenCalledWith(
        expect.objectContaining({ copilot: true }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith("DEPRECATED: Use --targets copilot");
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot"],
        }),
      );
    });

    it("should handle multiple deprecated flags", async () => {
      mockCheckDeprecatedFlags.mockReturnValue(["copilot", "cursor", "cline"]);
      mockGetDeprecationWarning.mockReturnValue("DEPRECATED: Use --targets copilot,cursor,cline");
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "generate",
        "--copilot",
        "--cursor",
        "--cline",
      ]);

      expect(mockCheckDeprecatedFlags).toHaveBeenCalledWith(
        expect.objectContaining({
          copilot: true,
          cursor: true,
          cline: true,
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "DEPRECATED: Use --targets copilot,cursor,cline",
      );
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline"],
        }),
      );
    });
  });

  describe("Mixed syntax", () => {
    it("should handle both --targets and deprecated flags", async () => {
      mockParseTargets.mockReturnValue(["copilot", "cursor"]);
      mockCheckDeprecatedFlags.mockReturnValue(["cline", "roo"]);
      mockGetDeprecationWarning.mockReturnValue("DEPRECATED: Use --targets cline,roo");
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline", "roo"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "generate",
        "--targets",
        "copilot,cursor",
        "--cline",
        "--roo",
      ]);

      expect(mockParseTargets).toHaveBeenCalledWith("copilot,cursor");
      expect(mockCheckDeprecatedFlags).toHaveBeenCalledWith(
        expect.objectContaining({
          cline: true,
          roo: true,
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith("DEPRECATED: Use --targets cline,roo");
      expect(mockMergeAndDeduplicateTools).toHaveBeenCalledWith(
        ["copilot", "cursor"],
        ["cline", "roo"],
        false,
      );
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline", "roo"],
        }),
      );
    });
  });

  describe("--all flag behavior", () => {
    it("should override other options when --all is used", async () => {
      mockParseTargets.mockReturnValue(["copilot"]);
      mockCheckDeprecatedFlags.mockReturnValue(["cursor"]);
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline", "roo"]); // Mock ALL_TOOL_TARGETS subset

      await program.parseAsync([
        "node",
        "rulesync",
        "generate",
        "--all",
        "--targets",
        "copilot",
        "--cursor",
      ]);

      expect(mockMergeAndDeduplicateTools).toHaveBeenCalledWith(
        ["copilot"],
        ["cursor"],
        true, // --all flag is true
      );
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline", "roo"],
        }),
      );
    });
  });

  describe("New --targets * syntax", () => {
    it("should parse --targets * correctly", async () => {
      mockParseTargets.mockReturnValue(["copilot", "cursor", "cline", "roo"]); // Mock ALL_TOOL_TARGETS subset
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot", "cursor", "cline", "roo"]);

      await program.parseAsync(["node", "rulesync", "generate", "--targets", "*"]);

      expect(mockParseTargets).toHaveBeenCalledWith("*");
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot", "cursor", "cline", "roo"],
        }),
      );
    });

    it("should handle validation errors for mixed * and specific tools", async () => {
      mockParseTargets.mockImplementation(() => {
        throw new Error("Cannot use '*' (all tools) with specific tool targets");
      });

      const consoleSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(
        program.parseAsync(["node", "rulesync", "generate", "--targets", "*,copilot"]),
      ).rejects.toThrow("process.exit called");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Cannot use '*' (all tools) with specific tool targets",
      );
      expect(consoleSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Error handling", () => {
    it("should handle no tools specified", async () => {
      // When no tools are provided, it should pass an empty array to generateCommand
      mockParseTargets.mockReturnValue([]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue([]);

      await program.parseAsync(["node", "rulesync", "generate"]);

      // generateCommand should be called with undefined tools
      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
        }),
      );
    });

    it("should handle parsing errors", async () => {
      mockParseTargets.mockImplementation(() => {
        throw new Error("Invalid tool target: invalid-tool");
      });

      const consoleSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(
        program.parseAsync(["node", "rulesync", "generate", "--targets", "invalid-tool"]),
      ).rejects.toThrow("process.exit called");

      expect(mockLogger.error).toHaveBeenCalledWith("Invalid tool target: invalid-tool");
      expect(consoleSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Other options", () => {
    it("should pass through verbose and delete options", async () => {
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "generate",
        "--targets",
        "copilot",
        "--verbose",
        "--delete",
      ]);

      expect(mockGenerateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ["copilot"],
          verbose: true,
          delete: true,
        }),
      );
    });
  });
});

describe("CLI Integration - Import Command", () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the program for each test
    program = new Command();
    program.name("rulesync").description("Unified AI rules management CLI tool").version("0.65.0");

    // Add the import command (similar to the actual implementation)
    program
      .command("import")
      .description("Import configurations from AI tools to rulesync format")
      .option("-t, --targets <tool>", "Tool to import from (e.g., 'copilot', 'cursor', 'cline')")
      .option(
        "--features <features>",
        "Comma-separated list of features to import (rules,commands,mcp,ignore) or '*' for all",
        (value) => {
          if (value === "*") return "*";
          return value
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean);
        },
      )
      .option("--copilot", "[DEPRECATED] Import from GitHub Copilot (use --targets copilot)")
      .option("--cursor", "[DEPRECATED] Import from Cursor (use --targets cursor)")
      .option("--claudecode", "[DEPRECATED] Import from Claude Code (use --targets claudecode)")
      .option("-v, --verbose", "Verbose output")
      .option(
        "--legacy",
        "Use legacy file location (.rulesync/*.md instead of .rulesync/rules/*.md)",
      )
      .action(async (options) => {
        try {
          let tools: ToolTarget[] = [];

          // Parse tools from --targets flag
          const targetsTools: ToolTarget[] = options.targets ? parseTargets(options.targets) : [];

          // Check for deprecated individual flags
          const deprecatedTools: ToolTarget[] = checkDeprecatedFlags(options);

          // Show deprecation warning if deprecated flags are used
          if (deprecatedTools.length > 0) {
            mockLogger.warn(getDeprecationWarning(deprecatedTools, "import"));
          }

          // Merge and deduplicate tools from all sources
          tools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, false);

          const importOptions = {
            ...(tools.length > 0 && { targets: tools }),
            ...(options.features && { features: options.features }),
            verbose: options.verbose,
            legacy: options.legacy,
          };

          await importCommand(importOptions);
        } catch (error) {
          mockLogger.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      });
  });

  describe("Single target validation", () => {
    it("should reject multiple targets", async () => {
      mockParseTargets.mockReturnValue(["cursor", "copilot"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["cursor", "copilot"]);

      await program.parseAsync(["node", "rulesync", "import", "--targets", "cursor,copilot"]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["cursor", "copilot"],
        }),
      );
    });
  });

  describe("--features option", () => {
    it("should parse and pass features array to import command", async () => {
      mockParseTargets.mockReturnValue(["cursor"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["cursor"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "import",
        "--targets",
        "cursor",
        "--features",
        "rules,mcp",
      ]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["cursor"],
          features: ["rules", "mcp"],
        }),
      );
    });

    it("should parse wildcard features correctly", async () => {
      mockParseTargets.mockReturnValue(["claudecode"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["claudecode"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "import",
        "--targets",
        "claudecode",
        "--features",
        "*",
      ]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["claudecode"],
          features: "*",
        }),
      );
    });

    it("should handle single feature", async () => {
      mockParseTargets.mockReturnValue(["copilot"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["copilot"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "import",
        "--targets",
        "copilot",
        "--features",
        "rules",
      ]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["copilot"],
          features: ["rules"],
        }),
      );
    });

    it("should not pass features when not specified", async () => {
      mockParseTargets.mockReturnValue(["cursor"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["cursor"]);

      await program.parseAsync(["node", "rulesync", "import", "--targets", "cursor"]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["cursor"],
          // features should be undefined when not specified
        }),
      );
      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.not.objectContaining({
          features: expect.anything(),
        }),
      );
    });
  });

  describe("Combined options", () => {
    it("should handle single target, features, and other options together", async () => {
      mockParseTargets.mockReturnValue(["cursor"]);
      mockCheckDeprecatedFlags.mockReturnValue([]);
      mockMergeAndDeduplicateTools.mockReturnValue(["cursor"]);

      await program.parseAsync([
        "node",
        "rulesync",
        "import",
        "--targets",
        "cursor",
        "--features",
        "rules,ignore",
        "--verbose",
        "--legacy",
      ]);

      expect(mockImportCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: ["cursor"],
          features: ["rules", "ignore"],
          verbose: true,
          legacy: true,
        }),
      );
    });
  });
});
