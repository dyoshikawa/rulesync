import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { logger } from "../utils/logger.js";
import { importFromTool } from "./import.js";

vi.mock("../features/rules/rules-processor.js");
vi.mock("../features/ignore/ignore-processor.js");
vi.mock("../features/mcp/mcp-processor.js");
vi.mock("../features/subagents/subagents-processor.js");
vi.mock("../features/commands/commands-processor.js");
vi.mock("../features/skills/skills-processor.js");
vi.mock("../features/hooks/hooks-processor.js");
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

describe("importFromTool", () => {
  let mockConfig: {
    getVerbose: ReturnType<typeof vi.fn>;
    getSilent: ReturnType<typeof vi.fn>;
    getBaseDirs: ReturnType<typeof vi.fn>;
    getFeatures: ReturnType<typeof vi.fn>;
    getGlobal: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getSilent: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue(["."]),
      getFeatures: vi.fn().mockReturnValue(["rules"]),
      getGlobal: vi.fn().mockReturnValue(false),
    };

    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SkillsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(HooksProcessor.getToolTargets).mockReturnValue(["claudecode"]);

    const createMockProcessor = () => ({
      loadToolFiles: vi.fn().mockResolvedValue([{ file: "tool" }]),
      convertToolFilesToRulesyncFiles: vi.fn().mockResolvedValue([{ file: "rulesync" }]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    });

    const createMockSkillsProcessor = () => ({
      loadToolDirs: vi.fn().mockResolvedValue([{ dir: "tool" }]),
      convertToolDirsToRulesyncDirs: vi.fn().mockResolvedValue([{ dir: "rulesync" }]),
      writeAiDirs: vi.fn().mockResolvedValue(1),
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rules feature", () => {
    it("should import rules when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(1);
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 rules when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(0);
      expect(RulesProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 rules when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(0);
      expect(RulesProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockProcessor as unknown as RulesProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(0);
      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).not.toHaveBeenCalled();
    });
  });

  describe("ignore feature", () => {
    it("should import ignore files when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.ignoreCount).toBe(1);
      expect(IgnoreProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
      });
    });

    it("should return 0 ignore files when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should skip ignore import in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      mockConfig.getGlobal.mockReturnValue(true);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        return mockProcessor as unknown as IgnoreProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.ignoreCount).toBe(0);
      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
    });
  });

  describe("mcp feature", () => {
    it("should import MCP files when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.mcpCount).toBe(1);
      expect(McpProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 MCP files when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.mcpCount).toBe(0);
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
      vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.mcpCount).toBe(0);
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(McpProcessor).mockImplementation(function () {
        return mockProcessor as unknown as McpProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.mcpCount).toBe(0);
      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
    });
  });

  describe("commands feature", () => {
    it("should import commands when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.commandsCount).toBe(1);
      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 commands when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.commandsCount).toBe(0);
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });

    it("should call getToolTargets with includeSimulated: false", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: false,
      });
    });

    it("should return 0 when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);
      vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.commandsCount).toBe(0);
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(CommandsProcessor).mockImplementation(function () {
        return mockProcessor as unknown as CommandsProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.commandsCount).toBe(0);
      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
    });
  });

  describe("subagents feature", () => {
    it("should import subagents when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.subagentsCount).toBe(1);
      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 subagents when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.subagentsCount).toBe(0);
      expect(SubagentsProcessor).not.toHaveBeenCalled();
    });

    it("should call getToolTargets with includeSimulated: false", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: false,
      });
    });

    it("should return 0 when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);
      vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.subagentsCount).toBe(0);
      expect(SubagentsProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        convertToolFilesToRulesyncFiles: vi.fn(),
        writeAiFiles: vi.fn(),
      };
      vi.mocked(SubagentsProcessor).mockImplementation(function () {
        return mockProcessor as unknown as SubagentsProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.subagentsCount).toBe(0);
      expect(mockProcessor.convertToolFilesToRulesyncFiles).not.toHaveBeenCalled();
    });
  });

  describe("skills feature", () => {
    it("should import skills when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.skillsCount).toBe(1);
      expect(SkillsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 skills when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.skillsCount).toBe(0);
      expect(SkillsProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when tool is not supported", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);
      vi.mocked(SkillsProcessor.getToolTargets).mockReturnValue(["cursor"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.skillsCount).toBe(0);
      expect(SkillsProcessor).not.toHaveBeenCalled();
    });

    it("should return 0 when no tool dirs found", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const mockProcessor = {
        loadToolDirs: vi.fn().mockResolvedValue([]),
        convertToolDirsToRulesyncDirs: vi.fn(),
        writeAiDirs: vi.fn(),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockProcessor as unknown as SkillsProcessor;
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.skillsCount).toBe(0);
      expect(mockProcessor.convertToolDirsToRulesyncDirs).not.toHaveBeenCalled();
    });
  });

  describe("hooks feature", () => {
    it("should warn and return 0 when tool is not importable (e.g. opencode)", async () => {
      mockConfig.getFeatures.mockReturnValue(["hooks"]);
      // opencode is in allTargets but not in importableTargets
      vi.mocked(HooksProcessor.getToolTargets).mockImplementation((opts) => {
        if (opts && "importOnly" in opts && opts.importOnly) {
          return ["cursor", "claudecode"];
        }
        return ["cursor", "claudecode", "opencode"];
      });

      const result = await importFromTool({ config: mockConfig as never, tool: "opencode" });

      expect(result.hooksCount).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Import is not supported for opencode hooks"),
      );
    });

    it("should import hooks when feature is enabled and tool is importable", async () => {
      mockConfig.getFeatures.mockReturnValue(["hooks"]);
      vi.mocked(HooksProcessor.getToolTargets).mockReturnValue(["claudecode"]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.hooksCount).toBe(1);
      expect(HooksProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
      });
    });

    it("should return 0 hooks when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.hooksCount).toBe(0);
    });
  });

  describe("all features combined", () => {
    it("should import all features when all are enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([
        "rules",
        "ignore",
        "mcp",
        "commands",
        "subagents",
        "skills",
      ]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(1);
      expect(result.ignoreCount).toBe(1);
      expect(result.mcpCount).toBe(1);
      expect(result.commandsCount).toBe(1);
      expect(result.subagentsCount).toBe(1);
      expect(result.skillsCount).toBe(1);
      expect(result.hooksCount).toBe(0);
    });

    it("should return empty result when no features are enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(result.rulesCount).toBe(0);
      expect(result.ignoreCount).toBe(0);
      expect(result.mcpCount).toBe(0);
      expect(result.commandsCount).toBe(0);
      expect(result.subagentsCount).toBe(0);
      expect(result.skillsCount).toBe(0);
      expect(result.hooksCount).toBe(0);
    });
  });

  describe("global mode", () => {
    beforeEach(() => {
      mockConfig.getGlobal.mockReturnValue(true);
    });

    it("should pass global flag to processors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          global: true,
        }),
      );
    });

    it("should use getToolTargets with global: true", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(RulesProcessor.getToolTargets).toHaveBeenCalledWith({ global: true });
    });
  });

  describe("baseDir handling", () => {
    it("should use first baseDir from config", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["/custom/path", "/other/path"]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: "/custom/path",
        }),
      );
    });

    it("should fall back to '.' when baseDirs is empty", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue([]);

      await importFromTool({ config: mockConfig as never, tool: "claudecode" });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: ".",
        }),
      );
    });
  });
});
