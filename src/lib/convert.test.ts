import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { createMockLogger } from "../test-utils/mock-logger.js";
import { convertFromTool } from "./convert.js";

const logger = createMockLogger();

vi.mock("../features/rules/rules-processor.js");
vi.mock("../features/ignore/ignore-processor.js");
vi.mock("../features/mcp/mcp-processor.js");
vi.mock("../features/subagents/subagents-processor.js");
vi.mock("../features/commands/commands-processor.js");
vi.mock("../features/skills/skills-processor.js");
vi.mock("../features/hooks/hooks-processor.js");
vi.mock("../features/permissions/permissions-processor.js");

describe("convertFromTool", () => {
  let mockConfig: {
    getVerbose: ReturnType<typeof vi.fn>;
    getSilent: ReturnType<typeof vi.fn>;
    getOutputRoots: ReturnType<typeof vi.fn>;
    getFeatures: ReturnType<typeof vi.fn>;
    getFeatureOptions: ReturnType<typeof vi.fn>;
    getGlobal: ReturnType<typeof vi.fn>;
    getDryRun: ReturnType<typeof vi.fn>;
    isPreviewMode: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getSilent: vi.fn().mockReturnValue(false),
      getOutputRoots: vi.fn().mockReturnValue(["."]),
      getFeatures: vi.fn().mockReturnValue(["rules"]),
      getFeatureOptions: vi.fn().mockReturnValue(undefined),
      getGlobal: vi.fn().mockReturnValue(false),
      getDryRun: vi.fn().mockReturnValue(false),
      isPreviewMode: vi.fn().mockReturnValue(false),
    };

    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode", "copilot"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode", "copilot"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode", "copilot"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode"]);
    vi.mocked(SkillsProcessor.getToolTargets).mockReturnValue(["claudecode", "cursor"]);
    vi.mocked(HooksProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(PermissionsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

    const createMockProcessor = () => ({
      loadToolFiles: vi.fn().mockResolvedValue([{ file: "tool" }]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ file: "rulesync" }]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ file: "dest-tool" }]),
      writeAiFiles: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
    });

    const createMockSkillsProcessor = () => ({
      loadToolDirs: vi.fn().mockResolvedValue([{ dir: "tool" }]),
      convertToolDirsToRulesyncDirs: vi.fn().mockResolvedValue([{ dir: "rulesync" }]),
      convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([{ dir: "dest-tool" }]),
      writeAiDirs: vi.fn().mockResolvedValue({ count: 1, paths: [] }),
    });

    vi.mocked(RulesProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as RulesProcessor;
    });
    vi.mocked(IgnoreProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as IgnoreProcessor;
    });
    vi.mocked(McpProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as McpProcessor;
    });
    vi.mocked(SubagentsProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as SubagentsProcessor;
    });
    vi.mocked(CommandsProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as CommandsProcessor;
    });
    vi.mocked(SkillsProcessor).mockImplementation(function () {
      return createMockSkillsProcessor() as unknown as SkillsProcessor;
    });
    vi.mocked(HooksProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as HooksProcessor;
    });
    vi.mocked(PermissionsProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as PermissionsProcessor;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rules feature", () => {
    it("should convert rules from source to destinations", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode", "copilot"],
      });

      // One write per destination
      expect(result.rulesCount).toBe(2);
      // Instantiated once for source + once per destination
      expect(RulesProcessor).toHaveBeenCalledTimes(3);
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "cursor" }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "claudecode" }),
      );
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "copilot" }),
      );
    });

    it("should return 0 when feature not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.rulesCount).toBe(0);
      expect(RulesProcessor).not.toHaveBeenCalled();
    });

    it("should skip when source tool is unsupported", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.rulesCount).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Source tool 'cursor' does not support feature 'rules'"),
      );
    });

    it("should skip unsupported destinations with a warning", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor", "claudecode"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode", "copilot"],
      });

      expect(result.rulesCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Destination tool 'copilot' does not support feature 'rules'"),
      );
    });

    it("should return 0 when source has no tool files", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const mockProc = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        convertRulesyncFilesToToolFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockProc as unknown as RulesProcessor;
      });

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.rulesCount).toBe(0);
      expect(mockProc.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
    });
  });

  describe("ignore feature", () => {
    it("should skip ignore in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      mockConfig.getGlobal.mockReturnValue(true);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should convert ignore files from source to destination", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.ignoreCount).toBe(1);
    });
  });

  describe("mcp feature", () => {
    it("should convert mcp from source to multiple destinations", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode", "copilot"],
      });

      expect(result.mcpCount).toBe(2);
    });
  });

  describe("commands feature", () => {
    it("should convert commands excluding simulated targets", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.commandsCount).toBe(1);
      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: false,
      });
    });
  });

  describe("skills feature", () => {
    it("should convert skill directories", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.skillsCount).toBe(1);
    });

    it("should return 0 when source has no skill dirs", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const mockProc = {
        loadToolDirs: vi.fn().mockResolvedValue([]),
        convertToolDirsToRulesyncDirs: vi.fn(),
        convertRulesyncDirsToToolDirs: vi.fn(),
        writeAiDirs: vi.fn(),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockProc as unknown as SkillsProcessor;
      });

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.skillsCount).toBe(0);
      expect(mockProc.convertToolDirsToRulesyncDirs).not.toHaveBeenCalled();
    });
  });

  describe("hooks feature", () => {
    it("should warn and skip when source tool is not importable", async () => {
      mockConfig.getFeatures.mockReturnValue(["hooks"]);
      vi.mocked(HooksProcessor.getToolTargets).mockImplementation((opts) => {
        if (opts && "importOnly" in opts && opts.importOnly) {
          return ["claudecode"];
        }
        return ["claudecode", "opencode"];
      });

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "opencode",
        toTools: ["claudecode"],
      });

      expect(result.hooksCount).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Conversion from opencode hooks is not supported"),
      );
    });
  });

  describe("permissions feature", () => {
    it("should convert permissions when source is importable", async () => {
      mockConfig.getFeatures.mockReturnValue(["permissions"]);
      vi.mocked(PermissionsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "claudecode",
        toTools: ["claudecode"],
      });

      expect(result.permissionsCount).toBe(1);
    });
  });

  describe("dryRun propagation", () => {
    it("should forward preview mode from config to destination processors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.isPreviewMode.mockReturnValue(true);

      await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "claudecode", dryRun: true }),
      );
      // Source processor must never run in dry-run mode — it only reads
      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({ toolTarget: "cursor", dryRun: false }),
      );
    });
  });

  describe("global mode", () => {
    it("should pass global flag to processors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getGlobal.mockReturnValue(true);

      await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(RulesProcessor).toHaveBeenCalledWith(expect.objectContaining({ global: true }));
      expect(RulesProcessor.getToolTargets).toHaveBeenCalledWith({ global: true });
    });
  });

  describe("outputRoot handling", () => {
    it("should fall back to '.' when outputRoots is empty", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getOutputRoots.mockReturnValue([]);

      await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(RulesProcessor).toHaveBeenCalledWith(expect.objectContaining({ outputRoot: "." }));
    });
  });

  describe("all features combined", () => {
    it("should return empty result when no features are enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await convertFromTool({
        logger,
        config: mockConfig as never,
        fromTool: "cursor",
        toTools: ["claudecode"],
      });

      expect(result.rulesCount).toBe(0);
      expect(result.ignoreCount).toBe(0);
      expect(result.mcpCount).toBe(0);
      expect(result.commandsCount).toBe(0);
      expect(result.subagentsCount).toBe(0);
      expect(result.skillsCount).toBe(0);
      expect(result.hooksCount).toBe(0);
      expect(result.permissionsCount).toBe(0);
    });
  });
});
