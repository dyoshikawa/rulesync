import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieSkill } from "./junie-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("JunieSkill", () => {
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
    it("should return .junie/skills as relativeDirPath", () => {
      const paths = JunieSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".junie", "skills"));
    });

    it("should throw error when global mode is requested", () => {
      expect(() => JunieSkill.getSettablePaths({ global: true })).toThrow(
        "JunieSkill does not support global mode.",
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new JunieSkill({
        baseDir: testDir,
        relativeDirPath: join(".junie", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the junie skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getBody()).toBe("This is the body of the junie skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the junie skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await JunieSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getBody()).toBe("This is the body of the junie skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".junie", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        JunieSkill.fromDir({
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

      const junieSkill = JunieSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(junieSkill).toBeInstanceOf(JunieSkill);
      expect(junieSkill.getBody()).toBe("Test body content");
      expect(junieSkill.getFrontmatter()).toEqual({
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

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'junie'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "junie-skill",
        frontmatter: {
          name: "Junie Skill",
          description: "Skill for junie",
          targets: ["copilot", "junie"],
        },
        body: "Test body",
        validate: true,
      });

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'junie'", () => {
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

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new JunieSkill({
        baseDir: testDir,
        relativeDirPath: join(".junie", "skills"),
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
      const skill = JunieSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".junie", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default baseDir", () => {
      const skill = JunieSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getBaseDir()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = JunieSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
