import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { WindsurfSkill } from "./windsurf-skill.js";

describe("WindsurfSkill", () => {
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
    it("should return .windsurf/skills as relativeDirPath", () => {
      const paths = WindsurfSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".windsurf", "skills"));
    });

    it("should return .codeium/windsurf/skills as relativeDirPath for global mode", () => {
      const paths = WindsurfSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".codeium", "windsurf", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new WindsurfSkill({
        baseDir: testDir,
        relativeDirPath: join(".windsurf", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the windsurf skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(WindsurfSkill);
      expect(skill.getBody()).toBe("This is the body of the windsurf skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".windsurf", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the windsurf skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await WindsurfSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(WindsurfSkill);
      expect(skill.getBody()).toBe("This is the body of the windsurf skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".windsurf", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        WindsurfSkill.fromDir({
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

      const windsurfSkill = WindsurfSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(windsurfSkill).toBeInstanceOf(WindsurfSkill);
      expect(windsurfSkill.getBody()).toBe("Test body content");
      expect(windsurfSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should use global path when global is true", () => {
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

      const windsurfSkill = WindsurfSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });

      expect(windsurfSkill.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "skills"));
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

      expect(WindsurfSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'windsurf'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "windsurf-skill",
        frontmatter: {
          name: "Windsurf Skill",
          description: "Skill for windsurf",
          targets: ["copilot", "windsurf"],
        },
        body: "Test body",
        validate: true,
      });

      expect(WindsurfSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'windsurf'", () => {
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

      expect(WindsurfSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new WindsurfSkill({
        baseDir: testDir,
        relativeDirPath: join(".windsurf", "skills"),
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
      const skill = WindsurfSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".windsurf", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".windsurf", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default baseDir", () => {
      const skill = WindsurfSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".windsurf", "skills"),
      });

      expect(skill).toBeInstanceOf(WindsurfSkill);
      expect(skill.getBaseDir()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = WindsurfSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".windsurf", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });

    it("should use global path when global is true", () => {
      const skill = WindsurfSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".codeium", "windsurf", "skills"),
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "skills"));
      expect(skill.getGlobal()).toBe(true);
    });
  });
});
