import { intersection } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsProcessor } from "../../commands/commands-processor.js";
import { ConfigResolver } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type { GenerateOptions } from "./generate.js";
import { generateCommand } from "./generate.js";

// Mock all dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../rules/rules-processor.js");
vi.mock("../../ignore/ignore-processor.js");
vi.mock("../../mcp/mcp-processor.js");
vi.mock("../../subagents/subagents-processor.js");
vi.mock("../../commands/commands-processor.js");
vi.mock("../../utils/file.js");
vi.mock("../../utils/logger.js");
vi.mock("es-toolkit", () => ({
  intersection: vi.fn(),
}));

describe("generateCommand", () => {
  let mockExit: any;
  let mockConfig: any;
  let mockProcessorInstance: any;

  beforeEach(() => {
    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as any);

    // Setup default mock config
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue(["."]),
      getTargets: vi.fn().mockReturnValue(["claudecode"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]),
      getDelete: vi.fn().mockReturnValue(false),
      getExperimentalGlobal: vi.fn().mockReturnValue(false),
      getExperimentalSimulateCommands: vi.fn().mockReturnValue(false),
      getExperimentalSimulateSubagents: vi.fn().mockReturnValue(false),
    };

    vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig);
    vi.mocked(fileExists).mockResolvedValue(true);

    // Setup logger mocks
    vi.mocked(logger.setVerbose).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});

    // Setup intersection mock to return the first array by default
    vi.mocked(intersection).mockImplementation((a, b) => a.filter((item) => b.includes(item)));

    // Setup default processor mock instance
    mockProcessorInstance = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      loadToolFilesToDelete: vi.fn().mockResolvedValue([]),
      removeAiFiles: vi.fn().mockResolvedValue(undefined),
      loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
      loadRulesyncFilesLegacy: vi.fn().mockResolvedValue([{ file: "legacy" }]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };

    // Setup processor static method mocks
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode"]);

    // Setup processor constructor mocks
    vi.mocked(RulesProcessor).mockImplementation(() => mockProcessorInstance as any);
    vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessorInstance as any);
    vi.mocked(McpProcessor).mockImplementation(() => mockProcessorInstance as any);
    vi.mocked(SubagentsProcessor).mockImplementation(() => mockProcessorInstance as any);
    vi.mocked(CommandsProcessor).mockImplementation(() => mockProcessorInstance as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial setup", () => {
    it("should resolve config and set logger verbosity", async () => {
      const options: GenerateOptions = { verbose: true };

      await generateCommand(options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(options);
      expect(logger.setVerbose).toHaveBeenCalledWith(false);
    });

    it("should set verbose logging when config has verbose enabled", async () => {
      mockConfig.getVerbose.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.setVerbose).toHaveBeenCalledWith(true);
    });

    it("should log generating files message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating files...");
    });
  });

  describe("rulesync directory check", () => {
    it("should exit with error when .rulesync directory does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Process exit");

      expect(fileExists).toHaveBeenCalledWith(".rulesync");
      expect(logger.error).toHaveBeenCalledWith(
        "❌ .rulesync directory not found. Run 'rulesync init' first.",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should continue when .rulesync directory exists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(fileExists).toHaveBeenCalledWith(".rulesync");
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("rules feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
    });

    it("should generate rule files when rules feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating rule files...");
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: false,
        simulateSubagents: false,
      });
    });

    it("should pass simulation options to RulesProcessor", async () => {
      mockConfig.getExperimentalSimulateCommands.mockReturnValue(true);
      mockConfig.getExperimentalSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: true,
        simulateSubagents: true,
      });
    });

    it("should remove old files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old" }];
      mockProcessorInstance.loadToolFilesToDelete.mockResolvedValue(oldFiles);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.loadToolFilesToDelete).toHaveBeenCalled();
      expect(mockProcessorInstance.removeAiFiles).toHaveBeenCalledWith(oldFiles);
    });

    it("should use legacy files when no rulesync files found", async () => {
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([]);
      const legacyFiles = [{ file: "legacy" }];
      mockProcessorInstance.loadRulesyncFilesLegacy.mockResolvedValue(legacyFiles);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.loadRulesyncFilesLegacy).toHaveBeenCalled();
      expect(mockProcessorInstance.convertRulesyncFilesToToolFiles).toHaveBeenCalledWith(
        legacyFiles,
      );
    });

    it("should process multiple base directories", async () => {
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir1",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: false,
        simulateSubagents: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir2",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: false,
        simulateSubagents: false,
      });
    });

    it("should skip rules when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith("Skipping rule generation (not in --features)");
      expect(RulesProcessor).not.toHaveBeenCalled();
    });
  });

  describe("mcp feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
    });

    it("should generate MCP files when mcp feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating MCP files...");
      expect(McpProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
    });

    it("should only process supported MCP targets", async () => {
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor", "unsupported"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(intersection).toHaveBeenCalledWith(["claudecode", "cursor"], ["claudecode"]);
    });

    it("should remove old MCP files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old-mcp" }];
      mockProcessorInstance.loadToolFilesToDelete.mockResolvedValue(oldFiles);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.removeAiFiles).toHaveBeenCalledWith(oldFiles);
    });

    it("should skip MCP when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith(
        "Skipping MCP configuration generation (not in --features)",
      );
      expect(McpProcessor).not.toHaveBeenCalled();
    });
  });

  describe("commands feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);
    });

    it("should generate command files when commands feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating command files...");
      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getExperimentalSimulateCommands.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        includeSimulated: true,
      });
    });

    it("should skip commands when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith(
        "Skipping command file generation (not in --features)",
      );
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });
  });

  describe("ignore feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      mockConfig.getBaseDirs.mockReturnValue(["."]);
    });

    it("should generate ignore files when ignore feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating ignore files...");
      expect(IgnoreProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
    });

    it("should handle current working directory correctly", async () => {
      const mockCwd = vi.spyOn(process, "cwd").mockReturnValue("/current/working/dir");
      mockConfig.getBaseDirs.mockReturnValue(["/current/working/dir"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(IgnoreProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });

      mockCwd.mockRestore();
    });

    it("should handle errors in ignore processing", async () => {
      vi.mocked(IgnoreProcessor).mockImplementation(() => {
        throw new Error("Test error");
      });
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to generate claudecode ignore files for .:",
        "Test error",
      );
    });

    it("should skip ignore files when no rulesync files found", async () => {
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.convertRulesyncFilesToToolFiles).not.toHaveBeenCalled();
      expect(mockProcessorInstance.writeAiFiles).not.toHaveBeenCalled();
    });
  });

  describe("subagents feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);
    });

    it("should generate subagent files when subagents feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Generating subagent files...");
      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getExperimentalSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith({
        includeSimulated: true,
      });
    });
  });

  describe("output counting and final messages", () => {
    it("should show warning when no files are generated", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockProcessorInstance.writeAiFiles.mockResolvedValue(0);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.warn).toHaveBeenCalledWith("⚠️  No files generated for enabled features: rules");
    });

    it("should show success message with correct totals", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands"]);

      // Mock different return values for different processors
      let callCount = 0;
      mockProcessorInstance.writeAiFiles.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(2); // rules
        if (callCount === 2) return Promise.resolve(3); // mcp
        if (callCount === 3) return Promise.resolve(1); // commands
        return Promise.resolve(0);
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Generated 6 file(s) total (2 rules + 3 MCP files + 1 commands)",
      );
    });

    it("should handle all feature types in success message", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]);
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([{ file: "test" }]); // For ignore to process

      mockProcessorInstance.writeAiFiles.mockResolvedValue(1);

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Generated 5 file(s) total (1 rules + 1 ignore files + 1 MCP files + 1 commands + 1 subagents)",
      );
    });

    it("should log base directories", async () => {
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("Base directories: dir1, dir2");
    });

    it("should log success for each processor type", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockProcessorInstance.writeAiFiles.mockResolvedValue(3);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("Generated 3 claudecode rule(s) in .");
    });
  });

  describe("error handling", () => {
    it("should handle ConfigResolver errors", async () => {
      vi.mocked(ConfigResolver.resolve).mockRejectedValue(new Error("Config error"));
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Config error");
    });

    it("should handle file existence check errors", async () => {
      vi.mocked(fileExists).mockRejectedValue(new Error("File system error"));
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("File system error");
    });

    it("should handle processor instantiation errors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor).mockImplementation(() => {
        throw new Error("Processor error");
      });
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Processor error");
    });
  });

  describe("global mode", () => {
    beforeEach(() => {
      mockConfig.getExperimentalGlobal.mockReturnValue(true);
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands", "ignore", "subagents"]);
    });

    it("should use getToolTargetsGlobal when experimentalGlobal is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor.getToolTargetsGlobal).toHaveBeenCalled();
      expect(RulesProcessor.getToolTargets).not.toHaveBeenCalled();
    });

    it("should pass simulation options to RulesProcessor in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getExperimentalSimulateCommands.mockReturnValue(true);
      mockConfig.getExperimentalSimulateSubagents.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: true,
        simulateSubagents: true,
      });
    });

    it("should process delete option in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getDelete.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.loadToolFilesToDelete).toHaveBeenCalled();
      expect(mockProcessorInstance.removeAiFiles).toHaveBeenCalled();
    });

    it("should call loadRulesyncFilesLegacy in global mode when loadRulesyncFiles returns empty", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([]);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(mockProcessorInstance.loadRulesyncFilesLegacy).toHaveBeenCalled();
    });

    it("should use each baseDir in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2", "dir3"]);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir1",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir2",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir3",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
      });
      expect(RulesProcessor).toHaveBeenCalledTimes(3); // Once for each baseDir
    });

    it("should skip MCP generation in global mode with log message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith(
        "Skipping MCP configuration generation (not supported in global mode)",
      );
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should generate commands in global mode for supported tools", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: true,
      });
      expect(CommandsProcessor.getToolTargetsGlobal).toHaveBeenCalled();
    });

    it("should skip ignore generation in global mode with log message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith(
        "Skipping ignore file generation (not supported in global mode)",
      );
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should skip subagents generation in global mode with log message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith(
        "Skipping subagent file generation (not supported in global mode)",
      );
      expect(SubagentsProcessor).not.toHaveBeenCalled();
    });

    it("should show success message with only rules count in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockProcessorInstance.writeAiFiles.mockResolvedValue(5);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Generated 5 file(s) total (5 rules)",
      );
    });

    it("should only process rules and commands when global mode is enabled with multiple features", async () => {
      mockProcessorInstance.writeAiFiles.mockResolvedValue(3);
      mockConfig.getTargets.mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(RulesProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(CommandsProcessor.getToolTargetsGlobal).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledTimes(2); // Once for claudecode, once for codexcli
      expect(CommandsProcessor).toHaveBeenCalledTimes(1); // Once for claudecode
      expect(McpProcessor).not.toHaveBeenCalled();
      expect(IgnoreProcessor).not.toHaveBeenCalled();
      expect(SubagentsProcessor).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Generated 9 file(s) total (6 rules + 3 commands)",
      );
    });
  });

  describe("integration scenarios", () => {
    it("should handle mixed success and failure scenarios", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore"]);

      // Set up rules processor to succeed
      const mockRulesProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        loadRulesyncFilesLegacy: vi.fn().mockResolvedValue([]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue(2),
      };
      vi.mocked(RulesProcessor).mockImplementation(() => mockRulesProcessor as any);

      // Set up ignore processor to throw an error
      vi.mocked(IgnoreProcessor).mockImplementation(() => {
        throw new Error("Ignore error");
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("Generated 2 claudecode rule(s) in .");
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to generate claudecode ignore files for .:",
        "Ignore error",
      );
      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Generated 2 file(s) total (2 rules)",
      );
    });

    it("should handle multiple targets and base directories", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);

      mockProcessorInstance.writeAiFiles.mockResolvedValue(1);
      const options: GenerateOptions = {};

      await generateCommand(options);

      // Should create processors for each combination of base dir and target
      expect(RulesProcessor).toHaveBeenCalledTimes(4); // 2 dirs × 2 targets
      expect(logger.success).toHaveBeenCalledWith("Generated 1 claudecode rule(s) in dir1");
      expect(logger.success).toHaveBeenCalledWith("Generated 1 cursor rule(s) in dir1");
      expect(logger.success).toHaveBeenCalledWith("Generated 1 claudecode rule(s) in dir2");
      expect(logger.success).toHaveBeenCalledWith("Generated 1 cursor rule(s) in dir2");
    });
  });
});
