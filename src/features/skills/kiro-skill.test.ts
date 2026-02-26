import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroSkill } from "./kiro-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("KiroSkill", () => {
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

  describe("constructor", () => {
    it("should create a KiroSkill with valid frontmatter and body", () => {
      const skill = new KiroSkill({
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "This is a test skill body",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getRelativeDirPath()).toBe(join(".kiro", "skills"));
    });

    it("should throw error when frontmatter name does not match directory name", () => {
      expect(() => {
        new KiroSkill({
          dirName: "test-skill",
          frontmatter: {
            name: "wrong-name",
            description: "Test skill description",
          },
          body: "This is a test skill body",
        });
      }).toThrow(/frontmatter name \(wrong-name\) must match directory name \(test-skill\)/);
    });

    it("should throw error when global mode is requested", () => {
      expect(() => KiroSkill.getSettablePaths({ global: true })).toThrow(
        "KiroSkill does not support global mode.",
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should convert RulesyncSkill to KiroSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test description",
          targets: ["kiro"],
        },
        body: "Test body",
      });

      const kiroSkill = KiroSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(kiroSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test description",
      });
      expect(kiroSkill.getBody()).toBe("Test body");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert KiroSkill to RulesyncSkill", () => {
      const kiroSkill = new KiroSkill({
        baseDir: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test description",
        },
        body: "Test body",
      });

      const rulesyncSkill = kiroSkill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes kiro", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "kiro-skill",
        frontmatter: {
          name: "kiro-skill",
          description: "Kiro skill",
          targets: ["kiro"],
        },
        body: "Test body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-skill",
        frontmatter: {
          name: "all-skill",
          description: "All targets skill",
          targets: ["*"],
        },
        body: "Test body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include kiro", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-skill",
        frontmatter: {
          name: "other-skill",
          description: "Other skill",
          targets: ["copilot"],
        },
        body: "Test body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load KiroSkill from directory", async () => {
      const skillDir = join(testDir, ".kiro", "skills", "test-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: test-skill
description: Test skill description
---

This is the skill body content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await KiroSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is the skill body content.");
    });

    it("should throw error for invalid frontmatter", async () => {
      const skillDir = join(testDir, ".kiro", "skills", "invalid-skill");
      await ensureDir(skillDir);

      const invalidContent = `---
name: invalid-skill
---

Missing description`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), invalidContent);

      await expect(
        KiroSkill.fromDir({
          baseDir: testDir,
          dirName: "invalid-skill",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw error when frontmatter name does not match directory name", async () => {
      const skillDir = join(testDir, ".kiro", "skills", "test-skill");
      await ensureDir(skillDir);

      const mismatchContent = `---
name: wrong-name
description: Test skill description
---

This is the skill body content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), mismatchContent);

      await expect(
        KiroSkill.fromDir({
          baseDir: testDir,
          dirName: "test-skill",
        }),
      ).rejects.toThrow(/Frontmatter name \(wrong-name\) must match directory name \(test-skill\)/);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = KiroSkill.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "skills"),
        dirName: "to-delete",
      });

      expect(skill.getDirName()).toBe("to-delete");
    });
  });
});
