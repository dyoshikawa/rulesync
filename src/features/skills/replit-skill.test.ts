import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReplitSkill } from "./replit-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("ReplitSkill", () => {
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

  describe("getSettablePaths", () => {
    it("should return .agents/skills as relativeDirPath", () => {
      const paths = ReplitSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should throw error when global is true", () => {
      expect(() => ReplitSkill.getSettablePaths({ global: true })).toThrow(
        "ReplitSkill does not support global mode.",
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new ReplitSkill({
        baseDir: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the replit skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getBody()).toBe("This is the body of the replit skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the replit skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await ReplitSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getBody()).toBe("This is the body of the replit skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        ReplitSkill.fromDir({
          baseDir: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const replitSkill = ReplitSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(replitSkill).toBeInstanceOf(ReplitSkill);
      expect(replitSkill.getBody()).toBe("Test body content");
      expect(replitSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-targets-skill",
        frontmatter: {
          name: "All Targets Skill",
          description: "Skill for all targets",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'replit'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "replit-skill",
        frontmatter: {
          name: "Replit Skill",
          description: "Skill for replit",
          targets: ["copilot", "replit"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'replit'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "claudecode-only-skill",
        frontmatter: {
          name: "ClaudeCode Only Skill",
          description: "Skill for claudecode only",
          targets: ["claudecode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new ReplitSkill({
        baseDir: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default baseDir", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getBaseDir()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
