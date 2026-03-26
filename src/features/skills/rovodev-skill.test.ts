import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RovodevSkill } from "./rovodev-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

const skillFileForDir = (dirName: string, description: string) => `---
name: ${dirName}
description: ${description}
---

Skill body content.`;

describe("RovodevSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const rovodevSkillsRel = () => join(".rovodev", "skills");

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
    it("should return .rovodev/skills for project mode", () => {
      expect(RovodevSkill.getSettablePaths()).toEqual({
        relativeDirPath: rovodevSkillsRel(),
      });
    });

    it("should return the same path for global mode", () => {
      expect(RovodevSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: rovodevSkillsRel(),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const skill = new RovodevSkill({
        baseDir: testDir,
        relativeDirPath: rovodevSkillsRel(),
        dirName: "my-skill",
        frontmatter: {
          name: "my-skill",
          description: "Does a thing",
        },
        body: "Body text.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(RovodevSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
      });
      expect(skill.getBody()).toBe("Body text.");
      expect(skill.getDirName()).toBe("my-skill");
    });

    it("should throw when validation fails for invalid frontmatter", () => {
      expect(() => {
        new RovodevSkill({
          baseDir: testDir,
          dirName: "bad",
          frontmatter: {
            name: "ok",
            description: 123,
          } as unknown as { name: string; description: string },
          body: "",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should throw when frontmatter name does not match directory name", () => {
      expect(() => {
        new RovodevSkill({
          baseDir: testDir,
          dirName: "my-skill",
          frontmatter: {
            name: "wrong-name",
            description: "d",
          },
          body: "",
          validate: true,
        });
      }).toThrow(/must match directory name/);
    });

    it("should not throw when validate is false with invalid shape", () => {
      const skill = new RovodevSkill({
        baseDir: testDir,
        dirName: "lenient",
        frontmatter: {
          name: "n",
          description: "d",
        },
        body: "",
        validate: false,
      });

      expect(skill).toBeInstanceOf(RovodevSkill);
    });
  });

  describe("fromDir", () => {
    it("should load skill from .rovodev/skills/<name>/", async () => {
      const skillDir = join(testDir, rovodevSkillsRel(), "disk-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        skillFileForDir("disk-skill", "Test skill description"),
      );

      const skill = await RovodevSkill.fromDir({
        baseDir: testDir,
        dirName: "disk-skill",
      });

      expect(skill).toBeInstanceOf(RovodevSkill);
      expect(skill.getRelativeDirPath()).toBe(rovodevSkillsRel());
      expect(skill.getFrontmatter()).toEqual({
        name: "disk-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("Skill body content.");
    });

    it("should pass global through from loadSkillDirContent", async () => {
      const skillDir = join(testDir, rovodevSkillsRel(), "global-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        skillFileForDir("global-skill", "Test skill description"),
      );

      const skill = await RovodevSkill.fromDir({
        baseDir: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });

    it("should throw when SKILL.md is missing", async () => {
      const skillDir = join(testDir, rovodevSkillsRel(), "empty");
      await ensureDir(skillDir);

      await expect(
        RovodevSkill.fromDir({
          baseDir: testDir,
          dirName: "empty",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });

    it("should throw when frontmatter fails schema validation", async () => {
      const skillDir = join(testDir, rovodevSkillsRel(), "bad-fm");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
oops: true
---

body`,
      );

      await expect(
        RovodevSkill.fromDir({
          baseDir: testDir,
          dirName: "bad-fm",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw when frontmatter name does not match directory name", async () => {
      const skillDir = join(testDir, rovodevSkillsRel(), "mismatch-dir");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        skillFileForDir("other-name", "desc"),
      );

      await expect(
        RovodevSkill.fromDir({
          baseDir: testDir,
          dirName: "mismatch-dir",
        }),
      ).rejects.toThrow(/must match directory name/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should build RovodevSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "synced",
        frontmatter: {
          name: "synced",
          description: "From rulesync",
          targets: ["rovodev"],
        },
        body: "Synced body",
        validate: true,
      });

      const rovodev = RovodevSkill.fromRulesyncSkill({
        baseDir: testDir,
        rulesyncSkill,
        validate: true,
        global: false,
      });

      expect(rovodev).toBeInstanceOf(RovodevSkill);
      expect(rovodev.getDirName()).toBe("synced");
      expect(rovodev.getFrontmatter()).toEqual({
        name: "synced",
        description: "From rulesync",
      });
      expect(rovodev.getBody()).toBe("Synced body");
      expect(rovodev.getRelativeDirPath()).toBe(rovodevSkillsRel());
    });
  });

  describe("toRulesyncSkill", () => {
    it('should convert to RulesyncSkill with targets ["*"]', () => {
      const skill = new RovodevSkill({
        baseDir: testDir,
        dirName: "export-me",
        frontmatter: {
          name: "export-me",
          description: "Desc",
        },
        body: "Export body",
        validate: true,
      });

      const rulesync = skill.toRulesyncSkill();

      expect(rulesync).toBeInstanceOf(RulesyncSkill);
      expect(rulesync.getDirName()).toBe("export-me");
      expect(rulesync.getFrontmatter()).toEqual({
        name: "export-me",
        description: "Desc",
        targets: ["*"],
      });
      expect(rulesync.getBody()).toBe("Export body");
      expect(rulesync.getRelativeDirPath()).toBe(RULESYNC_SKILLS_RELATIVE_DIR_PATH);
    });
  });

  describe("round-trip", () => {
    it("fromRulesyncSkill then toRulesyncSkill preserves name, description, body, dirName", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "rt",
        frontmatter: {
          name: "rt",
          description: "Round trip",
          targets: ["rovodev"],
        },
        body: "content",
        validate: true,
      });

      const rovodev = RovodevSkill.fromRulesyncSkill({
        baseDir: testDir,
        rulesyncSkill,
        validate: true,
      });

      const back = rovodev.toRulesyncSkill();

      expect(back.getDirName()).toBe("rt");
      expect(back.getBody()).toBe("content");
      expect(back.getFrontmatter().name).toBe("rt");
      expect(back.getFrontmatter().description).toBe("Round trip");
      expect(back.getFrontmatter().targets).toEqual(["*"]);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for wildcard and rovodev targets", () => {
      const forStar = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "a",
        frontmatter: { name: "A", description: "D", targets: ["*"] },
        body: "",
        validate: true,
      });
      const forRovodev = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "b",
        frontmatter: { name: "B", description: "D", targets: ["rovodev"] },
        body: "",
        validate: true,
      });
      const forJunie = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "c",
        frontmatter: { name: "C", description: "D", targets: ["junie"] },
        body: "",
        validate: true,
      });

      expect(RovodevSkill.isTargetedByRulesyncSkill(forStar)).toBe(true);
      expect(RovodevSkill.isTargetedByRulesyncSkill(forRovodev)).toBe(true);
      expect(RovodevSkill.isTargetedByRulesyncSkill(forJunie)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = RovodevSkill.forDeletion({
        baseDir: testDir,
        relativeDirPath: rovodevSkillsRel(),
        dirName: "gone",
      });

      expect(skill.getDirName()).toBe("gone");
      expect(skill.getGlobal()).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return failure when frontmatter name does not match directory name", () => {
      const skill = new RovodevSkill({
        baseDir: testDir,
        dirName: "ok-dir",
        frontmatter: { name: "other", description: "d" },
        body: "",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/must match directory name/);
    });

    it("should return failure when frontmatter does not match schema", () => {
      const skill = new RovodevSkill({
        baseDir: testDir,
        dirName: "bad",
        frontmatter: {
          name: "n",
          description: 42,
        } as unknown as { name: string; description: string },
        body: "",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Invalid frontmatter/);
    });

    it("should return failure for forDeletion instance (empty name does not match dir)", () => {
      const skill = RovodevSkill.forDeletion({
        relativeDirPath: rovodevSkillsRel(),
        dirName: "x",
      });
      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/must match directory name/);
    });
  });
});
