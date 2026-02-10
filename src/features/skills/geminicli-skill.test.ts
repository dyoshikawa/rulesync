import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminiCliSkill, GeminiCliSkillFrontmatterSchema } from "./geminicli-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("GeminiCliSkill", () => {
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
    it("should return .gemini/skills as relativeDirPath", () => {
      const paths = GeminiCliSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".gemini", "skills"));
    });

    it("should return the same path in global mode", () => {
      const paths = GeminiCliSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".gemini", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new GeminiCliSkill({
        baseDir: testDir,
        relativeDirPath: join(".gemini", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the gemini cli skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(GeminiCliSkill);
      expect(skill.getBody()).toBe("This is the body of the gemini cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".gemini", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the gemini cli skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await GeminiCliSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(GeminiCliSkill);
      expect(skill.getBody()).toBe("This is the body of the gemini cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".gemini", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        GeminiCliSkill.fromDir({
          baseDir: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });

    it("should throw error when frontmatter is invalid", async () => {
      const skillDir = join(testDir, ".gemini", "skills", "bad-frontmatter");
      await ensureDir(skillDir);
      const skillContent = `---
name: 123
---

Body content`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        GeminiCliSkill.fromDir({
          baseDir: testDir,
          dirName: "bad-frontmatter",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should create instance from directory in global mode", async () => {
      const skillDir = join(testDir, ".gemini", "skills", "global-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Global Skill
description: A global skill
---

Global body content`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await GeminiCliSkill.fromDir({
        baseDir: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(GeminiCliSkill);
      expect(skill.getGlobal()).toBe(true);
      expect(skill.getBody()).toBe("Global body content");
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

      const geminiCliSkill = GeminiCliSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(geminiCliSkill).toBeInstanceOf(GeminiCliSkill);
      expect(geminiCliSkill.getBody()).toBe("Test body content");
      expect(geminiCliSkill.getFrontmatter()).toEqual({
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

      expect(GeminiCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'geminicli'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "geminicli-skill",
        frontmatter: {
          name: "GeminiCli Skill",
          description: "Skill for geminicli",
          targets: ["copilot", "geminicli"],
        },
        body: "Test body",
        validate: true,
      });

      expect(GeminiCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'geminicli'", () => {
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

      expect(GeminiCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with correct frontmatter", () => {
      const skill = new GeminiCliSkill({
        baseDir: testDir,
        relativeDirPath: join(".gemini", "skills"),
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

  describe("global mode", () => {
    it("should support global mode in constructor", () => {
      const skill = new GeminiCliSkill({
        dirName: "global-skill",
        frontmatter: {
          name: "Global Skill",
          description: "A global skill",
        },
        body: "Global body",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });

    it("should convert from RulesyncSkill in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: {
          name: "Global Skill",
          description: "A globally available skill",
          targets: ["geminicli"],
        },
        body: "Global content",
      });

      const geminiSkill = GeminiCliSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(geminiSkill.getGlobal()).toBe(true);
      expect(geminiSkill.getRelativeDirPath()).toBe(join(".gemini", "skills"));
    });

    it("should support global deletion", () => {
      const skill = GeminiCliSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".gemini", "skills"),
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });

  describe("schema", () => {
    it("should accept valid frontmatter", () => {
      const result = GeminiCliSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid frontmatter", () => {
      const result = GeminiCliSkillFrontmatterSchema.safeParse({ name: 123, description: true });

      expect(result.success).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = GeminiCliSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".gemini", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".gemini", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });
  });
});
