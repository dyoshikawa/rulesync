import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ZedSkill } from "./zed-skill.js";

describe("ZedSkill", () => {
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
    it("should return .agents/skills for both project and global modes", () => {
      expect(ZedSkill.getSettablePaths().relativeDirPath).toBe(join(".agents", "skills"));
      expect(ZedSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".agents", "skills"),
      );
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new ZedSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill description" },
        body: "This is the body of the zed skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(ZedSkill);
      expect(skill.getBody()).toBe("This is the body of the zed skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should accept the optional disable-model-invocation flag", () => {
      const skill = new ZedSkill({
        outputRoot: testDir,
        dirName: "manual-skill",
        frontmatter: {
          name: "manual-skill",
          description: "Manual only",
          "disable-model-invocation": true,
        },
        body: "Body",
        validate: true,
      });

      expect(skill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });
  });

  describe("fromDir", () => {
    it("should create instance from a valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: test-skill
description: Test skill description
---

This is the body of the zed skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await ZedSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

      expect(skill).toBeInstanceOf(ZedSkill);
      expect(skill.getBody()).toBe("This is the body of the zed skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should throw when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        ZedSkill.fromDir({ outputRoot: testDir, dirName: "empty-skill" }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill description" },
        body: "Test body content",
        validate: true,
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });

      expect(zedSkill).toBeInstanceOf(ZedSkill);
      expect(zedSkill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(zedSkill.getBody()).toBe("Test body content");
      expect(zedSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target wildcard and zed", () => {
      const wildcard = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["*"] },
        body: "b",
        validate: true,
      });
      const zed = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["zed"] },
        body: "b",
        validate: true,
      });
      expect(ZedSkill.isTargetedByRulesyncSkill(wildcard)).toBe(true);
      expect(ZedSkill.isTargetedByRulesyncSkill(zed)).toBe(true);
    });

    it("should not target other tools", () => {
      const other = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["claudecode"] },
        body: "b",
        validate: true,
      });
      expect(ZedSkill.isTargetedByRulesyncSkill(other)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with wildcard targets", () => {
      const skill = new ZedSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test description" },
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
    it("should create a minimal instance for deletion", () => {
      const skill = ZedSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill).toBeInstanceOf(ZedSkill);
      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getFrontmatter()).toEqual({ name: "", description: "" });
      expect(skill.getBody()).toBe("");
    });
  });
});
