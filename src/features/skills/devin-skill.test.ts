import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinSkill } from "./devin-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("DevinSkill", () => {
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
    it("should return .devin/skills as relativeDirPath", () => {
      const paths = DevinSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".devin", "skills"));
    });

    it("should return .codeium/windsurf/skills as relativeDirPath for global mode", () => {
      const paths = DevinSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".codeium", "windsurf", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new DevinSkill({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the devin skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(DevinSkill);
      expect(skill.getBody()).toBe("This is the body of the devin skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when frontmatter is invalid", () => {
      expect(
        () =>
          new DevinSkill({
            outputRoot: testDir,
            relativeDirPath: join(".devin", "skills"),
            dirName: "invalid-skill",
            frontmatter: {
              name: 123,
              description: "Valid description",
            } as unknown as { name: string; description: string },
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".devin", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the devin skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await DevinSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(DevinSkill);
      expect(skill.getBody()).toBe("This is the body of the devin skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".devin", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        DevinSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });

    it("should throw when frontmatter is invalid", async () => {
      const skillDir = join(testDir, ".devin", "skills", "bad-fm");
      await ensureDir(skillDir);
      const skillContent = `---
name: Bad Skill
---

Missing description field.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        DevinSkill.fromDir({
          outputRoot: testDir,
          dirName: "bad-fm",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should create instance from global skill directory", async () => {
      const skillDir = join(testDir, ".codeium", "windsurf", "skills", "global-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Global Skill
description: A global devin skill
---

Global skill body content.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await DevinSkill.fromDir({
        outputRoot: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(DevinSkill);
      expect(skill.getBody()).toBe("Global skill body content.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Global Skill",
        description: "A global devin skill",
      });
      expect(skill.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "skills"));
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
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

      const devinSkill = DevinSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(devinSkill).toBeInstanceOf(DevinSkill);
      expect(devinSkill.getBody()).toBe("Test body content");
      expect(devinSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should use global path when global is true", () => {
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

      const devinSkill = DevinSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });

      expect(devinSkill.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "skills"));
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

      expect(DevinSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'devin'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "devin-skill",
        frontmatter: {
          name: "Devin Skill",
          description: "Skill for devin",
          targets: ["copilot", "devin"],
        },
        body: "Test body",
        validate: true,
      });

      expect(DevinSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'devin'", () => {
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

      expect(DevinSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new DevinSkill({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "skills"),
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
      const skill = DevinSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".devin", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".devin", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = DevinSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".devin", "skills"),
      });

      expect(skill).toBeInstanceOf(DevinSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = DevinSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".devin", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });

    it("should use global path when global is true", () => {
      const skill = DevinSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".codeium", "windsurf", "skills"),
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "skills"));
      expect(skill.getGlobal()).toBe(true);
    });
  });
});
