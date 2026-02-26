import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  OpenCodeSkill,
  OpenCodeSkillFrontmatter,
  OpenCodeSkillFrontmatterSchema,
} from "./opencode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("OpenCodeSkill", () => {
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
      const skill = new OpenCodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "skill"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          "allowed-tools": ["Bash", "Read"],
        },
        body: "This is the body of the opencode skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should create instance without validation when validate is false", () => {
      const skill = new OpenCodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "skill"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(skill.getBody()).toBe("Test body");
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(() => {
        new OpenCodeSkill({
          baseDir: testDir,
          relativeDirPath: join(".opencode", "skill"),
          dirName: "test-skill",
          frontmatter: {
            name: "",
            description: "",
            "allowed-tools": "invalid" as unknown as string[],
          },
          body: "Test body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });
  });

  describe("getSettablePaths", () => {
    it("should return project and global paths", () => {
      expect(OpenCodeSkill.getSettablePaths()).toEqual({
        relativeDirPath: join(".opencode", "skill"),
      });
      expect(OpenCodeSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "opencode", "skill"),
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill and keep allowed-tools", () => {
      const skill = new OpenCodeSkill({
        baseDir: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          "allowed-tools": ["Bash", "Read"],
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter().opencode).toEqual({
        "allowed-tools": ["Bash", "Read"],
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill with project paths", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          opencode: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: false,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".opencode", "skill"));
      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("should create instance from RulesyncSkill and respect global paths", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          opencode: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".config", "opencode", "skill"));
      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read"]);
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".opencode", "skill", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
allowed-tools:
  - Bash
  - Read
---

This is the body of the opencode skill.
It can be multiline.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await OpenCodeSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
      expect(skill.getBody()).toBe("This is the body of the opencode skill.\nIt can be multiline.");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets include opencode", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["opencode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets include wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets do not include opencode or wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["claudecode", "cursor"],
        },
        body: "Test body",
        validate: true,
      });

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("validation schema", () => {
    it("should validate allowed-tools as optional array", () => {
      const validFrontmatter: OpenCodeSkillFrontmatter = {
        name: "Test Skill",
        description: "Test description",
        "allowed-tools": ["Bash"],
      };

      const result = OpenCodeSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });
  });
});
