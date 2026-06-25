import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIASSISTANT_SKILLS_DIR_PATH } from "../../constants/aiassistant-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AiassistantSkill } from "./aiassistant-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AiassistantSkill", () => {
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
    it("should return .agents/skills as relativeDirPath", () => {
      const paths = AiassistantSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(AIASSISTANT_SKILLS_DIR_PATH);
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should throw in global mode (project scope only)", () => {
      expect(() => AiassistantSkill.getSettablePaths({ global: true })).toThrow(
        /does not support global mode/,
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new AiassistantSkill({
        outputRoot: testDir,
        relativeDirPath: AIASSISTANT_SKILLS_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "This is the body of the AI Assistant skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(AiassistantSkill);
      expect(skill.getBody()).toBe("This is the body of the AI Assistant skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should throw error when frontmatter is invalid", () => {
      expect(
        () =>
          new AiassistantSkill({
            outputRoot: testDir,
            relativeDirPath: AIASSISTANT_SKILLS_DIR_PATH,
            dirName: "test-skill",
            // @ts-expect-error intentionally missing description for validation test
            frontmatter: {
              name: "test-skill",
            },
            body: "Body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: test-skill
description: Test skill description
---

This is the body of the AI Assistant skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AiassistantSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(AiassistantSkill);
      expect(skill.getBody()).toBe("This is the body of the AI Assistant skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        AiassistantSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const aiassistantSkill = AiassistantSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(aiassistantSkill).toBeInstanceOf(AiassistantSkill);
      expect(aiassistantSkill.getDirName()).toBe("test-skill");
      expect(aiassistantSkill.getBody()).toBe("Test body content");
      expect(aiassistantSkill.getFrontmatter()).toEqual({
        name: "test-skill",
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
          name: "all-targets-skill",
          description: "Skill for all targets",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AiassistantSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'aiassistant'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "aiassistant-skill",
        frontmatter: {
          name: "aiassistant-skill",
          description: "Skill for aiassistant",
          targets: ["copilot", "aiassistant"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AiassistantSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'aiassistant'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "claudecode-only-skill",
        frontmatter: {
          name: "claudecode-only-skill",
          description: "Skill for claudecode only",
          targets: ["claudecode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AiassistantSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new AiassistantSkill({
        outputRoot: testDir,
        relativeDirPath: AIASSISTANT_SKILLS_DIR_PATH,
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
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = AiassistantSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: AIASSISTANT_SKILLS_DIR_PATH,
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(AIASSISTANT_SKILLS_DIR_PATH);
      expect(skill.getGlobal()).toBe(false);
      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = AiassistantSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: AIASSISTANT_SKILLS_DIR_PATH,
      });

      expect(skill).toBeInstanceOf(AiassistantSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });
  });
});
