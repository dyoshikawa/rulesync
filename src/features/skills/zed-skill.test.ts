import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
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

    it("should propagate zed.disable-model-invocation into the generated frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "manual-skill",
        frontmatter: {
          name: "manual-skill",
          description: "Manual only",
          zed: { "disable-model-invocation": true },
        },
        body: "Body",
        validate: true,
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });

      expect(zedSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should pick up root-level disable-model-invocation when zed section omits it", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-default",
        frontmatter: {
          name: "root-default",
          description: "Root flag",
          "disable-model-invocation": true,
        },
        body: "Body",
        validate: true,
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(zedSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should let zed disable-model-invocation override the root-level value", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "override",
        frontmatter: {
          name: "override",
          description: "Zed opts out of root default",
          "disable-model-invocation": true,
          zed: { "disable-model-invocation": false },
        },
        body: "Body",
        validate: true,
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(zedSkill.getFrontmatter()["disable-model-invocation"]).toBe(false);
    });

    it("should omit disable-model-invocation when neither root nor zed set it", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "no-flag",
        frontmatter: { name: "no-flag", description: "No flag" },
        body: "Body",
        validate: true,
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(zedSkill.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
    });
  });

  describe("fromRulesyncSkill Zed skill limits", () => {
    // https://zed.dev/docs/ai/skills — an invalid name makes the skill "fail to
    // load and surface an error in the UI"; a description over 1024 characters
    // "still load[s], but with a warning".
    const makeRulesyncSkill = ({
      dirName,
      name,
      description,
    }: {
      dirName: string;
      name: string;
      description: string;
    }): RulesyncSkill =>
      new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName,
        frontmatter: { name, description },
        body: "Body",
        validate: true,
      });

    it("should not warn about a skill that satisfies Zed's rules", () => {
      const logger = createMockLogger();
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "deploy-2-prod",
        name: "deploy-2-prod",
        description: "d".repeat(1024),
      });

      ZedSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      { name: "Deploy Skill", reason: "uppercase letters and spaces" },
      { name: "-deploy", reason: "a leading hyphen" },
      { name: "deploy-", reason: "a trailing hyphen" },
      { name: "deploy--prod", reason: "consecutive hyphens" },
      { name: "deploy_prod", reason: "an underscore" },
    ])("should warn about a name with $reason, which Zed refuses to load", ({ name }) => {
      const logger = createMockLogger();
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "deploy-skill",
        name,
        description: "Deploy",
      });

      const zedSkill = ZedSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      // Still written: the canonical skill is shared with every other target.
      expect(zedSkill.getFrontmatter().name).toBe(name);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain(
        join(testDir, ".agents", "skills", "deploy-skill", SKILL_FILE_NAME).replaceAll("\\", "/"),
      );
      expect(logger.warn.mock.calls[0]?.[0]).toContain(
        `\`name\` "${name}" must contain only lowercase letters, digits and single hyphens`,
      );
    });

    it("should warn about a name longer than 64 characters", () => {
      const logger = createMockLogger();
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "long-name",
        name: "a".repeat(65),
        description: "Long",
      });

      ZedSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain(
        "`name` is 65 characters; Zed allows at most 64",
      );
    });

    it("should warn about a description longer than 1024 characters", () => {
      const logger = createMockLogger();
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "wordy",
        name: "wordy",
        description: "d".repeat(1025),
      });

      ZedSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain(
        "`description` is 1025 characters; Zed loads the skill but warns past 1024",
      );
    });

    it("should report every violation of one skill, name rules before description", () => {
      const logger = createMockLogger();
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "bad-skill",
        name: "Bad_Skill",
        description: "d".repeat(1025),
      });

      ZedSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).toHaveBeenCalledTimes(2);
      const messages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(messages[0]).toContain('`name` "Bad_Skill"');
      expect(messages[1]).toContain("`description` is 1025 characters");
      expect(messages[0]).toContain(
        join(testDir, ".agents", "skills", "bad-skill", SKILL_FILE_NAME).replaceAll("\\", "/"),
      );
    });

    it("should warn through the fallback logger when none is passed", () => {
      const rulesyncSkill = makeRulesyncSkill({
        dirName: "no-logger",
        name: "No Logger",
        description: "None",
      });
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        ZedSkill.fromRulesyncSkill({ rulesyncSkill });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain('`name` "No Logger"');
      } finally {
        warnSpy.mockRestore();
      }
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

    it("should round-trip disable-model-invocation into a zed block", () => {
      const skill = new ZedSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "manual-skill",
        frontmatter: {
          name: "manual-skill",
          description: "Manual only",
          "disable-model-invocation": true,
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "manual-skill",
        description: "Manual only",
        targets: ["*"],
        zed: { "disable-model-invocation": true },
      });
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
