import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsProcessor } from "../../commands/commands-processor.js";
import { ConfigResolver } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import { logger } from "../../utils/logger.js";
import type { ImportOptions } from "./import.js";
import { importCommand } from "./import.js";

// Mock all dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../rules/rules-processor.js");
vi.mock("../../ignore/ignore-processor.js");
vi.mock("../../mcp/mcp-processor.js");
vi.mock("../../subagents/subagents-processor.js");
vi.mock("../../commands/commands-processor.js");
vi.mock("../../utils/logger.js");

describe("importCommand", () => {
  let mockExit: any;
  let mockConfig: any;

  beforeEach(() => {
    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as any);

    // Setup default mock config
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getTargets: vi.fn().mockReturnValue(["claudecode"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "subagents", "commands"]),
      getExperimentalGlobal: vi.fn().mockReturnValue(false),
    };

    vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig);
    vi.mocked(logger.setVerbose).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});

    // Setup processor mocks with default return values
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "roo", "geminicli"]);
    vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["claudecode", "roo", "geminicli"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode", "roo"]);
    vi.mocked(CommandsProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode"]);

    // Mock processor instances
    const mockProcessorMethods = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
      writeAiFiles: vi.fn().mockResolvedValue(0),
    };

    vi.mocked(RulesProcessor).mockImplementation(() => mockProcessorMethods as any);
    vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessorMethods as any);
    vi.mocked(McpProcessor).mockImplementation(() => mockProcessorMethods as any);
    vi.mocked(SubagentsProcessor).mockImplementation(() => mockProcessorMethods as any);
    vi.mocked(CommandsProcessor).mockImplementation(() => mockProcessorMethods as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validation", () => {
    it("should exit with error when no targets provided", async () => {
      const options: ImportOptions = {};

      await expect(importCommand(options)).rejects.toThrow("Process exit");
      expect(logger.error).toHaveBeenCalledWith("No tools found in --targets");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should exit with error when multiple targets provided", async () => {
      const options: ImportOptions = {
        targets: ["claudecode", "roo"],
      };

      await expect(importCommand(options)).rejects.toThrow("Process exit");
      expect(logger.error).toHaveBeenCalledWith("Only one tool can be imported at a time");
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("successful import", () => {
    it("should import rules when feature is enabled and tool is supported", async () => {
      const mockRulesProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "rule1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ rule: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(RulesProcessor).mockImplementation(() => mockRulesProcessor as any);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
      expect(mockRulesProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockRulesProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockRulesProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should import ignore files when feature is enabled and tool is supported", async () => {
      const mockIgnoreProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "ignore1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ ignore: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      expect(IgnoreProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
      expect(mockIgnoreProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockIgnoreProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockIgnoreProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should import MCP files when feature is enabled and tool is supported", async () => {
      const mockMcpProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "mcp1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ mcp: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(McpProcessor).mockImplementation(() => mockMcpProcessor as any);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      expect(McpProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
      expect(mockMcpProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockMcpProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockMcpProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should import subagents with includeSimulated flag", async () => {
      const mockSubagentsProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "subagent1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ subagent: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SubagentsProcessor).mockImplementation(() => mockSubagentsProcessor as any);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      // Verify that getToolTargets was called with includeSimulated: false
      expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith({ includeSimulated: false });
      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
      expect(mockSubagentsProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockSubagentsProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockSubagentsProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should import commands with includeSimulated flag", async () => {
      const mockCommandsProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "command1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ command: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(CommandsProcessor).mockImplementation(() => mockCommandsProcessor as any);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      // Verify that getToolTargets was called with includeSimulated: false
      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({ includeSimulated: false });
      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
      expect(mockCommandsProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockCommandsProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockCommandsProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should not create processors for unsupported tools", async () => {
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue([]);
      vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue([]);
      vi.mocked(McpProcessor.getToolTargets).mockReturnValue([]);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue([]);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue([]);

      const options: ImportOptions = {
        targets: ["roo" as any],
      };

      mockConfig.getTargets.mockReturnValue(["roo"]);

      await importCommand(options);

      expect(RulesProcessor).not.toHaveBeenCalled();
      expect(IgnoreProcessor).not.toHaveBeenCalled();
      expect(McpProcessor).not.toHaveBeenCalled();
      expect(SubagentsProcessor).not.toHaveBeenCalled();
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });

    it("should skip processors when feature is disabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      expect(RulesProcessor).not.toHaveBeenCalled();
      expect(IgnoreProcessor).not.toHaveBeenCalled();
      expect(McpProcessor).not.toHaveBeenCalled();
      expect(SubagentsProcessor).not.toHaveBeenCalled();
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });
  });

  describe("verbose logging", () => {
    beforeEach(() => {
      mockConfig.getVerbose.mockReturnValue(true);
    });

    it("should log success messages in verbose mode", async () => {
      const mockRulesProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "rule1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ rule: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(2),
      };
      vi.mocked(RulesProcessor).mockImplementation(() => mockRulesProcessor as any);

      const mockIgnoreProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "ignore1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ ignore: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockIgnoreProcessor as any);

      const mockMcpProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "mcp1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ mcp: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(3),
      };
      vi.mocked(McpProcessor).mockImplementation(() => mockMcpProcessor as any);

      const mockSubagentsProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "subagent1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ subagent: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(4),
      };
      vi.mocked(SubagentsProcessor).mockImplementation(() => mockSubagentsProcessor as any);

      const mockCommandsProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "command1" }]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ command: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(5),
      };
      vi.mocked(CommandsProcessor).mockImplementation(() => mockCommandsProcessor as any);

      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(true);
      expect(logger.success).toHaveBeenCalledWith("Created 2 rule files");
      expect(logger.success).toHaveBeenCalledWith(
        "Created ignore files from 1 tool ignore configurations",
      );
      expect(logger.success).toHaveBeenCalledWith("Created 1 ignore files");
      expect(logger.success).toHaveBeenCalledWith("Created 3 MCP files");
      expect(logger.success).toHaveBeenCalledWith("Created 4 subagent files");
      expect(logger.success).toHaveBeenCalledWith("Created 5 command files");
    });

    it("should not log success messages when no files are created", async () => {
      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([]),
        writeAiFiles: vi.fn().mockResolvedValue(0),
      };

      vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(McpProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(SubagentsProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(CommandsProcessor).mockImplementation(() => mockProcessor as any);

      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const options: ImportOptions = {
        targets: ["claudecode"],
      };

      await importCommand(options);

      // Only the setVerbose call should have been made, no success messages
      expect(logger.setVerbose).toHaveBeenCalledWith(true);
      expect(logger.success).not.toHaveBeenCalled();
    });
  });
});
