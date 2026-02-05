import { intersection } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { fileExists } from "../utils/file.js";
import { checkRulesyncDirExists, generate } from "./generate.js";

vi.mock("../features/rules/rules-processor.js");
vi.mock("../features/ignore/ignore-processor.js");
vi.mock("../features/mcp/mcp-processor.js");
vi.mock("../features/subagents/subagents-processor.js");
vi.mock("../features/commands/commands-processor.js");
vi.mock("../features/hooks/hooks-processor.js");
vi.mock("../features/skills/skills-processor.js");
vi.mock("../utils/file.js");
vi.mock("es-toolkit", () => ({
  intersection: vi.fn(),
}));

describe("checkRulesyncDirExists", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return true when .rulesync directory exists", async () => {
    vi.mocked(fileExists).mockResolvedValue(true);

    const result = await checkRulesyncDirExists({ baseDir: "/project" });

    expect(result).toBe(true);
    expect(fileExists).toHaveBeenCalledWith("/project/.rulesync");
  });

  it("should return false when .rulesync directory does not exist", async () => {
    vi.mocked(fileExists).mockResolvedValue(false);

    const result = await checkRulesyncDirExists({ baseDir: "/project" });

    expect(result).toBe(false);
    expect(fileExists).toHaveBeenCalledWith("/project/.rulesync");
  });
});

