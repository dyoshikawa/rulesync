import { intersection } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigResolver } from "../../config/config-resolver.js";
import { CommandsProcessor } from "../../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../../features/ignore/ignore-processor.js";
import { McpProcessor } from "../../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../../features/rules/rules-processor.js";
import { SubagentsProcessor } from "../../features/subagents/subagents-processor.js";
import { watchTargets } from "../../lib/watch.js";
import { mockProcessorBase } from "../../test-utils/mock-feature-processor.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { directoryExists, fileExists } from "../../utils/file.js";
import type { GenerateOptions } from "./generate.js";
import { assertWatchModeCompatible, generateCommand } from "./generate.js";

// Mock all dependencies
vi.mock("../../config/config-resolver.js");
vi.mock("../../features/rules/rules-processor.js");
vi.mock("../../features/ignore/ignore-processor.js");
vi.mock("../../features/mcp/mcp-processor.js");
vi.mock("../../features/subagents/subagents-processor.js");
vi.mock("../../features/commands/commands-processor.js");
vi.mock("../../utils/file.js");
vi.mock("../../lib/watch.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/watch.js")>("../../lib/watch.js");
  return {
    ...actual,
    watchTargets: vi.fn().mockReturnValue({ close: vi.fn() }),
  };
});
vi.mock("es-toolkit", () => ({
  intersection: vi.fn(),
}));

