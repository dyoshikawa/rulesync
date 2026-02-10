import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FactorydroidSkill } from "./factorydroid-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("FactorydroidSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validSkillContent = `---
name: Test Skill
description: Test skill description
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
        relativeDirPath: ".factory/skills",
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create FactorydroidSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: ".rulesync/skills",
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
      }) as FactorydroidSkill;

      expect(factorydroidSkill).toBeInstanceOf(FactorydroidSkill);
      expect(factorydroidSkill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(factorydroidSkill.getRelativeDirPath()).toBe(".factory/skills");
    });
  });

  describe("fromDir", () => {
    it("should load FactorydroidSkill from directory", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      const skillFile = join(skillDir, SKILL_FILE_NAME);

      await writeFileContent(skillFile, validSkillContent);

      const skill = await FactorydroidSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(skill.getRelativeDirPath()).toBe(".factory/skills");
    });

    it("should throw error when SKILL.md does not exist", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      await writeFileContent(join(skillDir, "other.md"), "content");

      await expect(
        FactorydroidSkill.fromDir({
          baseDir: testDir,
          dirName: "test-skill",
          global: false,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for rulesync skill with wildcard target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: ".rulesync/skills",
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
        relativeDirPath: ".rulesync/skills",
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
        relativeDirPath: ".rulesync/skills",
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

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const skill = FactorydroidSkill.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factory/skills",
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getDirName()).toBe("to-delete");
    });
  });
});
