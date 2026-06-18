import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileBuffer, writeFileContent } from "../../utils/file.js";
import {
  QwencodeSkill,
  type QwencodeSkillFrontmatter,
  QwencodeSkillFrontmatterSchema,
} from "./qwencode-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("QwencodeSkill", () => {
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
    it("should create a QwencodeSkill with valid frontmatter and body", () => {
      const frontmatter: QwencodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill description",
      };

      const skill = new QwencodeSkill({
        dirName: "test-skill",
        frontmatter,
        body: "This is a test skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should use default relativeDirPath", () => {
      const skill = new QwencodeSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".qwen", "skills"));
    });

    it("should support global mode", () => {
      const skill = new QwencodeSkill({
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global skill" },
        body: "Global skill body",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });

  describe("getSettablePaths", () => {
    it("should return default paths without alternative roots", () => {
      const paths = QwencodeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".qwen", "skills"));
      expect(paths.alternativeSkillRoots).toBeUndefined();
    });

    it("should return same paths for global mode", () => {
      const paths = QwencodeSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".qwen", "skills"));
      expect(paths.alternativeSkillRoots).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const skill = new QwencodeSkill({
        dirName: "valid-skill",
        frontmatter: { name: "valid-skill", description: "Valid skill description" },
        body: "Valid body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation with invalid frontmatter", () => {
      const invalidFrontmatter = {
        name: 123,
        description: true,
      } as any;

      const skill = new QwencodeSkill({
        dirName: "invalid-skill",
        frontmatter: invalidFrontmatter,
        body: "Test body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should fail validation when mainFile is undefined", () => {
      const skill = new QwencodeSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
        validate: false,
      });

      (skill as any).mainFile = undefined;

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("SKILL.md file does not exist");
    });

    it("should throw on missing required fields in the constructor", () => {
      expect(() => {
        const skill = new QwencodeSkill({
          dirName: "missing-fields",
          frontmatter: { name: 123, description: true } as any,
          body: "Test body",
        });
        return skill;
      }).toThrow();
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create <name>/SKILL.md with name and description", async () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test description",
      };

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });
      const frontmatter = qwencodeSkill.getFrontmatter();

      expect(frontmatter.name).toBe("test-skill");
      expect(frontmatter.description).toBe("Test description");
      expect(qwencodeSkill.getRelativeDirPath()).toBe(join(".qwen", "skills"));

      // The main file is SKILL.md and carries name + description.
      const mainFile = qwencodeSkill.getMainFile();
      expect(mainFile?.name).toBe(SKILL_FILE_NAME);
      expect(mainFile?.frontmatter).toMatchObject({
        name: "test-skill",
        description: "Test description",
      });
      expect(qwencodeSkill.getBody()).toBe("Test body");
    });

    it("should map qwencode section fields into frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "full-skill",
        frontmatter: {
          name: "full-skill",
          description: "Full skill",
          qwencode: {
            priority: 5,
            paths: ["src/**/*.ts"],
            "user-invocable": true,
            "disable-model-invocation": false,
          },
        } as RulesyncSkillFrontmatterInput,
        body: "Full body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const frontmatter = qwencodeSkill.getFrontmatter();

      expect(frontmatter.priority).toBe(5);
      expect(frontmatter.paths).toEqual(["src/**/*.ts"]);
      expect(frontmatter["user-invocable"]).toBe(true);
      expect(frontmatter["disable-model-invocation"]).toBe(false);
    });

    it("should prefer rulesync name and description", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "no-section",
        frontmatter: { name: "no-section", description: "No section" },
        body: "Body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const frontmatter = qwencodeSkill.getFrontmatter();

      expect(frontmatter.name).toBe("no-section");
      expect(frontmatter.description).toBe("No section");
      expect(frontmatter.priority).toBeUndefined();
      expect(frontmatter.paths).toBeUndefined();
    });

    it("should support global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global skill" },
        body: "Global body",
        global: true,
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(qwencodeSkill.getGlobal()).toBe(true);
    });

    it("should pick up root-level disable-model-invocation when qwencode section omits it", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "root-default",
        frontmatter: {
          name: "root-default",
          description: "Root flag",
          "disable-model-invocation": true,
        },
        body: "Body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(qwencodeSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should let qwencode disable-model-invocation override the root-level value", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "override",
        frontmatter: {
          name: "override",
          description: "Qwencode opts out",
          "disable-model-invocation": true,
          qwencode: { "disable-model-invocation": false },
        } as RulesyncSkillFrontmatterInput,
        body: "Body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(qwencodeSkill.getFrontmatter()["disable-model-invocation"]).toBe(false);
    });

    it("should omit disable-model-invocation when neither root nor qwencode set it", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "no-flag",
        frontmatter: { name: "no-flag", description: "No flag" },
        body: "Body",
      });

      const qwencodeSkill = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(qwencodeSkill.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill without a qwencode section", () => {
      const skill = new QwencodeSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test description" },
        body: "Test body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect(rulesyncFrontmatter.name).toBe("test-skill");
      expect(rulesyncFrontmatter.description).toBe("Test description");
      expect((rulesyncFrontmatter as { qwencode?: unknown }).qwencode).toBeUndefined();
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });

    it("should convert to RulesyncSkill with a qwencode section", () => {
      const skill = new QwencodeSkill({
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
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect((rulesyncFrontmatter as { qwencode?: unknown }).qwencode).toEqual({
        priority: 3,
        paths: "src/**/*.ts",
        "user-invocable": false,
        "disable-model-invocation": true,
      });
    });

    it("should round-trip qwencode fields", () => {
      const original = new QwencodeSkill({
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
      const restored = QwencodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const fm = restored.getFrontmatter();

      expect(fm.name).toBe("round-trip");
      expect(fm.description).toBe("Round trip");
      expect(fm.priority).toBe(7);
      expect(fm.paths).toEqual(["a/**", "b/**"]);
      expect(fm["user-invocable"]).toBe(true);
      expect(fm["disable-model-invocation"]).toBe(false);
    });

    it("should preserve other files during conversion", () => {
      const otherFiles = [
        {
          relativeFilePathToDirPath: "helper.ts",
          fileBuffer: Buffer.from("helper code"),
        },
      ];

      const skill = new QwencodeSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
        otherFiles,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getOtherFiles()).toEqual(otherFiles);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target when targets includes *", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "Test skill" },
        body: "Test body",
      });

      expect(QwencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should target when targets includes qwencode", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "qwen-skill",
        frontmatter: {
          name: "qwen-skill",
          description: "Qwen skill",
          targets: ["qwencode"],
        },
        body: "Body",
      });

      expect(QwencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should not target when targets excludes qwencode", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "cursor-skill",
        frontmatter: {
          name: "cursor-skill",
          description: "Cursor skill",
          targets: ["cursor"],
        },
        body: "Body",
      });

      expect(QwencodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load skill from directory", async () => {
      const skillDir = join(testDir, ".qwen", "skills", "test-skill");
      await ensureDir(skillDir);

      const content = `---
name: test-skill
description: Test skill description
---

This is the skill body.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      const skill = await QwencodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
      expect(skill.getBody()).toBe("This is the skill body.");
    });

    it("should load skill with qwencode fields and other files", async () => {
      const skillDir = join(testDir, ".qwen", "skills", "multi-file-skill");
      await ensureDir(skillDir);

      const content = `---
name: multi-file-skill
description: Skill with multiple files
priority: 2
paths:
  - src/**/*.ts
user-invocable: true
disable-model-invocation: false
---

Main skill content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);
      await writeFileBuffer(
        join(skillDir, "helper.ts"),
        Buffer.from("export function helper() {}"),
      );

      const skill = await QwencodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "multi-file-skill",
      });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.priority).toBe(2);
      expect(frontmatter.paths).toEqual(["src/**/*.ts"]);
      expect(frontmatter["user-invocable"]).toBe(true);
      expect(frontmatter["disable-model-invocation"]).toBe(false);

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(1);
      expect(otherFiles[0]?.relativeFilePathToDirPath).toBe("helper.ts");
      expect(otherFiles[0]?.fileBuffer.toString()).toBe("export function helper() {}");
    });

    it("should throw error when SKILL.md does not exist", async () => {
      const skillDir = join(testDir, ".qwen", "skills", "missing-skill");
      await ensureDir(skillDir);

      await expect(
        QwencodeSkill.fromDir({
          outputRoot: testDir,
          dirName: "missing-skill",
        }),
      ).rejects.toThrow("SKILL.md not found");
    });

    it("should throw error with invalid frontmatter", async () => {
      const skillDir = join(testDir, ".qwen", "skills", "invalid-skill");
      await ensureDir(skillDir);

      const content = `---
name: 123
description: true
---

Invalid frontmatter.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      await expect(
        QwencodeSkill.fromDir({
          outputRoot: testDir,
          dirName: "invalid-skill",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const skill = QwencodeSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".qwen", "skills"),
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(QwencodeSkill);
      expect(skill.getDirName()).toBe("to-delete");
    });
  });

  describe("QwencodeSkillFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      const result = QwencodeSkillFrontmatterSchema.safeParse({
        name: "test-skill",
        description: "Test description",
      });
      expect(result.success).toBe(true);
    });

    it("should reject frontmatter without name", () => {
      const result = QwencodeSkillFrontmatterSchema.safeParse({
        description: "Test description",
      });
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter without description", () => {
      const result = QwencodeSkillFrontmatterSchema.safeParse({
        name: "test-skill",
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-number priority", () => {
      const result = QwencodeSkillFrontmatterSchema.safeParse({
        name: "test-skill",
        description: "Test",
        priority: "high",
      });
      expect(result.success).toBe(false);
    });

    it("should validate paths as string or array", () => {
      expect(
        QwencodeSkillFrontmatterSchema.safeParse({
          name: "test-skill",
          description: "Test",
          paths: "src/**/*.ts",
        }).success,
      ).toBe(true);
      expect(
        QwencodeSkillFrontmatterSchema.safeParse({
          name: "test-skill",
          description: "Test",
          paths: ["src/**/*.ts"],
        }).success,
      ).toBe(true);
    });
  });
});
