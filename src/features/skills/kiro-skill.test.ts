import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroSkill, type KiroSkillFrontmatter } from "./kiro-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

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
      const frontmatter: KiroSkillFrontmatter = {
        name: "test-power",
        description: "Test power description",
      };

      const skill = new KiroSkill({
        dirName: "test-power",
        frontmatter,
        body: "This is a test power body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("This is a test power body");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        name: 123,
        description: true,
      } as unknown as KiroSkillFrontmatter;

      expect(() => {
        new KiroSkill({
          dirName: "invalid-power",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          otherFiles: [],
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidFrontmatter = {
        name: 123,
        description: true,
      } as unknown as KiroSkillFrontmatter;

      expect(() => {
        new KiroSkill({
          dirName: "invalid-power",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          otherFiles: [],
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle displayName and keywords", () => {
      const frontmatter: KiroSkillFrontmatter = {
        name: "supabase",
        displayName: "Supabase with local CLI",
        description: "Build fullstack applications with Supabase",
        keywords: ["database", "postgres", "auth"],
      };

      const skill = new KiroSkill({
        dirName: "supabase",
        frontmatter,
        body: "Power body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter().displayName).toBe("Supabase with local CLI");
      expect(skill.getFrontmatter().keywords).toEqual(["database", "postgres", "auth"]);
    });

    it("should use default relativeDirPath", () => {
      const frontmatter: KiroSkillFrontmatter = {
        name: "test-power",
        description: "Test power",
      };

      const skill = new KiroSkill({
        baseDir: testDir,
        dirName: "test-power",
        frontmatter,
        body: "Test body",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".kiro", "powers", "installed"));
    });
  });

  describe("getSettablePaths", () => {
    it("should return powers installed path for global mode", () => {
      const paths = KiroSkill.getSettablePaths({ global: true });

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "powers", "installed") });
    });

    it("should return powers installed path even without global flag", () => {
      const paths = KiroSkill.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".kiro", "powers", "installed") });
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const frontmatter: KiroSkillFrontmatter = {
        name: "valid-power",
        description: "Valid power description",
      };

      const skill = new KiroSkill({
        dirName: "valid-power",
        frontmatter,
        body: "Valid body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const frontmatter: KiroSkillFrontmatter = {
        name: "test-power",
        description: "Test power description",
      };

      const skill = new KiroSkill({
        baseDir: testDir,
        dirName: "test-power",
        frontmatter,
        body: "Power body content",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter().name).toBe("test-power");
      expect(rulesyncSkill.getFrontmatter().description).toBe("Test power description");
      expect(rulesyncSkill.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncSkill.getBody()).toBe("Power body content");
    });

    it("should preserve displayName and keywords in kiro field", () => {
      const frontmatter: KiroSkillFrontmatter = {
        name: "supabase",
        displayName: "Supabase Power",
        description: "Supabase integration",
        keywords: ["database", "auth"],
      };

      const skill = new KiroSkill({
        baseDir: testDir,
        dirName: "supabase",
        frontmatter,
        body: "Body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect(rulesyncFrontmatter.kiro?.displayName).toBe("Supabase Power");
      expect(rulesyncFrontmatter.kiro?.keywords).toEqual(["database", "auth"]);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create KiroSkill from RulesyncSkill", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-power",
        description: "Test power",
        targets: ["kiro"],
      };

      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "test-power",
        frontmatter: rulesyncFrontmatter,
        body: "Power body",
      });

      const skill = KiroSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(skill).toBeInstanceOf(KiroSkill);
      expect(skill.getFrontmatter().name).toBe("test-power");
      expect(skill.getFrontmatter().description).toBe("Test power");
      expect(skill.getBody()).toBe("Power body");
      expect(skill.getRelativeDirPath()).toBe(join(".kiro", "powers", "installed"));
    });

    it("should preserve kiro-specific fields", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "supabase",
        description: "Supabase integration",
        targets: ["kiro"],
        kiro: {
          displayName: "Supabase Power",
          keywords: ["database", "auth"],
        },
      };

      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "supabase",
        frontmatter: rulesyncFrontmatter,
        body: "Body",
      });

      const skill = KiroSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(skill.getFrontmatter().displayName).toBe("Supabase Power");
      expect(skill.getFrontmatter().keywords).toEqual(["database", "auth"]);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets include kiro", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "test",
        frontmatter: { name: "test", description: "test", targets: ["kiro"] },
        body: "body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets include wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "test",
        frontmatter: { name: "test", description: "test", targets: ["*"] },
        body: "body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets do not include kiro", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "test",
        frontmatter: { name: "test", description: "test", targets: ["claudecode"] },
        body: "body",
      });

      expect(KiroSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load skill from directory with POWER.md", async () => {
      const powerDir = join(testDir, ".kiro", "powers", "installed", "test-power");
      await ensureDir(powerDir);
      const content = `---
name: test-power
description: Test power from file
keywords:
  - test
---

# Power Content

This is the power body.`;
      await writeFileContent(join(powerDir, "POWER.md"), content);

      const skill = await KiroSkill.fromDir({
        baseDir: testDir,
        dirName: "test-power",
      });

      expect(skill).toBeInstanceOf(KiroSkill);
      expect(skill.getFrontmatter().name).toBe("test-power");
      expect(skill.getFrontmatter().description).toBe("Test power from file");
      expect(skill.getFrontmatter().keywords).toEqual(["test"]);
      expect(skill.getBody()).toContain("# Power Content");
    });

    it("should throw error when POWER.md is missing", async () => {
      const powerDir = join(testDir, ".kiro", "powers", "installed", "empty-power");
      await ensureDir(powerDir);

      await expect(
        KiroSkill.fromDir({
          baseDir: testDir,
          dirName: "empty-power",
        }),
      ).rejects.toThrow("POWER.md not found");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = KiroSkill.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "powers", "installed"),
        dirName: "test-power",
      });

      expect(skill).toBeInstanceOf(KiroSkill);
      expect(skill.getDirName()).toBe("test-power");
    });
  });
});
