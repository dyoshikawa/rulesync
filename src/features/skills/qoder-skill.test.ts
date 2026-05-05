import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderSkill } from "./qoder-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("QoderSkill", () => {
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
    it("should return .qoder/skills as relativeDirPath", () => {
      const paths = QoderSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".qoder", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new QoderSkill({
        outputRoot: testDir,
        relativeDirPath: join(".qoder", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the qoder skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(QoderSkill);
      expect(skill.getBody()).toBe("This is the body of the qoder skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".qoder", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the qoder skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await QoderSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(QoderSkill);
      expect(skill.getBody()).toBe("This is the body of the qoder skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".qoder", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        QoderSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new QoderSkill({
        outputRoot: testDir,
        relativeDirPath: join(".qoder", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Skill body content",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getDirName()).toBe("test-skill");
      expect(rulesyncSkill.getBody()).toBe("Skill body content");
      expect(rulesyncSkill.getFrontmatter().name).toBe("Test Skill");
      expect(rulesyncSkill.getFrontmatter().description).toBe("Test skill description");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create QoderSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Rulesync Skill",
          description: "From rulesync",
          targets: ["*"],
        },
        body: "Rulesync skill body",
        validate: true,
      });

      const skill = QoderSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });

      expect(skill).toBeInstanceOf(QoderSkill);
      expect(skill.getBody()).toBe("Rulesync skill body");
      expect(skill.getFrontmatter()).toEqual({
        name: "Rulesync Skill",
        description: "From rulesync",
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for skills targeting qoder", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: { name: "Test", description: "Test", targets: ["qoder"] },
        body: "Test",
        validate: false,
      });

      expect(QoderSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true for skills targeting all (*)", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: { name: "Test", description: "Test", targets: ["*"] },
        body: "Test",
        validate: false,
      });

      expect(QoderSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false for skills not targeting qoder", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: { name: "Test", description: "Test", targets: ["cursor"] },
        body: "Test",
        validate: false,
      });

      expect(QoderSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return successful validation for valid content", () => {
      const skill = new QoderSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "Valid Skill", description: "Valid description" },
        body: "Valid body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create an instance for deletion", () => {
      const skill = QoderSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".qoder", "skills"),
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(QoderSkill);
    });
  });
});
