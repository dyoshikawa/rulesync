import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configResolver from "../../config/config-resolver.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { logger } from "../../utils/logger.js";
import { importCommand } from "./import.js";

vi.mock("../../config/config-resolver.js");
vi.mock("../../utils/logger.js");
vi.mock("../../commands/commands-processor.js");
vi.mock("../../ignore/ignore-processor.js");
vi.mock("../../rules/rules-processor.js");
vi.mock("../../subagents/subagents-processor.js");

describe("importCommand", () => {
  let _testDir: string;
  let cleanup: () => Promise<void>;
  let mockConfig: any;
  let mockProcessor: any;

  beforeEach(async () => {
    ({ testDir: _testDir, cleanup } = await setupTestDirectory());

    mockProcessor = {
      loadToolFiles: vi
        .fn()
        .mockResolvedValue([{ filePath: "test.md", content: "existing content" }]),
      convertToolFilesToRulesyncFiles: vi
        .fn()
        .mockResolvedValue([
          { filePath: ".rulesync/rules/imported.md", content: "imported content" },
        ]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    };

    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getTargets: vi.fn().mockReturnValue(["cursor"]),
      getFeatures: vi.fn().mockReturnValue(["rules", "ignore", "mcp", "commands", "subagents"]),
    };

    vi.mocked(configResolver.ConfigResolver.resolve).mockResolvedValue(mockConfig);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("should exit with error when no targets provided", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await importCommand({});

      expect(logger.error).toHaveBeenCalledWith("No tools found in --targets");
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it("should exit with error when multiple targets provided", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await importCommand({ targets: ["cursor", "copilot"] });

      expect(logger.error).toHaveBeenCalledWith("Only one tool can be imported at a time");
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe("rules import", () => {
    it("should import rules when rules feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      // Mock RulesProcessor
      const { RulesProcessor } = await import("../../rules/rules-processor.js");
      vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should show verbose output for rules when enabled", async () => {
      mockConfig.getVerbose.mockReturnValue(true);
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const { RulesProcessor } = await import("../../rules/rules-processor.js");
      vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(logger.success).toHaveBeenCalledWith("Created 1 rule files");
    });

    it("should skip rules import when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockProcessor.loadToolFiles.mockResolvedValue([]);

      const { RulesProcessor } = await import("../../rules/rules-processor.js");
      vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).not.toHaveBeenCalled();
    });
  });

  describe("ignore import", () => {
    it("should import ignore files when ignore feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const { IgnoreProcessor } = await import("../../ignore/ignore-processor.js");
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should show verbose output for ignore files when enabled", async () => {
      mockConfig.getVerbose.mockReturnValue(true);
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const { IgnoreProcessor } = await import("../../ignore/ignore-processor.js");
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(logger.success).toHaveBeenCalledWith(
        "Created ignore files from 1 tool ignore configurations",
      );
      expect(logger.success).toHaveBeenCalledWith("Created 1 ignore files");
    });
  });

  describe("subagents import", () => {
    it("should import subagent files when subagents feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      const { SubagentsProcessor } = await import("../../subagents/subagents-processor.js");
      vi.mocked(SubagentsProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).toHaveBeenCalled();
    });
  });

  describe("commands import", () => {
    it("should import command files when commands feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const { CommandsProcessor } = await import("../../commands/commands-processor.js");
      vi.mocked(CommandsProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.loadToolFiles).toHaveBeenCalled();
      expect(mockProcessor.convertToolFilesToRulesyncFiles).toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).toHaveBeenCalled();
    });

    it("should handle commands processor with proper target checking", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const { CommandsProcessor } = await import("../../commands/commands-processor.js");
      const mockGetToolTargets = vi.fn().mockReturnValue(["claudecode", "geminicli"]);
      vi.mocked(CommandsProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(CommandsProcessor.getToolTargets).mockImplementation(mockGetToolTargets);

      await importCommand({ targets: ["cursor"] });

      // Should not call processor methods since cursor is not in supported targets
      expect(mockProcessor.loadToolFiles).not.toHaveBeenCalled();
    });
  });

  describe("feature combinations", () => {
    it("should process multiple features when enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "ignore"]);

      const { RulesProcessor } = await import("../../rules/rules-processor.js");
      const { IgnoreProcessor } = await import("../../ignore/ignore-processor.js");

      vi.mocked(RulesProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor"]);
      vi.mocked(IgnoreProcessor).mockImplementation(() => mockProcessor as any);
      vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor"]);

      await importCommand({ targets: ["cursor"] });

      // Should be called twice - once for rules, once for ignore
      expect(mockProcessor.loadToolFiles).toHaveBeenCalledTimes(2);
    });

    it("should skip features not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      await importCommand({ targets: ["cursor"] });

      expect(mockProcessor.loadToolFiles).not.toHaveBeenCalled();
    });
  });

  describe("logger verbosity", () => {
    it("should set logger verbosity based on config", async () => {
      mockConfig.getVerbose.mockReturnValue(true);

      await importCommand({ targets: ["cursor"] });

      expect(logger.setVerbose).toHaveBeenCalledWith(true);
    });
  });
});
