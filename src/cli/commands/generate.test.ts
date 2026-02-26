import { intersection } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "../../config/config-resolver.js";
import { CommandsProcessor } from "../../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../../features/ignore/ignore-processor.js";
import { McpProcessor } from "../../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../../features/rules/rules-processor.js";
import { SubagentsProcessor } from "../../features/subagents/subagents-processor.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type { GenerateOptions } from "./generate.js";
import { generateCommand } from "./generate.js";

// Mock all dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../features/rules/rules-processor.js");
vi.mock("../../features/ignore/ignore-processor.js");
vi.mock("../../features/mcp/mcp-processor.js");
vi.mock("../../features/subagents/subagents-processor.js");
vi.mock("../../features/commands/commands-processor.js");
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
    // Mock process.cwd to return a consistent value
    vi.spyOn(process, "cwd").mockReturnValue("/test/project");

    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("Process exit");
    }) as any);

    // Setup default mock config
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getSilent: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue(["."]),
      getTargets: vi.fn().mockReturnValue(["claudecode"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]),
      getDelete: vi.fn().mockReturnValue(false),
      getGlobal: vi.fn().mockReturnValue(false),
      getSimulateCommands: vi.fn().mockReturnValue(false),
      getSimulateSubagents: vi.fn().mockReturnValue(false),
      getSimulateSkills: vi.fn().mockReturnValue(false),
      getDryRun: vi.fn().mockReturnValue(false),
      getCheck: vi.fn().mockReturnValue(false),
      isPreviewMode: vi.fn().mockReturnValue(false),
    };

    vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig);
    vi.mocked(fileExists).mockResolvedValue(true);

    // Setup logger mocks
    vi.mocked(logger.configure).mockImplementation(() => {});
    vi.mocked(logger.info).mockImplementation(() => {});
    vi.mocked(logger.debug).mockImplementation(() => {});
    vi.mocked(logger.error).mockImplementation(() => {});
    vi.mocked(logger.success).mockImplementation(() => {});
    vi.mocked(logger.warn).mockImplementation(() => {});

    // Setup intersection mock to return the first array by default
    vi.mocked(intersection).mockImplementation((a, b) => a.filter((item) => b.includes(item)));

    // Setup default processor mock instance
    mockProcessorInstance = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
      loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
      writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
    };

    // Setup processor static method mocks
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

    // Setup processor constructor mocks - create new instance each time to ensure isolation
    vi.mocked(RulesProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(IgnoreProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(McpProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(SubagentsProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(CommandsProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial setup", () => {
    it("should resolve config and configure logger", async () => {
      const options: GenerateOptions = { verbose: true };

      await generateCommand(options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(options);
      expect(logger.configure).toHaveBeenCalledWith({ verbose: false, silent: false });
    });

    it("should configure verbose logging when config has verbose enabled", async () => {
      mockConfig.getVerbose.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.configure).toHaveBeenCalledWith({ verbose: true, silent: false });
    });

    it("should log generating files message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith("Generating files...");
    });
  });

  describe("rulesync directory check", () => {
    it("should exit with error when .rulesync directory does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Process exit");

      expect(fileExists).toHaveBeenCalledWith("/test/project/.rulesync");
      expect(logger.error).toHaveBeenCalledWith(
        "❌ .rulesync directory not found. Run 'rulesync init' first.",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should continue when .rulesync directory exists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(fileExists).toHaveBeenCalledWith("/test/project/.rulesync");
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

      expect(logger.debug).toHaveBeenCalledWith("Generating rule files...");
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
    });

    it("should pass simulation options to RulesProcessor", async () => {
      mockConfig.getSimulateCommands.mockReturnValue(true);
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: true,
        simulateSubagents: true,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
    });

    it("should remove old files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old" }];

      // Create a custom mock instance for this test
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue(oldFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
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
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir2",
        global: false,
        toolTarget: "claudecode",
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
    });

    it("should skip rules when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

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

      expect(logger.debug).toHaveBeenCalledWith("Generating MCP files...");
      expect(McpProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should only process supported MCP targets", async () => {
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor", "unsupported"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(intersection).toHaveBeenCalledWith(
        ["claudecode", "cursor", "unsupported"],
        ["claudecode"],
      );
    });

    it("should remove old MCP files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old-mcp" }];

      // Create a custom mock instance for this test
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue(oldFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(McpProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
    });

    it("should skip MCP when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

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

      expect(logger.debug).toHaveBeenCalledWith("Generating command files...");
      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getSimulateCommands.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: true,
      });
    });

    it("should skip commands when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(options);

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

      expect(logger.debug).toHaveBeenCalledWith("Generating ignore files...");
      expect(IgnoreProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        dryRun: false,
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
        dryRun: false,
      });

      mockCwd.mockRestore();
    });

    it("should handle errors in ignore processing gracefully", async () => {
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        throw new Error("Test error");
      });
      const options: GenerateOptions = {};

      // Should not throw, errors are caught and processing continues
      await generateCommand(options);

      // Should still complete without error
      expect(logger.info).toHaveBeenCalledWith("✓ All files are up to date (ignore)");
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

      expect(logger.debug).toHaveBeenCalledWith("Generating subagent files...");
      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: true,
      });
    });

    describe("global mode", () => {
      beforeEach(() => {
        mockConfig.getGlobal.mockReturnValue(true);
      });

      it("should use getToolTargets with global: true in global mode", async () => {
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(options);

        expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith(
          expect.objectContaining({ global: true }),
        );
      });

      it("should pass global flag to SubagentsProcessor constructor", async () => {
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(options);

        expect(SubagentsProcessor).toHaveBeenCalledWith({
          baseDir: ".",
          toolTarget: "claudecode",
          global: true,
          dryRun: false,
        });
      });

      it("should only process claudecode target in global mode", async () => {
        mockConfig.getTargets.mockReturnValue(["claudecode", "copilot", "cursor"]);
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        vi.mocked(intersection).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(options);

        expect(intersection).toHaveBeenCalledWith(
          ["claudecode", "copilot", "cursor"],
          ["claudecode"],
        );
        expect(SubagentsProcessor).toHaveBeenCalledWith({
          baseDir: ".",
          toolTarget: "claudecode",
          global: true,
          dryRun: false,
        });
      });

      it("should not process simulated targets in global mode even if simulateSubagents is true", async () => {
        mockConfig.getSimulateSubagents.mockReturnValue(true);
        mockConfig.getTargets.mockReturnValue(["claudecode", "copilot"]);
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        vi.mocked(intersection).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(options);

        // Should use getToolTargets with global: true instead of includeSimulated
        expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith(
          expect.objectContaining({ global: true }),
        );
        expect(SubagentsProcessor).toHaveBeenCalledTimes(1);
        expect(SubagentsProcessor).toHaveBeenCalledWith({
          baseDir: ".",
          toolTarget: "claudecode",
          global: true,
          dryRun: false,
        });
      });
    });
  });

  describe("output counting and final messages", () => {
    it("should show info when no files are written", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      // Override the RulesProcessor mock to return 0 files written
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.info).toHaveBeenCalledWith("✓ All files are up to date (rules)");
    });

    it("should show success message with correct totals", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands"]);

      // Create custom mock instances with specific return values
      const rulesMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 2, paths: [] }),
      };
      const mcpMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
      };
      const commandsMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };

      vi.mocked(RulesProcessor).mockImplementation(function () {
        return rulesMock as any;
      });
      vi.mocked(McpProcessor).mockImplementation(function () {
        return mcpMock as any;
      });
      vi.mocked(CommandsProcessor).mockImplementation(function () {
        return commandsMock as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 6 file(s) total (2 rules + 3 MCP files + 1 commands)",
      );
    });

    it("should handle all feature types in success message", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]);
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([{ file: "test" }]); // For ignore to process

      mockProcessorInstance.writeAiFiles.mockResolvedValue({ count: 1, paths: [] });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 5 file(s) total (1 rules + 1 ignore files + 1 MCP files + 1 commands + 1 subagents)",
      );
    });

    it("should log base directories", async () => {
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith("Base directories: dir1, dir2");
    });

    it("should log success for each processor type", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      // Create a custom mock instance that returns 3
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("Written 3 rule(s)");
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
      vi.mocked(RulesProcessor).mockImplementation(function () {
        throw new Error("Processor error");
      });
      const options: GenerateOptions = {};

      await expect(generateCommand(options)).rejects.toThrow("Processor error");
    });
  });

  describe("global mode", () => {
    beforeEach(() => {
      mockConfig.getGlobal.mockReturnValue(true);
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands", "ignore", "subagents"]);
    });

    it("should check .rulesync directory from process.cwd() not from baseDirs in global mode", async () => {
      mockConfig.getBaseDirs.mockReturnValue(["/home/user"]);
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      // Should check .rulesync in process.cwd(), not in baseDirs[0] (which is /home/user in global mode)
      expect(fileExists).toHaveBeenCalledWith("/test/project/.rulesync");
    });

    it("should use getToolTargets with global: true when global mode is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor.getToolTargets).toHaveBeenCalledWith({ global: true });
    });

    it("should pass simulation options to RulesProcessor in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getSimulateCommands.mockReturnValue(true);
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: true,
        simulateSubagents: true,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
    });

    it("should process delete option in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getDelete.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);

      // Create a custom mock instance to track calls
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue([{ file: "old" }]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
    });

    it("should use each baseDir in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2", "dir3"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir1",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir2",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: "dir3",
        toolTarget: "claudecode",
        global: true,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
      expect(RulesProcessor).toHaveBeenCalledTimes(3); // Once for each baseDir
    });

    it("should skip MCP generation in global mode when no targets match", async () => {
      // When targets is ["claudecode"] and global targets is ["codexcli"], intersection is empty
      vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["codexcli"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.debug).toHaveBeenCalledWith("Generating MCP files...");
      // McpProcessor should not be called because intersection of targets is empty
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should generate commands in global mode for supported tools", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: true,
        dryRun: false,
      });
      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith(
        expect.objectContaining({ global: true }),
      );
    });

    it("should skip ignore generation in global mode", async () => {
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should generate claudecode subagents in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);
      mockConfig.getTargets.mockReturnValue(["claudecode"]);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: true,
        dryRun: false,
      });
    });

    it("should show success message with only rules count in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);

      // Create a custom mock instance that returns 5
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 5, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("🎉 All done! Written 5 file(s) total (5 rules)");
    });

    it("should only process rules, commands, mcp, and subagents when global mode is enabled with multiple features", async () => {
      mockConfig.getTargets.mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["codexcli"]);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      // Set up intersection to return correct values
      const originalIntersection = vi.mocked(intersection);
      originalIntersection.mockImplementation((a: readonly unknown[], b: readonly unknown[]) =>
        (a as unknown[]).filter((item) => (b as unknown[]).includes(item)),
      );

      // Create factory functions that return new mock instances each time
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(McpProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(CommandsProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(SubagentsProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(RulesProcessor).toHaveBeenCalledTimes(2); // Once for claudecode, once for codexcli
      expect(CommandsProcessor).toHaveBeenCalledTimes(1); // Once for claudecode
      expect(McpProcessor).toHaveBeenCalledTimes(1); // Once for codexcli in global mode
      expect(SubagentsProcessor).toHaveBeenCalledTimes(1); // Once for claudecode
      expect(IgnoreProcessor).not.toHaveBeenCalled();
      expect(logger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 15 file(s) total (6 rules + 3 MCP files + 3 commands + 3 subagents)",
      );
    });
  });

  describe("integration scenarios", () => {
    it("should handle mixed success and failure scenarios", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore"]);

      // Set up rules processor to succeed
      const mockRulesProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 2, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockRulesProcessor as any;
      });

      // Set up ignore processor to throw an error (errors are caught and ignored in lib)
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        throw new Error("Ignore error");
      });

      const options: GenerateOptions = {};

      await generateCommand(options);

      expect(logger.success).toHaveBeenCalledWith("Written 2 rule(s)");
      expect(logger.success).toHaveBeenCalledWith("🎉 All done! Written 2 file(s) total (2 rules)");
    });

    it("should handle multiple targets and base directories", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);

      mockProcessorInstance.writeAiFiles.mockResolvedValue({ count: 1, paths: [] });
      const options: GenerateOptions = {};

      await generateCommand(options);

      // Should create processors for each combination of base dir and target
      expect(RulesProcessor).toHaveBeenCalledTimes(4); // 2 dirs × 2 targets
      // Total count is 4 (1 per processor)
      expect(logger.success).toHaveBeenCalledWith("Written 4 rule(s)");
      expect(logger.success).toHaveBeenCalledWith("🎉 All done! Written 4 file(s) total (4 rules)");
    });
  });
});
