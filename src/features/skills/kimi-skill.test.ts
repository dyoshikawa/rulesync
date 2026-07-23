import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileBuffer, writeFileContent } from "../../utils/file.js";
import { KimiSkill, type KimiSkillFrontmatter, KimiSkillFrontmatterSchema } from "./kimi-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("KimiSkill", () => {
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
    it("should create a KimiSkill with valid frontmatter and body", () => {
      const frontmatter: KimiSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill description",
      };

      const skill = new KimiSkill({
        dirName: "test-skill",
        frontmatter,
        body: "This is a test skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should use default project relativeDirPath", () => {
      const skill = new KimiSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".kimi-code", "skills"));
    });

    it("should support global mode", () => {
      const skill = new KimiSkill({
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global skill" },
        body: "Global skill body",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project skills dir", () => {
      const paths = KimiSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".kimi-code", "skills"));
      expect(paths.alternativeSkillRoots).toBeUndefined();
    });

    it("should return the global .agents skills dir", () => {
      const paths = KimiSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const skill = new KimiSkill({
        dirName: "valid-skill",
        frontmatter: { name: "valid-skill", description: "Valid skill description" },
        body: "Valid body",
        validate: false,
      });

      expect(skill.validate().success).toBe(true);
    });

    it("should fail validation with invalid frontmatter", () => {
      const skill = new KimiSkill({
        dirName: "invalid-skill",
        frontmatter: { name: 123, description: true } as any,
        body: "Test body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should throw on missing required fields in the constructor", () => {
      expect(() => {
        return new KimiSkill({
          dirName: "missing-fields",
          frontmatter: { name: 123, description: true } as any,
          body: "Test body",
        });
      }).toThrow();
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create <name>/SKILL.md with name and description", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test description" },
        body: "Test body",
      });

      const kimiSkill = KimiSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = kimiSkill.getFrontmatter();

      expect(frontmatter.name).toBe("test-skill");
      expect(frontmatter.description).toBe("Test description");
      expect(kimiSkill.getRelativeDirPath()).toBe(join(".kimi-code", "skills"));

      const mainFile = kimiSkill.getMainFile();
      expect(mainFile?.name).toBe(SKILL_FILE_NAME);
      expect(kimiSkill.getBody()).toBe("Test body");
    });

    it("should map kimi section fields into frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "full-skill",
        frontmatter: {
          name: "full-skill",
          description: "Full skill",
          kimi: {
            priority: 5,
            paths: ["src/**/*.ts"],
            "user-invocable": true,
            "disable-model-invocation": false,
          },
        } as RulesyncSkillFrontmatterInput,
        body: "Full body",
      });

      const kimiSkill = KimiSkill.fromRulesyncSkill({ rulesyncSkill });
      const frontmatter = kimiSkill.getFrontmatter();

      expect(frontmatter.priority).toBe(5);
      expect(frontmatter.paths).toEqual(["src/**/*.ts"]);
      expect(frontmatter["user-invocable"]).toBe(true);
      expect(frontmatter["disable-model-invocation"]).toBe(false);
    });

    it("should write into the global .agents/skills dir in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global skill" },
        body: "Global body",
        global: true,
      });

      const kimiSkill = KimiSkill.fromRulesyncSkill({ rulesyncSkill, global: true });

      expect(kimiSkill.getGlobal()).toBe(true);
      expect(kimiSkill.getRelativeDirPath()).toBe(join(".agents", "skills"));
    });

    it("should let kimi disable-model-invocation override the root-level value", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "override",
        frontmatter: {
          name: "override",
          description: "Kimi opts out",
          "disable-model-invocation": true,
          kimi: { "disable-model-invocation": false },
        } as RulesyncSkillFrontmatterInput,
        body: "Body",
      });

      const kimiSkill = KimiSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(kimiSkill.getFrontmatter()["disable-model-invocation"]).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill without a kimi section", () => {
      const skill = new KimiSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test description" },
        body: "Test body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect(rulesyncFrontmatter.name).toBe("test-skill");
      expect(rulesyncFrontmatter.description).toBe("Test description");
      expect((rulesyncFrontmatter as { kimi?: unknown }).kimi).toBeUndefined();
    });

    it("should convert to RulesyncSkill with a kimi section", () => {
      const skill = new KimiSkill({
        dirName: "full-skill",
        frontmatter: {
          name: "full-skill",
          description: "Full skill",
          priority: 3,
          paths: "src/**/*.ts",
          "user-invocable": false,
          "disable-model-invocation": true,
        },
        body: "Full body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect((rulesyncSkill.getFrontmatter() as { kimi?: unknown }).kimi).toEqual({
        priority: 3,
        paths: "src/**/*.ts",
        "user-invocable": false,
        "disable-model-invocation": true,
      });
    });

    it("should round-trip kimi fields", () => {
      const original = new KimiSkill({
        dirName: "round-trip",
        frontmatter: {
          name: "round-trip",
          description: "Round trip",
          priority: 7,
          paths: ["a/**", "b/**"],
          "user-invocable": true,
          "disable-model-invocation": false,
        },
        body: "Round trip body",
      });

      const rulesyncSkill = original.toRulesyncSkill();
      const restored = KimiSkill.fromRulesyncSkill({ rulesyncSkill });
      const fm = restored.getFrontmatter();

      expect(fm.name).toBe("round-trip");
      expect(fm.priority).toBe(7);
      expect(fm.paths).toEqual(["a/**", "b/**"]);
      expect(fm["user-invocable"]).toBe(true);
      expect(fm["disable-model-invocation"]).toBe(false);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target when targets includes *", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
      });

      expect(KimiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should target when targets includes kimi", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "kimi-skill",
        frontmatter: { name: "kimi-skill", description: "Kimi skill", targets: ["kimi"] },
        body: "Body",
      });

      expect(KimiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should not target when targets excludes kimi", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "cursor-skill",
        frontmatter: { name: "cursor-skill", description: "Cursor skill", targets: ["cursor"] },
        body: "Body",
      });

      expect(KimiSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load skill from directory", async () => {
      const skillDir = join(testDir, ".kimi-code", "skills", "test-skill");
      await ensureDir(skillDir);

      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: test-skill
description: Test skill description
---

This is the skill body.`,
      );

      const skill = await KimiSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is the skill body.");
    });

    it("should load skill with kimi fields and other files", async () => {
      const skillDir = join(testDir, ".kimi-code", "skills", "multi-file-skill");
      await ensureDir(skillDir);

      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: multi-file-skill
description: Skill with multiple files
priority: 2
paths:
  - src/**/*.ts
user-invocable: true
disable-model-invocation: false
---

Main skill content.`,
      );
      await writeFileBuffer(
        join(skillDir, "helper.ts"),
        Buffer.from("export function helper() {}"),
      );

      const skill = await KimiSkill.fromDir({ outputRoot: testDir, dirName: "multi-file-skill" });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.priority).toBe(2);
      expect(frontmatter.paths).toEqual(["src/**/*.ts"]);

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(1);
      expect(otherFiles[0]?.relativeFilePathToDirPath).toBe("helper.ts");
    });

    it("should throw error with invalid frontmatter", async () => {
      const skillDir = join(testDir, ".kimi-code", "skills", "invalid-skill");
      await ensureDir(skillDir);

      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: 123
description: true
---

Invalid frontmatter.`,
      );

      await expect(
        KimiSkill.fromDir({ outputRoot: testDir, dirName: "invalid-skill" }),
      ).rejects.toThrow("Invalid frontmatter");
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const skill = KimiSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".kimi-code", "skills"),
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(KimiSkill);
      expect(skill.getDirName()).toBe("to-delete");
    });
  });

  describe("KimiSkillFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      expect(KimiSkillFrontmatterSchema.safeParse({ name: "s", description: "d" }).success).toBe(
        true,
      );
    });

    it("should reject frontmatter without name", () => {
      expect(KimiSkillFrontmatterSchema.safeParse({ description: "d" }).success).toBe(false);
    });

    it("should reject non-number priority", () => {
      expect(
        KimiSkillFrontmatterSchema.safeParse({ name: "s", description: "d", priority: "high" })
          .success,
      ).toBe(false);
    });
  });
});
