import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodeSkill } from "./opencode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("OpencodeSkill", () => {
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
    it("should return .opencode/skills as relativeDirPath", () => {
      const paths = OpencodeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".opencode", "skills"));
    });

    it("should throw error when global is true", () => {
      expect(() => OpencodeSkill.getSettablePaths({ global: true })).toThrow(
        "OpencodeSkill does not support global mode.",
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new OpencodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the opencode skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(OpencodeSkill);
      expect(skill.getBody()).toBe("This is the body of the opencode skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".opencode", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the opencode skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await OpencodeSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(OpencodeSkill);
      expect(skill.getBody()).toBe("This is the body of the opencode skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".opencode", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        OpencodeSkill.fromDir({
          baseDir: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
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

      const opencodeSkill = OpencodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(opencodeSkill).toBeInstanceOf(OpencodeSkill);
      expect(opencodeSkill.getBody()).toBe("Test body content");
      expect(opencodeSkill.getFrontmatter()).toEqual({
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

      expect(OpencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'opencode'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "opencode-skill",
        frontmatter: {
          name: "OpenCode Skill",
          description: "Skill for opencode",
          targets: ["copilot", "opencode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(OpencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'opencode'", () => {
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

      expect(OpencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should throw error because OpencodeSkill is simulated", () => {
      const skill = new OpencodeSkill({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      expect(() => skill.toRulesyncSkill()).toThrow(
        "Not implemented because it is a SIMULATED skill.",
      );
    });
  });
});
