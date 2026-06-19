import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { FactorydroidSkill, FactorydroidSkillFrontmatterSchema } from "./factorydroid-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("FactorydroidSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validSkillContent = `---
name: Test Skill
description: Test skill description
user-invocable: true
disable-model-invocation: false
---

This is a test factorydroid skill content.`;

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
    it("should return correct paths for factorydroid skills", () => {
      const paths = FactorydroidSkill.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "skills"),
      });
    });

    it("should return the same relative path in global mode", () => {
      const paths = FactorydroidSkill.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "skills"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Skill body",
        validate: true,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getBody()).toBe("Skill body");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create FactorydroidSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill",
          targets: ["factorydroid"],
        },
        body: "This is a test factorydroid skill content.",
        validate: true,
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(factorydroidSkill).toBeInstanceOf(FactorydroidSkill);
      expect(factorydroidSkill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(factorydroidSkill.getRelativeDirPath()).toBe(join(".factory", "skills"));
      expect(factorydroidSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill",
      });
    });

    it("should convert from RulesyncSkill in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: {
          name: "Global Skill",
          description: "A globally available skill",
          targets: ["factorydroid"],
        },
        body: "Global content",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(factorydroidSkill.getGlobal()).toBe(true);
      expect(factorydroidSkill.getRelativeDirPath()).toBe(join(".factory", "skills"));
    });

    it("should pick up root-level disable-model-invocation", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-default",
        frontmatter: {
          name: "Root Default",
          description: "Root flag",
          targets: ["factorydroid"],
          "disable-model-invocation": true,
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should omit disable-model-invocation when the root value is not set", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "no-flag",
        frontmatter: {
          name: "No Flag",
          description: "No flag",
          targets: ["factorydroid"],
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with correct frontmatter", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
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

  describe("fromDir", () => {
    it("should load FactorydroidSkill from directory with passthrough frontmatter", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      const skillFile = join(skillDir, SKILL_FILE_NAME);

      await writeFileContent(skillFile, validSkillContent);

      const skill = await FactorydroidSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(skill.getRelativeDirPath()).toBe(join(".factory", "skills"));
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "user-invocable": true,
        "disable-model-invocation": false,
      });
    });

    it("should throw error when SKILL.md does not exist", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      await writeFileContent(join(skillDir, "other.md"), "content");

      await expect(
        FactorydroidSkill.fromDir({
          outputRoot: testDir,
          dirName: "test-skill",
          global: false,
        }),
      ).rejects.toThrow();
    });

    it("should create instance from directory in global mode", async () => {
      const skillDir = join(testDir, ".factory", "skills", "global-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Global Skill
description: A global skill
---

Global body content`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await FactorydroidSkill.fromDir({
        outputRoot: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getGlobal()).toBe(true);
      expect(skill.getBody()).toBe("Global body content");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for rulesync skill with wildcard target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["*"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(true);
    });

    it("should return true for rulesync skill with factorydroid target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["factorydroid"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(true);
    });

    it("should return false for rulesync skill with different target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["cursor"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(false);
    });
  });

  describe("schema", () => {
    it("should accept valid frontmatter with behavior flags", () => {
      const result = FactorydroidSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
        "user-invocable": true,
        "disable-model-invocation": false,
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid frontmatter", () => {
      const result = FactorydroidSkillFrontmatterSchema.safeParse({ name: 123, description: true });

      expect(result.success).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const skill = FactorydroidSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getDirName()).toBe("to-delete");
      expect(skill.getGlobal()).toBe(false);
    });

    it("should support global deletion", () => {
      const skill = FactorydroidSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "cleanup",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });
});
