import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { WarpSkill, WarpSkillFrontmatter, WarpSkillFrontmatterSchema } from "./warp-skill.js";

describe("WarpSkill", () => {
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
    it("should create instance with valid content", () => {
      const skill = new WarpSkill({
        outputRoot: testDir,
        relativeDirPath: join(".warp", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "This is the body of the warp skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(WarpSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is the body of the warp skill.");
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(() => {
        new WarpSkill({
          outputRoot: testDir,
          relativeDirPath: join(".warp", "skills"),
          dirName: "test-skill",
          frontmatter: {
            name: 123 as unknown as string,
            description: "",
          },
          body: "Test body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });
  });

  describe("getSettablePaths", () => {
    it("should return the same .warp/skills path for project and global scopes", () => {
      // Warp reads project skills from .warp/skills/ and global skills from
      // ~/.warp/skills/; both share the relative path, with only the output
      // base (project vs. home directory) differing.
      expect(WarpSkill.getSettablePaths()).toEqual({
        relativeDirPath: join(".warp", "skills"),
      });
      expect(WarpSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".warp", "skills"),
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill with name and description", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test body",
        validate: true,
      });

      const skill = WarpSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: false,
      });

      expect(skill).toBeInstanceOf(WarpSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".warp", "skills"));
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with name and description", () => {
      const skill = new WarpSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter().name).toBe("test-skill");
      expect(rulesyncSkill.getFrontmatter().description).toBe("Test description");
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".warp", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: test-skill
description: Test skill description
---

This is the body of the warp skill.
It can be multiline.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await WarpSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(WarpSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is the body of the warp skill.\nIt can be multiline.");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      { targets: ["warp"], expected: true },
      { targets: ["*"], expected: true },
      { targets: ["claudecode", "cursor"], expected: false },
    ])("should return $expected for targets $targets", ({ targets, expected }) => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
          targets: targets as ("*" | "warp")[],
        },
        body: "Test body",
        validate: true,
      });

      expect(WarpSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });

  describe("validation schema", () => {
    it("should require name and description", () => {
      const validFrontmatter: WarpSkillFrontmatter = {
        name: "test-skill",
        description: "Test description",
      };

      expect(WarpSkillFrontmatterSchema.safeParse(validFrontmatter).success).toBe(true);
      expect(WarpSkillFrontmatterSchema.safeParse({ name: "x" }).success).toBe(false);
    });
  });
});
