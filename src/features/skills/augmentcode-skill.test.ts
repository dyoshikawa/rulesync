import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodeSkill } from "./augmentcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkill } from "./tool-skill.js";

describe("AugmentcodeSkill", () => {
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
    it("should return .augment/skills for both project and global mode", () => {
      expect(AugmentcodeSkill.getSettablePaths().relativeDirPath).toBe(join(".augment", "skills"));
      expect(AugmentcodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".augment", "skills"),
      );
    });

    it("should expose .agents/skills as an alternative discovery root", () => {
      expect(AugmentcodeSkill.getSettablePaths().alternativeSkillRoots).toEqual([
        join(".agents", "skills"),
      ]);
      expect(AugmentcodeSkill.getSettablePaths({ global: true }).alternativeSkillRoots).toEqual([
        join(".agents", "skills"),
      ]);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should map name and description (project)", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "python-testing",
        frontmatter: {
          name: "python-testing",
          description: "How to test python",
          targets: ["*"],
        },
        body: "Body",
        validate: true,
      });

      const skill = AugmentcodeSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        validate: true,
      });

      expect(skill).toBeInstanceOf(AugmentcodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "python-testing",
        description: "How to test python",
      });
      expect(skill.getRelativeDirPath()).toBe(join(".augment", "skills"));
    });

    it("should support global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "api-design",
        frontmatter: { name: "api-design", description: "API design", targets: ["*"] },
        body: "Body",
        validate: true,
      });

      const skill = AugmentcodeSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global: true,
        validate: true,
      });

      expect(skill.getRelativeDirPath()).toBe(join(".augment", "skills"));
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert back to rulesync skill", () => {
      const skill = new AugmentcodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "skills"),
        dirName: "python-testing",
        frontmatter: { name: "python-testing", description: "How to test python" },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter().name).toBe("python-testing");
      expect(rulesyncSkill.getFrontmatter().description).toBe("How to test python");
    });
  });

  describe("fromDir", () => {
    it("should create instance from a SKILL.md directory", async () => {
      const skillDir = join(testDir, ".augment", "skills", "python-testing");
      await ensureDir(skillDir);
      const skillContent = `---
name: python-testing
description: How to test python
---

This is the skill body.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AugmentcodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "python-testing",
      });

      expect(skill).toBeInstanceOf(AugmentcodeSkill);
      expect(skill.getBody()).toBe("This is the skill body.");
      expect(skill.getFrontmatter()).toEqual({
        name: "python-testing",
        description: "How to test python",
      });
    });

    it("should load a skill from the .agents/skills import root when relativeDirPath is set", async () => {
      const skillDir = join(testDir, ".agents", "skills", "shared-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: shared-skill
description: Discovered from .agents/skills
---

Shared skill body.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AugmentcodeSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "shared-skill",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getFrontmatter().name).toBe("shared-skill");
      expect(skill.getBody()).toBe("Shared skill body.");
    });

    it("should throw when frontmatter is missing required fields", async () => {
      const skillDir = join(testDir, ".augment", "skills", "bad");
      await ensureDir(skillDir);
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), `---\nname: bad\n---\n\nBody`);

      await expect(
        AugmentcodeSkill.fromDir({ outputRoot: testDir, dirName: "bad" }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should match augmentcode and wildcard targets", () => {
      const make = (targets: string[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets: targets as never },
          body: "b",
          validate: false,
        });

      expect(AugmentcodeSkill.isTargetedByRulesyncSkill(make(["augmentcode"]))).toBe(true);
      expect(AugmentcodeSkill.isTargetedByRulesyncSkill(make(["*"]))).toBe(true);
      expect(AugmentcodeSkill.isTargetedByRulesyncSkill(make(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a forDeletion instance", () => {
      const skill = AugmentcodeSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "skills"),
        dirName: "python-testing",
      });
      expect(skill).toBeInstanceOf(ToolSkill);
    });
  });
});
