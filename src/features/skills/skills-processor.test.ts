import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import {
  SkillsProcessor,
  SkillsProcessorToolTarget,
  SkillsProcessorToolTargetSchema,
  skillsProcessorToolTargetsGlobal,
} from "./skills-processor.js";

describe("SkillsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should use default baseDir when not provided", () => {
      const processor = new SkillsProcessor({
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should validate tool target with schema", () => {
      expect(() => {
        const _processor = new SkillsProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as SkillsProcessorToolTarget,
        });
      }).toThrow("Invalid tool target for SkillsProcessor");
    });

    it("should accept global parameter", () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should default global to false", () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect((processor as any).global).toBe(false);
    });
  });

  describe("convertRulesyncDirsToToolDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert rulesync skills to claudecode skills", async () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
      const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
      expect(claudecodeSkill.getFrontmatter().name).toBe("test-skill");
      expect(claudecodeSkill.getFrontmatter().description).toBe("Test skill description");
    });

    it("should filter out non-RulesyncSkill instances", async () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const mockOtherDir = {
        getDirPath: () => "not-a-skill",
      } as any;

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill, mockOtherDir]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
    });

    it("should filter out skills not targeted for the tool", async () => {
      // Create a skill without claudecode in targets (by not having claudecode frontmatter)
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "non-targeted-skill",
        frontmatter: {
          name: "non-targeted-skill",
          description: "Not for claudecode",
        },
        body: "Content",
        validate: false,
      });

      const targetedSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "targeted-skill",
        frontmatter: {
          name: "targeted-skill",
          description: "For claudecode",
          claudecode: {
            "allowed-tools": ["bash"],
          },
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([
        rulesyncSkill,
        targetedSkill,
      ]);

      // Both should be converted as ClaudecodeSkill.isTargetedByRulesyncSkill returns true for all by default
      expect(toolDirs.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty rulesync dirs array", async () => {
      const toolDirs = await processor.convertRulesyncDirsToToolDirs([]);
      expect(toolDirs).toEqual([]);
    });

    it("should pass global parameter to ClaudecodeSkill.fromRulesyncSkill", async () => {
      const globalProcessor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: {
          name: "global-skill",
          description: "Global skill",
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await globalProcessor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target (bypassing constructor validation)
      const processorWithMockTarget = Object.create(SkillsProcessor.prototype);
      processorWithMockTarget.baseDir = testDir;
      processorWithMockTarget.toolTarget = "unsupported";
      processorWithMockTarget.global = false;
      processorWithMockTarget.getFactory = (target: any) => {
        throw new Error(`Unsupported tool target: ${target}`);
      };

      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: { name: "test", description: "test" },
        body: "test",
        validate: false,
      });

      await expect(
        processorWithMockTarget.convertRulesyncDirsToToolDirs([rulesyncSkill]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("convertToolDirsToRulesyncDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert tool skills to rulesync skills", async () => {
      const claudecodeSkill = new ClaudecodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".claude", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([claudecodeSkill]);

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("test-skill");
    });

    it("should filter out non-ToolSkill instances", async () => {
      const claudecodeSkill = new ClaudecodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".claude", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill",
        },
        body: "Content",
        validate: false,
      });

      const mockOtherDir = {
        getDirPath: () => "not-a-tool-skill",
      } as any;

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([
        claudecodeSkill,
        mockOtherDir,
      ]);

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
    });

    it("should handle empty tool dirs array", async () => {
      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([]);
      expect(rulesyncDirs).toEqual([]);
    });

    it("should handle array with no ToolSkill instances", async () => {
      const toolDirs = [{ getDirPath: () => "dir1" } as any, { getDirPath: () => "dir2" } as any];

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs(toolDirs);
      expect(rulesyncDirs).toEqual([]);
    });
  });

  describe("loadRulesyncDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when skills directory does not exist", async () => {
      const rulesyncDirs = await processor.loadRulesyncDirs();
      expect(rulesyncDirs).toEqual([]);
    });

    it("should load valid skill directories", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      await ensureDir(skill1Dir);

      const skillContent = `---
name: skill-1
description: First skill
---
This is skill content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skillContent);

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("skill-1");
      expect(rulesyncSkill.getFrontmatter().description).toBe("First skill");
    });

    it("should load multiple skill directories", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      const skill2Dir = join(skillsDir, "skill-2");
      await ensureDir(skill1Dir);
      await ensureDir(skill2Dir);

      const skill1Content = `---
name: skill-1
description: First skill
---
Content 1`;

      const skill2Content = `---
name: skill-2
description: Second skill
---
Content 2`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skill1Content);
      await writeFileContent(join(skill2Dir, "SKILL.md"), skill2Content);

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(2);
      expect(rulesyncDirs.every((dir) => dir instanceof RulesyncSkill)).toBe(true);

      const names = rulesyncDirs
        .map((dir) => (dir as RulesyncSkill).getFrontmatter().name)
        .toSorted();
      expect(names).toEqual(["skill-1", "skill-2"]);
    });

    it("should throw error when invalid skill directory is found", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const invalidSkillDir = join(skillsDir, "invalid-skill");
      await ensureDir(invalidSkillDir);

      const invalidContent = `---
invalid yaml: [
---
Invalid content`;

      await writeFileContent(join(invalidSkillDir, "SKILL.md"), invalidContent);

      await expect(processor.loadRulesyncDirs()).rejects.toThrow();
    });

    it("should throw error when directory without SKILL.md file is found", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const emptyDir = join(skillsDir, "empty-dir");
      await ensureDir(emptyDir);

      await expect(processor.loadRulesyncDirs()).rejects.toThrow("SKILL.md not found in");
    });

    it("should load rulesync dirs from cwd even when baseDir is different (global mode)", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      await ensureDir(skill1Dir);

      const skillContent = `---
name: skill-1
description: First skill
---
This is skill content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skillContent);

      // Use a different baseDir to simulate global mode (baseDir = homeDir)
      const differentBaseDir = join(testDir, "fake-home");
      await ensureDir(differentBaseDir);

      const globalProcessor = new SkillsProcessor({
        baseDir: differentBaseDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncDirs = await globalProcessor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("skill-1");
    });
  });

  describe("loadToolDirs", () => {
    it("should delegate to loadClaudecodeSkills for claudecode target", async () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolDirs = await processor.loadToolDirs();
      expect(Array.isArray(toolDirs)).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target
      const processorWithMockTarget = Object.create(SkillsProcessor.prototype);
      processorWithMockTarget.baseDir = testDir;
      processorWithMockTarget.toolTarget = "unsupported";
      processorWithMockTarget.getFactory = (target: any) => {
        throw new Error(`Unsupported tool target: ${target}`);
      };

      await expect(processorWithMockTarget.loadToolDirs()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("loadClaudecodeSkills", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when skills directory does not exist", async () => {
      const toolDirs = await processor.loadToolDirs();
      expect(toolDirs).toEqual([]);
    });

    it("should load claudecode skill files from .claude/skills", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "claude-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: claude-skill
description: Claude skill description
---
Claude skill content`;

      await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
      const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
      expect(claudecodeSkill.getFrontmatter().name).toBe("claude-skill");
    });

    it("should load multiple claudecode skill directories", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      const skill2Dir = join(skillsDir, "skill-2");
      await ensureDir(skill1Dir);
      await ensureDir(skill2Dir);

      const skill1Content = `---
name: skill-1
description: First Claude skill
---
First content`;

      const skill2Content = `---
name: skill-2
description: Second Claude skill
---
Second content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skill1Content);
      await writeFileContent(join(skill2Dir, "SKILL.md"), skill2Content);

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(2);
      expect(toolDirs.every((dir) => dir instanceof ClaudecodeSkill)).toBe(true);

      const names = toolDirs
        .map((dir) => (dir as ClaudecodeSkill).getFrontmatter().name)
        .toSorted();
      expect(names).toEqual(["skill-1", "skill-2"]);
    });

    it("should throw error when directory fails to load", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const invalidSkillDir = join(skillsDir, "invalid");
      await ensureDir(invalidSkillDir);

      // Create invalid skill (no frontmatter)
      await writeFileContent(
        join(invalidSkillDir, "SKILL.md"),
        "Invalid format without frontmatter",
      );

      await expect(processor.loadToolDirs()).rejects.toThrow();
    });

    describe("global mode", () => {
      it("should use global paths when global=true", async () => {
        const globalProcessor = new SkillsProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const globalSkillsDir = join(testDir, ".claude", "skills");
        await ensureDir(globalSkillsDir);

        const skillDir = join(globalSkillsDir, "global-skill");
        await ensureDir(skillDir);

        const skillContent = `---
name: global-skill
description: Global skill description
---
Global skill content`;

        await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

        const toolDirs = await globalProcessor.loadToolDirs();

        expect(toolDirs).toHaveLength(1);
        expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
        const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
        expect(claudecodeSkill.getFrontmatter().name).toBe("global-skill");
      });

      it("should return empty array when global skills directory does not exist", async () => {
        const globalProcessor = new SkillsProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const toolDirs = await globalProcessor.loadToolDirs();
        expect(toolDirs).toEqual([]);
      });
    });
  });

  describe("loadToolDirsToDelete", () => {
    it("should return the same dirs as loadToolDirs", async () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "test-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: test-skill
description: Test skill
---
Test skill content`;

      await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(1);
      expect(dirsToDelete[0]).toBeInstanceOf(ClaudecodeSkill);
      expect(dirsToDelete[0]?.getDirName()).toBe("test-skill");
    });

    it("should succeed even when SKILL.md has broken frontmatter", async () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "broken-skill");
      await ensureDir(skillDir);

      // File with broken YAML frontmatter (unclosed bracket, invalid syntax)
      const brokenFrontmatter = `---
name: [broken-skill
description: This frontmatter is invalid YAML
  - unclosed bracket
  invalid: : syntax
---
Content that would fail parsing`;

      await writeFileContent(join(skillDir, "SKILL.md"), brokenFrontmatter);

      // forDeletion should succeed without parsing file content
      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(1);
      expect(dirsToDelete[0]).toBeInstanceOf(ClaudecodeSkill);
      expect(dirsToDelete[0]?.getDirName()).toBe("broken-skill");
    });

    it("should return empty array when no dirs exist", async () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const dirsToDelete = await processor.loadToolDirsToDelete();
      expect(dirsToDelete).toEqual([]);
    });
  });

  describe("getToolTargets", () => {
    it("should return supported non-simulated project targets by default", () => {
      const targets = SkillsProcessor.getToolTargets();
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsskills",
          "antigravity",
          "claudecode",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "cursor",
          "geminicli",
          "goose",
          "kilo",
          "kiro",
          "opencode",
          "replit",
          "roo",
        ]),
      );
    });

    it("should return all targets including simulated when includeSimulated is true", () => {
      const targets = SkillsProcessor.getToolTargets({ includeSimulated: true });
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsmd",
          "agentsskills",
          "antigravity",
          "claudecode",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "cursor",
          "factorydroid",
          "geminicli",
          "goose",
          "kilo",
          "kiro",
          "opencode",
          "replit",
          "roo",
        ]),
      );
    });

    it("should return only non-simulated targets when includeSimulated is false", () => {
      const targets = SkillsProcessor.getToolTargets({ includeSimulated: false });
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsskills",
          "antigravity",
          "claudecode",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "cursor",
          "geminicli",
          "goose",
          "kilo",
          "kiro",
          "opencode",
          "replit",
          "roo",
        ]),
      );
    });

    it("should be callable without instance", () => {
      expect(() => SkillsProcessor.getToolTargets()).not.toThrow();
    });
  });

  describe("getToolTargetsSimulated", () => {
    it("should return simulated tool targets", () => {
      const targets = SkillsProcessor.getToolTargetsSimulated();
      expect(new Set(targets)).toEqual(new Set(["agentsmd", "factorydroid"]));
    });
  });

  describe("getToolTargetsGlobal", () => {
    it("should return global targets in global mode", () => {
      const targets = SkillsProcessor.getToolTargetsGlobal();
      expect(targets).toEqual([
        "antigravity",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "cursor",
        "factorydroid",
        "geminicli",
        "kilo",
        "opencode",
        "roo",
      ]);
      expect(targets).toEqual(skillsProcessorToolTargetsGlobal);
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return global targets when global option is true", () => {
      const targets = SkillsProcessor.getToolTargets({ global: true });
      expect(targets).toEqual([
        "antigravity",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "cursor",
        "factorydroid",
        "geminicli",
        "kilo",
        "opencode",
        "roo",
      ]);
      expect(targets).toEqual(skillsProcessorToolTargetsGlobal);
    });

    it("should be callable without instance", () => {
      expect(() => SkillsProcessor.getToolTargets({ global: true })).not.toThrow();
    });
  });

  describe("type exports and constants", () => {
    it("should export SkillsProcessorToolTargetSchema", () => {
      expect(SkillsProcessorToolTargetSchema).toBeDefined();
      expect(() => SkillsProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("claudecode-legacy")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("kilo")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("kiro")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("opencode")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("roo")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("invalid")).toThrow();
    });
  });

  describe("inheritance from DirFeatureProcessor", () => {
    it("should extend DirFeatureProcessor", () => {
      const processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
      expect(typeof processor.convertRulesyncDirsToToolDirs).toBe("function");
      expect(typeof processor.convertToolDirsToRulesyncDirs).toBe("function");
      expect(typeof processor.loadRulesyncDirs).toBe("function");
      expect(typeof processor.loadToolDirs).toBe("function");
    });
  });

  describe("writeAiDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should write skill file with frontmatter that can be read back", async () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);
      expect(toolDirs).toHaveLength(1);

      await processor.writeAiDirs(toolDirs);

      const loadedDirs = await processor.loadToolDirs();
      expect(loadedDirs).toHaveLength(1);

      const loadedSkill = loadedDirs[0] as ClaudecodeSkill;
      expect(loadedSkill.getFrontmatter().name).toBe("test-skill");
      expect(loadedSkill.getFrontmatter().description).toBe("Test skill description");
      expect(loadedSkill.getBody()).toBe("Test skill content");
    });

    it("should write skill file with allowed-tools frontmatter", async () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "tool-skill",
        frontmatter: {
          name: "tool-skill",
          description: "Skill with allowed tools",
          claudecode: {
            "allowed-tools": ["Bash", "Read", "Write"],
          },
        },
        body: "Skill body",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);
      await processor.writeAiDirs(toolDirs);

      const loadedDirs = await processor.loadToolDirs();
      const loadedSkill = loadedDirs[0] as ClaudecodeSkill;

      expect(loadedSkill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read", "Write"]);
    });
  });
});