describe("generate", () => {
  let mockConfig: {
    getVerbose: ReturnType<typeof vi.fn>;
    getSilent: ReturnType<typeof vi.fn>;
    getBaseDirs: ReturnType<typeof vi.fn>;
    getTargets: ReturnType<typeof vi.fn>;
    getFeatures: ReturnType<typeof vi.fn>;
    getDelete: ReturnType<typeof vi.fn>;
    getGlobal: ReturnType<typeof vi.fn>;
    getSimulateCommands: ReturnType<typeof vi.fn>;
    getSimulateSubagents: ReturnType<typeof vi.fn>;
    getSimulateSkills: ReturnType<typeof vi.fn>;
    getModularMcp: ReturnType<typeof vi.fn>;
    isPreviewMode: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConfig = {
      getVerbose: vi.fn().mockReturnValue(false),
      getSilent: vi.fn().mockReturnValue(false),
      getBaseDirs: vi.fn().mockReturnValue(["."]),
      getTargets: vi.fn().mockReturnValue(["claudecode"]),
      getFeatures: vi.fn().mockReturnValue(["rules"]),
      getDelete: vi.fn().mockReturnValue(false),
      getGlobal: vi.fn().mockReturnValue(false),
      getSimulateCommands: vi.fn().mockReturnValue(false),
      getSimulateSubagents: vi.fn().mockReturnValue(false),
      getSimulateSkills: vi.fn().mockReturnValue(false),
      getModularMcp: vi.fn().mockReturnValue(false),
      isPreviewMode: vi.fn().mockReturnValue(false),
    };

    vi.mocked(intersection).mockImplementation((a, b) => a.filter((item) => b.includes(item)));

    vi.mocked(RulesProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(IgnoreProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(McpProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SubagentsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(CommandsProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(HooksProcessor.getToolTargets).mockReturnValue(["claudecode"]);
    vi.mocked(SkillsProcessor.getToolTargets).mockReturnValue(["claudecode"]);

    const createMockProcessor = () => ({
      loadToolFiles: vi.fn().mockResolvedValue([]),
      removeAiFiles: vi.fn().mockResolvedValue(undefined),
      loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
      convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([{ tool: "converted" }]),
      writeAiFiles: vi.fn().mockResolvedValue(1),
    });

    const createMockSkillsProcessor = () => ({
      loadToolDirsToDelete: vi.fn().mockResolvedValue([]),
      removeAiDirs: vi.fn().mockResolvedValue(undefined),
      loadRulesyncDirs: vi.fn().mockResolvedValue([]),
      convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([]),
      writeAiDirs: vi.fn().mockResolvedValue(0),
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
    vi.mocked(HooksProcessor).mockImplementation(function () {
      return createMockProcessor() as unknown as HooksProcessor;
    });
    vi.mocked(SkillsProcessor).mockImplementation(function () {
      return createMockSkillsProcessor() as unknown as SkillsProcessor;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rules feature", () => {
    it("should generate rules when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.rulesCount).toBe(1);
      expect(RulesProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false,
        skills: [],
        dryRun: false,
      });
    });

    it("should return 0 rules when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.rulesCount).toBe(0);
      expect(RulesProcessor).not.toHaveBeenCalled();
    });

    it("should pass skills to RulesProcessor", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules", "skills"]);

      const mockSkill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/test",
        dirName: "test",
        frontmatter: { name: "test-skill", targets: ["*"], description: "Test skill" },
        body: "Test skill body",
      });
      const mockSkillsProcessor = {
        loadToolDirsToDelete: vi.fn().mockResolvedValue([]),
        removeAiDirs: vi.fn().mockResolvedValue(undefined),
        loadRulesyncDirs: vi.fn().mockResolvedValue([mockSkill]),
        convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([]),
        writeAiDirs: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockSkillsProcessor as unknown as SkillsProcessor;
      });

      await generate({ config: mockConfig as never });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: [mockSkill],
        }),
      );
    });

    it("should remove orphan files when delete option is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getDelete.mockReturnValue(true);

      const existingFiles = [{ file: "existing", getFilePath: () => "/path/to/existing" }];
      const generatedFiles = [{ tool: "converted", getFilePath: () => "/path/to/converted" }];
      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue(existingFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue(generatedFiles),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockProcessor as unknown as RulesProcessor;
      });

      await generate({ config: mockConfig as never });

      expect(mockProcessor.loadToolFiles).toHaveBeenCalledWith({ forDeletion: true });
      expect(mockProcessor.removeOrphanAiFiles).toHaveBeenCalledWith(existingFiles, generatedFiles);
    });

    it("should not delete files that are regenerated (only orphans)", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getDelete.mockReturnValue(true);

      // Same file path for both existing and generated - should not be deleted
      const samePath = "/path/to/file";
      const existingFiles = [{ file: "existing", getFilePath: () => samePath }];
      const generatedFiles = [{ tool: "converted", getFilePath: () => samePath }];
      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue(existingFiles),
        removeOrphanAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([{ file: "test" }]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue(generatedFiles),
        writeAiFiles: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(RulesProcessor).mockImplementation(function () {
        return mockProcessor as unknown as RulesProcessor;
      });

      await generate({ config: mockConfig as never });

      // removeOrphanAiFiles is called with both lists, the actual filtering happens inside
      expect(mockProcessor.removeOrphanAiFiles).toHaveBeenCalledWith(existingFiles, generatedFiles);
      // Verify writeAiFiles was called first (files are generated before orphan removal)
      const writeCall = mockProcessor.writeAiFiles.mock.invocationCallOrder[0] ?? 0;
      const removeCall = mockProcessor.removeOrphanAiFiles.mock.invocationCallOrder[0] ?? 0;
      expect(writeCall).toBeLessThan(removeCall);
    });

    it("should process multiple base directories", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);
      mockConfig.getBaseDirs.mockReturnValue(["dir1", "dir2"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.rulesCount).toBe(2);
      expect(RulesProcessor).toHaveBeenCalledTimes(2);
      expect(RulesProcessor).toHaveBeenCalledWith(expect.objectContaining({ baseDir: "dir1" }));
      expect(RulesProcessor).toHaveBeenCalledWith(expect.objectContaining({ baseDir: "dir2" }));
    });
  });

  describe("ignore feature", () => {
    it("should generate ignore files when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.ignoreCount).toBe(1);
      expect(IgnoreProcessor).toHaveBeenCalled();
    });

    it("should return 0 ignore files when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should skip ignore generation in global mode", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      mockConfig.getGlobal.mockReturnValue(true);

      const result = await generate({ config: mockConfig as never });

      expect(result.ignoreCount).toBe(0);
      expect(IgnoreProcessor).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully and continue", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        throw new Error("Test error");
      });

      const result = await generate({ config: mockConfig as never });

      expect(result.ignoreCount).toBe(0);
    });

    it("should skip writing when no rulesync files found", async () => {
      mockConfig.getFeatures.mockReturnValue(["ignore"]);

      const mockProcessor = {
        loadToolFiles: vi.fn().mockResolvedValue([]),
        removeAiFiles: vi.fn().mockResolvedValue(undefined),
        loadRulesyncFiles: vi.fn().mockResolvedValue([]),
        convertRulesyncFilesToToolFiles: vi.fn().mockResolvedValue([]),
        writeAiFiles: vi.fn().mockResolvedValue(0),
      };
      vi.mocked(IgnoreProcessor).mockImplementation(function () {
        return mockProcessor as unknown as IgnoreProcessor;
      });

      const result = await generate({ config: mockConfig as never });

      expect(result.ignoreCount).toBe(0);
      expect(mockProcessor.convertRulesyncFilesToToolFiles).not.toHaveBeenCalled();
      expect(mockProcessor.writeAiFiles).not.toHaveBeenCalled();
    });
  });

  describe("mcp feature", () => {
    it("should generate MCP files when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.mcpCount).toBe(1);
      expect(McpProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        modularMcp: false,
        dryRun: false,
      });
    });

    it("should return 0 MCP files when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.mcpCount).toBe(0);
      expect(McpProcessor).not.toHaveBeenCalled();
    });

    it("should pass modularMcp option to processor", async () => {
      mockConfig.getFeatures.mockReturnValue(["mcp"]);
      mockConfig.getModularMcp.mockReturnValue(true);

      await generate({ config: mockConfig as never });

      expect(McpProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          modularMcp: true,
        }),
      );
    });
  });

  describe("commands feature", () => {
    it("should generate commands when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.commandsCount).toBe(1);
      expect(CommandsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should return 0 commands when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.commandsCount).toBe(0);
      expect(CommandsProcessor).not.toHaveBeenCalled();
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getFeatures.mockReturnValue(["commands"]);
      mockConfig.getSimulateCommands.mockReturnValue(true);

      await generate({ config: mockConfig as never });

      expect(CommandsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: true,
      });
    });
  });

  describe("subagents feature", () => {
    it("should generate subagents when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);

      const result = await generate({ config: mockConfig as never });

      expect(result.subagentsCount).toBe(1);
      expect(SubagentsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should return 0 subagents when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.subagentsCount).toBe(0);
      expect(SubagentsProcessor).not.toHaveBeenCalled();
    });

    it("should pass includeSimulated flag to getToolTargets", async () => {
      mockConfig.getFeatures.mockReturnValue(["subagents"]);
      mockConfig.getSimulateSubagents.mockReturnValue(true);

      await generate({ config: mockConfig as never });

      expect(SubagentsProcessor.getToolTargets).toHaveBeenCalledWith({
        global: false,
        includeSimulated: true,
      });
    });
  });

  describe("skills feature", () => {
    it("should generate skills when feature is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const mockSkillsProcessor = {
        loadToolDirsToDelete: vi.fn().mockResolvedValue([]),
        removeAiDirs: vi.fn().mockResolvedValue(undefined),
        loadRulesyncDirs: vi.fn().mockResolvedValue([]),
        convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([{ dir: "skill" }]),
        writeAiDirs: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockSkillsProcessor as unknown as SkillsProcessor;
      });

      const result = await generate({ config: mockConfig as never });

      expect(result.skillsCount).toBe(1);
      expect(SkillsProcessor).toHaveBeenCalledWith({
        baseDir: ".",
        toolTarget: "claudecode",
        global: false,
        dryRun: false,
      });
    });

    it("should return 0 skills when feature is not enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.skillsCount).toBe(0);
      expect(result.skills).toEqual([]);
      expect(SkillsProcessor).not.toHaveBeenCalled();
    });

    it("should collect RulesyncSkill instances", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);

      const mockSkill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/test",
        dirName: "test",
        frontmatter: { name: "test-skill", targets: ["*"], description: "Test skill" },
        body: "Test skill body",
      });
      const mockSkillsProcessor = {
        loadToolDirsToDelete: vi.fn().mockResolvedValue([]),
        removeAiDirs: vi.fn().mockResolvedValue(undefined),
        loadRulesyncDirs: vi.fn().mockResolvedValue([mockSkill]),
        convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([]),
        writeAiDirs: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockSkillsProcessor as unknown as SkillsProcessor;
      });

      const result = await generate({ config: mockConfig as never });

      expect(result.skills).toContain(mockSkill);
    });

    it("should remove orphan skill dirs when delete option is enabled", async () => {
      mockConfig.getFeatures.mockReturnValue(["skills"]);
      mockConfig.getDelete.mockReturnValue(true);

      const existingDirs = [{ dir: "existing-skill", getDirPath: () => "/path/to/existing" }];
      const generatedDirs = [{ dir: "generated-skill", getDirPath: () => "/path/to/generated" }];
      const mockSkillsProcessor = {
        loadToolDirsToDelete: vi.fn().mockResolvedValue(existingDirs),
        removeOrphanAiDirs: vi.fn().mockResolvedValue(undefined),
        loadRulesyncDirs: vi.fn().mockResolvedValue([]),
        convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue(generatedDirs),
        writeAiDirs: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockSkillsProcessor as unknown as SkillsProcessor;
      });

      await generate({ config: mockConfig as never });

      expect(mockSkillsProcessor.loadToolDirsToDelete).toHaveBeenCalled();
      expect(mockSkillsProcessor.removeOrphanAiDirs).toHaveBeenCalledWith(
        existingDirs,
        generatedDirs,
      );
      // Verify writeAiDirs was called first (dirs are generated before orphan removal)
      const writeCall = mockSkillsProcessor.writeAiDirs.mock.invocationCallOrder[0] ?? 0;
      const removeCall = mockSkillsProcessor.removeOrphanAiDirs.mock.invocationCallOrder[0] ?? 0;
      expect(writeCall).toBeLessThan(removeCall);
    });
  });

  describe("all features combined", () => {
    it("should generate all features when all are enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([
        "rules",
        "ignore",
        "mcp",
        "commands",
        "subagents",
        "skills",
        "hooks",
      ]);

      const mockSkillsProcessor = {
        loadToolDirsToDelete: vi.fn().mockResolvedValue([]),
        removeAiDirs: vi.fn().mockResolvedValue(undefined),
        loadRulesyncDirs: vi.fn().mockResolvedValue([]),
        convertRulesyncDirsToToolDirs: vi.fn().mockResolvedValue([]),
        writeAiDirs: vi.fn().mockResolvedValue(1),
      };
      vi.mocked(SkillsProcessor).mockImplementation(function () {
        return mockSkillsProcessor as unknown as SkillsProcessor;
      });

      const result = await generate({ config: mockConfig as never });

      expect(result.rulesCount).toBe(1);
      expect(result.ignoreCount).toBe(1);
      expect(result.mcpCount).toBe(1);
      expect(result.commandsCount).toBe(1);
      expect(result.subagentsCount).toBe(1);
      expect(result.skillsCount).toBe(1);
      expect(result.hooksCount).toBe(1);
    });

    it("should return empty result when no features are enabled", async () => {
      mockConfig.getFeatures.mockReturnValue([]);

      const result = await generate({ config: mockConfig as never });

      expect(result.rulesCount).toBe(0);
      expect(result.ignoreCount).toBe(0);
      expect(result.mcpCount).toBe(0);
      expect(result.commandsCount).toBe(0);
      expect(result.subagentsCount).toBe(0);
      expect(result.skillsCount).toBe(0);
      expect(result.hooksCount).toBe(0);
      expect(result.skills).toEqual([]);
    });
  });

  describe("global mode", () => {
    beforeEach(() => {
      mockConfig.getGlobal.mockReturnValue(true);
    });

    it("should pass global flag to processors", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await generate({ config: mockConfig as never });

      expect(RulesProcessor).toHaveBeenCalledWith(
        expect.objectContaining({
          global: true,
        }),
      );
    });

    it("should use getToolTargets with global: true", async () => {
      mockConfig.getFeatures.mockReturnValue(["rules"]);

      await generate({ config: mockConfig as never });

      expect(RulesProcessor.getToolTargets).toHaveBeenCalledWith({ global: true });
    });
  });
});
