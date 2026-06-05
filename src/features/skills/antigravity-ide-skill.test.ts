import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityIdeSkill } from "./antigravity-ide-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AntigravityIdeSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .agents/skills as relativeDirPath in project mode", () => {
      const paths = AntigravityIdeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return .agents/skills as relativeDirPath when global is false", () => {
      const paths = AntigravityIdeSkill.getSettablePaths({ global: false });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return .gemini/config/skills as relativeDirPath in global mode", () => {
      const paths = AntigravityIdeSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".gemini", "config", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content in project mode", () => {
      const skill = new AntigravityIdeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the antigravity ide skill.",
        validate: true,
        global: false,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getBody()).toBe("This is the body of the antigravity ide skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance with valid content in global mode", () => {
      const skill = new AntigravityIdeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".gemini", "config", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the antigravity ide skill.",
        validate: true,
        global: true,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getBody()).toBe("This is the body of the antigravity ide skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error with invalid frontmatter", () => {
      expect(
        () =>
          new AntigravityIdeSkill({
            outputRoot: testDir,
            relativeDirPath: join(".agents", "skills"),
            dirName: "test-skill",
            frontmatter: {
              name: "Test Skill",
              // missing required 'description' field
            } as { name: string; description: string },
            body: "Test body",
            validate: true,
            global: false,
          }),
      ).toThrow();
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory in project mode", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the antigravity ide skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AntigravityIdeSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getBody()).toBe("This is the body of the antigravity ide skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance from valid skill directory in global mode", async () => {
      const skillDir = join(testDir, ".gemini", "config", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the antigravity ide skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AntigravityIdeSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getBody()).toBe("This is the body of the antigravity ide skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        AntigravityIdeSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
          global: false,
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });

    it("should throw error with invalid frontmatter", async () => {
      const skillDir = join(testDir, ".agents", "skills", "invalid-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
---

Missing description field.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        AntigravityIdeSkill.fromDir({
          outputRoot: testDir,
          dirName: "invalid-skill",
          global: false,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill in project mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const antigravitySkill = AntigravityIdeSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: false,
      });

      expect(antigravitySkill).toBeInstanceOf(AntigravityIdeSkill);
      expect(antigravitySkill.getBody()).toBe("Test body content");
      expect(antigravitySkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance from RulesyncSkill in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const antigravitySkill = AntigravityIdeSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });

      expect(antigravitySkill).toBeInstanceOf(AntigravityIdeSkill);
      expect(antigravitySkill.getBody()).toBe("Test body content");
      expect(antigravitySkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
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

      expect(AntigravityIdeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'antigravity-ide'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "antigravity-ide-skill",
        frontmatter: {
          name: "Antigravity IDE Skill",
          description: "Skill for antigravity-ide",
          targets: ["copilot", "antigravity-ide"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AntigravityIdeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'antigravity-ide'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
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

      expect(AntigravityIdeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });

    it("should return false when targets includes the deprecated 'antigravity' alias only", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "antigravity-alias-skill",
        frontmatter: {
          name: "Antigravity Alias Skill",
          description: "Skill for the deprecated antigravity alias",
          targets: ["antigravity"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AntigravityIdeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });

    it("should return false when targets includes 'antigravity-cli' only", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "antigravity-cli-only-skill",
        frontmatter: {
          name: "Antigravity CLI Only Skill",
          description: "Skill for antigravity-cli only",
          targets: ["antigravity-cli"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AntigravityIdeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to a RulesyncSkill in project mode", () => {
      const skill = new AntigravityIdeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
        global: false,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });

    it("should convert to a RulesyncSkill in global mode", () => {
      const skill = new AntigravityIdeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".gemini", "config", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
        global: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion in project mode", () => {
      const skill = AntigravityIdeSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "skill-to-delete",
        global: false,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getDirName()).toBe("skill-to-delete");
    });

    it("should create instance for deletion in global mode", () => {
      const skill = AntigravityIdeSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".gemini", "config", "skills"),
        dirName: "skill-to-delete",
        global: true,
      });

      expect(skill).toBeInstanceOf(AntigravityIdeSkill);
      expect(skill.getDirName()).toBe("skill-to-delete");
    });
  });

  describe("validate", () => {
    it("should return success for valid skill", () => {
      const skill = new AntigravityIdeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "valid-skill",
        frontmatter: {
          name: "Valid Skill",
          description: "Valid description",
        },
        body: "Valid body",
        validate: false, // Skip validation in constructor
        global: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