describe("generateCommand", () => {
  let mockExit: any;
  let mockConfig: any;
  let mockProcessorInstance: any;
  let mockLogger: ReturnType<typeof createMockLogger>;

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
      getOutputRoots: vi.fn().mockReturnValue(["."]),
      getTargets: vi.fn().mockReturnValue(["claudecode"]),
      getConfigFileTargets: vi.fn().mockReturnValue(["claudecode"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]),
      getFeatureOptions: vi.fn().mockReturnValue(undefined),
      getDelete: vi.fn().mockReturnValue(false),
      getGlobal: vi.fn().mockReturnValue(false),
      getSimulateCommands: vi.fn().mockReturnValue(false),
      getSimulateSubagents: vi.fn().mockReturnValue(false),
      getSimulateSkills: vi.fn().mockReturnValue(false),
      getLanguage: vi.fn().mockReturnValue(undefined),
      getDeriveSubprojectPathFromGlobs: vi.fn().mockReturnValue(false),
      getFlattenedCommandNaming: vi.fn().mockReturnValue("basename"),
      getDryRun: vi.fn().mockReturnValue(false),
      getCheck: vi.fn().mockReturnValue(false),
      isPreviewMode: vi.fn().mockReturnValue(false),
      getInputRoots: vi.fn().mockReturnValue([`${process.cwd()}/.rulesync`]),
    };

    vi.mocked(ConfigResolver.resolve).mockResolvedValue(mockConfig);
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(directoryExists).mockResolvedValue(true);

    mockLogger = createMockLogger();

    // Setup intersection mock to return the first array by default
    vi.mocked(intersection).mockImplementation((a, b) => a.filter((item) => b.includes(item)));

    // Setup default processor mock instance
    mockProcessorInstance = {
      loadToolFiles: vi.fn().mockResolvedValue([]),
      removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
      ...mockProcessorBase(),
      loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
      convertRulesyncFilesToToolFiles: vi
        .fn()
        .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
      writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
    };

    // Setup processor static method mocks
    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockImplementation(({ global = false } = {}) =>
      global ? ["kiro-cli"] : ["claudecode"],
    );
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

    // Setup processor constructor mocks - create new instance each time to ensure isolation
    vi.mocked(RulesProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(IgnoreProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(McpProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(SubagentsProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
    vi.mocked(CommandsProcessor).mockImplementation(function () {
      return {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      } as any;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initial setup", () => {
    it("should resolve config", async () => {
      const options: GenerateOptions = { verbose: true };

      await generateCommand(mockLogger, options);

      expect(ConfigResolver.resolve).toHaveBeenCalledWith(options, { logger: mockLogger });
    });

    it("should log generating files message", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating files...");
    });
  });

  describe("rulesync directory check", () => {
    it("should throw error when .rulesync directory does not exist", async () => {
      vi.mocked(directoryExists).mockResolvedValue(false);
      vi.mocked(fileExists).mockResolvedValue(false);
      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow(
        "Rulesync source directory '/test/project/.rulesync' does not exist. Run 'rulesync init' first.",
      );

      expect(directoryExists).toHaveBeenCalledWith("/test/project/.rulesync");
    });

    it("should throw a distinct error when .rulesync exists but is not a directory", async () => {
      vi.mocked(directoryExists).mockResolvedValue(false);
      vi.mocked(fileExists).mockResolvedValue(true);
      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow(
        "Configured primary input root '/test/project/.rulesync' exists but is not a directory.",
      );
    });

    it("should continue when .rulesync directory exists", async () => {
      vi.mocked(directoryExists).mockResolvedValue(true);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(directoryExists).toHaveBeenCalledWith("/test/project/.rulesync");
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("rules feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
    });

    it("should generate rule files when rules feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating rule files...");
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          global: false,
          toolTarget: "claudecode",
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
    });

    it("should pass simulation options to RulesProcessor", async () => {
      mockConfig.getSimulateCommands.mockReturnValue(true);
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          global: false,
          toolTarget: "claudecode",
          simulateCommands: true,
          simulateSubagents: true,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
    });

    it("should remove old files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old", getFilePath: () => "/path/to/old" }];

      // Create a custom mock instance for this test
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue(oldFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
    });

    it("should process multiple base directories", async () => {
      mockConfig.getOutputRoots.mockReturnValue(["dir1", "dir2"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "dir1",
          global: false,
          toolTarget: "claudecode",
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "dir2",
          global: false,
          toolTarget: "claudecode",
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
    });

    it("should skip rules when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).not.toHaveBeenCalled();
    });
  });

  describe("mcp feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
    });

    it("should generate MCP files when mcp feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating MCP files...");
      expect(McpProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: false,
          dryRun: false,
        }),
      );
    });

    it("should only process supported MCP targets", async () => {
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor", "unsupported"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(intersection).toHaveBeenCalledWith(
        ["claudecode", "cursor", "unsupported"],
        ["claudecode"],
      );
    });

    it("should remove old MCP files when delete option is enabled", async () => {
      mockConfig.getDelete.mockReturnValue(true);
      const oldFiles = [{ file: "old-mcp", getFilePath: () => "/path/to/old-mcp" }];

      // Create a custom mock instance for this test
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue(oldFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(McpProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
    });

    it("should skip MCP when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(McpProcessor).not.toHaveBeenCalled();
    });
  });

  describe("commands feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);
    });

    it("should generate command files when commands feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating command files...");
      expect(CommandsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: false,
          dryRun: false,
        }),
      );
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getSimulateCommands.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: true,
      });
    });

    it("should skip commands when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(CommandsProcessor).not.toHaveBeenCalled();
    });
  });

  describe("ignore feature", () => {
    beforeEach(() => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      mockConfig.getOutputRoots.mockReturnValue(["."]);
    });

    it("should generate ignore files when ignore feature is enabled", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating ignore files...");
      expect(IgnoreProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          dryRun: false,
        }),
      );
    });

    it("should pass outputRoot verbatim even when it equals current working directory", async () => {
      // The legacy `outputRoot === process.cwd() ? "." : outputRoot` heuristic was
      // removed to keep ignore processing consistent with every other
      // feature processor — IgnoreProcessor now receives the same absolute
      // path the other processors receive.
      const mockCwd = vi.spyOn(process, "cwd").mockReturnValue("/current/working/dir");
      mockConfig.getOutputRoots.mockReturnValue(["/current/working/dir"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(IgnoreProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/current/working/dir",
          toolTarget: "claudecode",
          dryRun: false,
        }),
      );

      mockCwd.mockRestore();
    });

    it("should fail the command on an ignore error instead of reporting success", async () => {
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        throw new Error("Test error");
      });
      const options: GenerateOptions = {};

      // A swallowed ignore error used to end with "All files are up to date"
      // while nothing was written — the fail-open direction for the feature
      // that keeps secrets away from AI tools (see #2551).
      await expect(generateCommand(mockLogger, options)).rejects.toThrow("Test error");
      expect(mockLogger.info).not.toHaveBeenCalledWith("✓ All files are up to date (ignore)");
    });

    it("should skip ignore files when no rulesync files found", async () => {
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

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

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating subagent files...");
      expect(SubagentsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: false,
          dryRun: false,
        }),
      );
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

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

        await generateCommand(mockLogger, options);

        expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith(
          expect.objectContaining({ global: true }),
        );
      });

      it("should pass global flag to SubagentsProcessor constructor", async () => {
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(mockLogger, options);

        expect(SubagentsProcessor).toHaveBeenCalledWith(
          expect.objectContaining({
            outputRoot: ".",
            toolTarget: "claudecode",
            global: true,
            dryRun: false,
          }),
        );
      });

      it("should only process claudecode target in global mode", async () => {
        mockConfig.getTargets.mockReturnValue(["claudecode", "copilot", "cursor"]);
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        vi.mocked(intersection).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(mockLogger, options);

        expect(intersection).toHaveBeenCalledWith(
          ["claudecode", "copilot", "cursor"],
          ["claudecode"],
        );
        expect(SubagentsProcessor).toHaveBeenCalledWith(
          expect.objectContaining({
            outputRoot: ".",
            toolTarget: "claudecode",
            global: true,
            dryRun: false,
          }),
        );
      });

      it("should not process simulated targets in global mode even if simulateSubagents is true", async () => {
        mockConfig.getSimulateSubagents.mockReturnValue(true);
        mockConfig.getTargets.mockReturnValue(["claudecode", "copilot"]);
        vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
        vi.mocked(intersection).mockReturnValue(["claudecode"]);
        const options: GenerateOptions = {};

        await generateCommand(mockLogger, options);

        // Should use getToolTargets with global: true instead of includeSimulated
        expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith(
          expect.objectContaining({ global: true }),
        );
        expect(SubagentsProcessor).toHaveBeenCalledTimes(1);
        expect(SubagentsProcessor).toHaveBeenCalledWith(
          expect.objectContaining({
            outputRoot: ".",
            toolTarget: "claudecode",
            global: true,
            dryRun: false,
          }),
        );
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
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.info).toHaveBeenCalledWith("✓ All files are up to date (rules)");
    });

    it("should show success message with correct totals", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands"]);

      // Create custom mock instances with specific return values
      const rulesMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 2, paths: [] }),
      };
      const mcpMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
      };
      const commandsMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
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

      await generateCommand(mockLogger, options);

      expect(mockLogger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 6 file(s) total (2 rules + 3 MCP files + 1 commands)",
      );
    });

    it("should handle all feature types in success message", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]);
      mockProcessorInstance.loadRulesyncFiles.mockResolvedValue([{ file: "test" }]); // For ignore to process

      mockProcessorInstance.writeAiFiles.mockResolvedValue({ count: 1, paths: [] });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 5 file(s) total (1 rules + 1 ignore files + 1 MCP files + 1 commands + 1 subagents)",
      );
    });

    it("should log output roots", async () => {
      mockConfig.getOutputRoots.mockReturnValue(["dir1", "dir2"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Output roots: dir1, dir2");
    });

    it("should log success for each processor type", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      // Create a custom mock instance that returns 3
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.success).toHaveBeenCalledWith("Written 3 rules");
    });
  });

  describe("check mode", () => {
    it("should fail when check mode would delete orphan files", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getCheck.mockReturnValue(true);
      mockConfig.getDelete.mockReturnValue(true);
      mockConfig.isPreviewMode.mockReturnValue(true);

      const rulesMock = {
        loadToolFiles: vi.fn().mockResolvedValue([
          {
            getFilePath: () => "/path/to/orphan",
          },
        ]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(1),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([
          {
            getFilePath: () => "/path/to/rulesync",
          },
        ]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([
          {
            getFilePath: () => "/path/to/converted",
          },
        ]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return rulesMock as any;
      });

      await expect(generateCommand(mockLogger, {})).rejects.toThrow(
        "Files are not up to date. Run 'rulesync generate' to update.",
      );

      expect(mockLogger.info).not.toHaveBeenCalledWith("✓ All files are up to date (rules)");
    });

    it("should succeed when check mode finds no diff", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getCheck.mockReturnValue(true);
      mockConfig.isPreviewMode.mockReturnValue(true);

      const rulesMock = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(0),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([
          {
            getFilePath: () => "/path/to/rulesync",
          },
        ]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([
          {
            getFilePath: () => "/path/to/converted",
          },
        ]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return rulesMock as any;
      });

      await generateCommand(mockLogger, {});

      expect(mockLogger.success).toHaveBeenCalledWith("✓ All files are up to date.");
    });
  });

  describe("error handling", () => {
    it("should handle ConfigResolver errors", async () => {
      vi.mocked(ConfigResolver.resolve).mockRejectedValue(new Error("Config error"));
      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow("Config error");
    });

    it("should handle input root directory check errors", async () => {
      vi.mocked(directoryExists).mockRejectedValue(new Error("File system error"));
      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow("File system error");
    });

    it("should handle processor instantiation errors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor).mockImplementation(function () {
        throw new Error("Processor error");
      });
      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow("Processor error");
    });
  });

  describe("global mode", () => {
    beforeEach(() => {
      mockConfig.getGlobal.mockReturnValue(true);
      mockConfig.getFeatures.mockReturnValue(["rules", "mcp", "commands", "ignore", "subagents"]);
    });

    it("should check .rulesync directory from process.cwd() not from outputRoots in global mode", async () => {
      mockConfig.getOutputRoots.mockReturnValue(["/home/user"]);
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      // Should check the source tree at cwd, not outputRoots[0] (`/home/user`
      // in global mode).
      expect(directoryExists).toHaveBeenCalledWith("/test/project/.rulesync");
    });

    it("should use getToolTargets with global: true when global mode is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor.getToolTargets).toHaveBeenCalledWith({ global: true });
    });

    it("should pass simulation options to RulesProcessor in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getSimulateCommands.mockReturnValue(true);
      mockConfig.getSimulateSubagents.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: true,
          simulateCommands: true,
          simulateSubagents: true,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
    });

    it("should process delete option in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getDelete.mockReturnValue(true);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);

      // Create a custom mock instance to track calls
      const customMockInstance = {
        loadToolFiles: vi
          .fn()
          .mockResolvedValue([{ file: "old", getFilePath: () => "/path/to/old" }]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(customMockInstance.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(customMockInstance.removeOrphanAiFiles).toHaveBeenCalled();
    });

    it("should use each outputRoot in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getOutputRoots.mockReturnValue(["dir1", "dir2", "dir3"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "dir1",
          toolTarget: "claudecode",
          global: true,
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "dir2",
          toolTarget: "claudecode",
          global: true,
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "dir3",
          toolTarget: "claudecode",
          global: true,
          simulateCommands: false,
          simulateSubagents: false,
          simulateSkills: false,
          skills: [],
          dryRun: false,
        }),
      );
      expect(RulesProcessor).toHaveBeenCalledTimes(3); // Once for each outputRoot
    });

    it("should skip MCP generation in global mode when no targets match", async () => {
      // When targets is ["claudecode"] and global targets is ["codexcli"], intersection is empty
      vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["codexcli"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.debug).toHaveBeenCalledWith("Generating MCP files...");
      // McpProcessor should not be called because intersection of targets is empty
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should generate commands in global mode for supported tools", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(CommandsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: true,
          dryRun: false,
        }),
      );
      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith(
        expect.objectContaining({ global: true }),
      );
    });

    it("should skip ignore generation for targets without global support", async () => {
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should generate Kiro ignore files in global mode", async () => {
      mockConfig.getTargets.mockReturnValue(["kiro-cli"]);
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(IgnoreProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          toolTarget: "kiro-cli",
          global: true,
        }),
      );
    });

    it("should generate claudecode subagents in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);
      mockConfig.getTargets.mockReturnValue(["claudecode"]);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(SubagentsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: ".",
          toolTarget: "claudecode",
          global: true,
          dryRun: false,
        }),
      );
    });

    it("should show success message with only rules count in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode", "codexcli"]);
      vi.mocked(intersection).mockReturnValue(["claudecode"]);

      // Create a custom mock instance that returns 5
      const customMockInstance = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 5, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return customMockInstance as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(mockLogger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 5 file(s) total (5 rules)",
      );
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
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(McpProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(CommandsProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });
      vi.mocked(SubagentsProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 3, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      expect(RulesProcessor).toHaveBeenCalledTimes(2); // Once for claudecode, once for codexcli
      expect(CommandsProcessor).toHaveBeenCalledTimes(1); // Once for claudecode
      expect(McpProcessor).toHaveBeenCalledTimes(1); // Once for codexcli in global mode
      expect(SubagentsProcessor).toHaveBeenCalledTimes(1); // Once for claudecode
      expect(IgnoreProcessor).not.toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 15 file(s) total (6 rules + 3 MCP files + 3 commands + 3 subagents)",
      );
    });
  });

  describe("inputRoots decoupling", () => {
    // Each inputRoots entry is a rulesync source tree itself — independent of
    // the output outputRoots.
    const inputRoots = ["/central/rulesync-source/.rulesync"];
    const outputRoots = ["/project/app-one", "/project/app-two"];

    beforeEach(() => {
      mockConfig.getInputRoots.mockReturnValue(inputRoots);
      mockConfig.getOutputRoots.mockReturnValue(outputRoots);
    });

    it("should check configured inputRoots, not outputRoots", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await generateCommand(mockLogger, {});

      expect(directoryExists).toHaveBeenCalledWith("/central/rulesync-source/.rulesync");
      expect(directoryExists).not.toHaveBeenCalledWith("/project/app-one/.rulesync");
      expect(directoryExists).not.toHaveBeenCalledWith("/project/app-two/.rulesync");
    });

    it("should construct RulesProcessor with inputRoots distinct from outputRoot for each output dir", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await generateCommand(mockLogger, {});

      expect(RulesProcessor).toHaveBeenCalledTimes(2);
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-one",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-two",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
    });

    it("should pass inputRoots to IgnoreProcessor independently of outputRoot", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      await generateCommand(mockLogger, {});

      expect(IgnoreProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-one",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
      expect(IgnoreProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-two",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
    });

    it("should pass inputRoots to McpProcessor independently of outputRoot", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);

      await generateCommand(mockLogger, {});

      expect(McpProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-one",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
      expect(McpProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-two",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
    });

    it("should pass inputRoots to CommandsProcessor independently of outputRoot", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      await generateCommand(mockLogger, {});

      expect(CommandsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-one",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
      expect(CommandsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-two",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
    });

    it("should pass inputRoots to SubagentsProcessor independently of outputRoot", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      await generateCommand(mockLogger, {});

      expect(SubagentsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-one",
          inputRoots,
          toolTarget: "claudecode",
        }),
      );
      expect(SubagentsProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          outputRoot: "/project/app-two",
          inputRoots,
          toolTarget: "claudecode",
        }),
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
        ...mockProcessorBase(),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi
          .fn()
          .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
        writeAiFiles: vi.fn().mockResolvedValue({ count: 2, paths: [] }),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockRulesProcessor as any;
      });

      // Set up ignore processor to throw an error — a feature error now
      // fails the whole run instead of being silently ignored (#2551).
      // Ignore is the first step in GENERATION_STEP_GRAPH, so the rules step
      // never runs and no success banner is emitted.
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        throw new Error("Ignore error");
      });

      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toThrow("Ignore error");
      expect(mockLogger.success).not.toHaveBeenCalledWith(
        "🎉 All done! Written 2 file(s) total (2 rules)",
      );
    });

    it("should fail in check mode when only orphan deletions occur (no new files)", async () => {
      // Regression test: previously, generateCommand returned early when
      // totalGenerated === 0, which skipped the --check mode hasDiff handling.
      // This caused check mode to silently succeed when the only diff was an
      // orphan file that would be deleted.
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getCheck.mockReturnValue(true);
      mockConfig.getDelete.mockReturnValue(true);

      // Shape of the orphan entry is irrelevant — only the count returned by
      // removeOrphanAiFiles drives the hasDiff branch under test.
      const removeOrphanMock = vi.fn().mockResolvedValue(1);
      const loadToolFilesMock = vi
        .fn()
        .mockResolvedValue([{ orphan: "file", getFilePath: () => "/path/to/orphan" }]);
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: loadToolFilesMock,
          removeOrphanAiFiles: removeOrphanMock,
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toMatchObject({
        code: ErrorCodes.GENERATION_FAILED,
        message: "Files are not up to date. Run 'rulesync generate' to update.",
      });

      // Guard the actual code path: orphan detection must have run before the
      // check-mode hasDiff branch throws.
      expect(loadToolFilesMock).toHaveBeenCalled();
      expect(removeOrphanMock).toHaveBeenCalled();
    });

    it("should fail when a rulesync source could not be loaded", async () => {
      // Regression test for #2789: a source that fails to load writes nothing,
      // which every counter reports exactly like "there was nothing to write".
      // The run must fail instead of printing the up-to-date banner.
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
      vi.mocked(McpProcessor).mockImplementation(function () {
        return {
          hasRulesyncSourceLoadFailure: vi.fn().mockReturnValue(true),
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await expect(generateCommand(mockLogger, options)).rejects.toMatchObject({
        code: ErrorCodes.GENERATION_FAILED,
        // Naming the feature is what makes the exit code actionable without
        // re-reading the whole log.
        message: expect.stringContaining("mcp"),
        details: { sourceLoadFailedFeatures: ["mcp"] },
      });
      expect(mockLogger.success).not.toHaveBeenCalled();
    });

    it("should not delete generated files when a rulesync source could not be loaded", async () => {
      // The run has no idea what it should have produced, so every generated
      // file would look like an orphan. Sweeping there deletes a working config
      // the run had no way to rewrite.
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
      mockConfig.getDelete.mockReturnValue(true);
      const removeOrphanMock = vi.fn().mockResolvedValue(1);
      vi.mocked(McpProcessor).mockImplementation(function () {
        return {
          hasRulesyncSourceLoadFailure: vi.fn().mockReturnValue(true),
          loadToolFiles: vi
            .fn()
            .mockResolvedValue([{ orphan: "file", getFilePath: () => "/path/to/orphan" }]),
          removeOrphanAiFiles: removeOrphanMock,
          loadRulesyncFiles: vi.fn().mockResolvedValue([]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      await expect(generateCommand(mockLogger, {})).rejects.toMatchObject({
        code: ErrorCodes.GENERATION_FAILED,
      });
      expect(removeOrphanMock).not.toHaveBeenCalled();
    });

    it("should keep watching when the initial run hits a source that could not be loaded", async () => {
      // A malformed source is an edit the user is about to correct, and saving
      // that correction is exactly what the watcher is here for. Only genuine
      // configuration errors should stop it before it starts.
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
      mockConfig.getConfigFilePath = vi.fn().mockReturnValue("/test/project/rulesync.jsonc");
      vi.mocked(McpProcessor).mockImplementation(function () {
        return {
          hasRulesyncSourceLoadFailure: vi.fn().mockReturnValue(true),
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
          loadRulesyncFiles: vi.fn().mockResolvedValue([]),
          convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      // The watcher blocks until it is interrupted, so stop it as soon as it
      // is up — reaching that point at all is what this test is asserting.
      vi.mocked(watchTargets).mockImplementation(() => {
        setTimeout(() => process.emit("SIGINT"), 0);
        return { close: vi.fn() } as any;
      });

      await expect(generateCommand(mockLogger, { watch: true })).resolves.toBeUndefined();

      expect(vi.mocked(watchTargets)).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("Still watching for changes...");
    });

    it("should succeed in check mode when no diff exists and delete is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getCheck.mockReturnValue(true);
      mockConfig.getDelete.mockReturnValue(true);

      const removeOrphanMock = vi.fn().mockResolvedValue(0);
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: removeOrphanMock,
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      // Orphan scan must run when delete is enabled, and report no diff.
      expect(removeOrphanMock).toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith("✓ All files are up to date.");
    });

    it("should succeed in check mode when no diff exists and delete is disabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getCheck.mockReturnValue(true);
      mockConfig.getDelete.mockReturnValue(false);

      const removeOrphanMock = vi.fn().mockResolvedValue(0);
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return {
          loadToolFiles: vi.fn().mockResolvedValue([]),
          removeOrphanAiFiles: removeOrphanMock,
          ...mockProcessorBase(),
          loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
          convertRulesyncFilesToToolFiles: vi
            .fn()
            .mockResolvedValue([{ tool: "converted", getFilePath: () => "/path/to/converted" }]),
          writeAiFiles: vi.fn().mockResolvedValue({ count: 0, paths: [] }),
        } as any;
      });

      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      // When delete is disabled, orphan removal must NOT run; the success log
      // still fires from the no-diff branch.
      expect(removeOrphanMock).not.toHaveBeenCalled();
      expect(mockLogger.success).toHaveBeenCalledWith("✓ All files are up to date.");
    });

    it("should handle multiple targets and base directories", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getOutputRoots.mockReturnValue(["dir1", "dir2"]);
      mockConfig.getTargets.mockReturnValue(["claudecode", "cursor"]);
      vi.mocked(intersection).mockReturnValue(["claudecode", "cursor"]);

      mockProcessorInstance.writeAiFiles.mockResolvedValue({ count: 1, paths: [] });
      const options: GenerateOptions = {};

      await generateCommand(mockLogger, options);

      // Should create processors for each combination of base dir and target
      expect(RulesProcessor).toHaveBeenCalledTimes(4); // 2 dirs × 2 targets
      // Total count is 4 (1 per processor)
      expect(mockLogger.success).toHaveBeenCalledWith("Written 4 rules");
      expect(mockLogger.success).toHaveBeenCalledWith(
        "🎉 All done! Written 4 file(s) total (4 rules)",
      );
    });
  });
});

describe("assertWatchModeCompatible", () => {
  it("accepts a plain watch run", () => {
    expect(() =>
      assertWatchModeCompatible({ isCheck: false, isDryRun: false, isJsonMode: false }),
    ).not.toThrow();
  });

  it.each([
    { params: { isCheck: true, isDryRun: false, isJsonMode: false }, expected: "--check" },
    { params: { isCheck: false, isDryRun: true, isJsonMode: false }, expected: "--dry-run" },
    { params: { isCheck: false, isDryRun: false, isJsonMode: true }, expected: "--json" },
  ])("rejects $expected", ({ params, expected }) => {
    try {
      assertWatchModeCompatible(params);
      expect.unreachable("assertWatchModeCompatible should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      expect((error as CLIError).code).toBe(ErrorCodes.VALIDATION_FAILED);
      expect((error as CLIError).message).toContain(expected);
    }
  });

  it("lists every conflicting flag", () => {
    expect(() =>
      assertWatchModeCompatible({ isCheck: true, isDryRun: true, isJsonMode: true }),
    ).toThrow("--watch cannot be combined with --check, --dry-run, --json.");
  });
});
