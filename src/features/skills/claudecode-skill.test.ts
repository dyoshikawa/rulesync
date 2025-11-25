import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileBuffer, writeFileContent } from "../../utils/file.js";
import {
  ClaudecodeSkill,
  type ClaudecodeSkillFrontmatter,
  ClaudecodeSkillFrontmatterSchema,
} from "./claudecode-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("ClaudecodeSkill", () => {
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
    it("should create a ClaudecodeSkill with valid frontmatter and body", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill description",
      };

      const skill = new ClaudecodeSkill({
        dirName: "test-skill",
        frontmatter,
        body: "This is a test skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        name: 123, // Should be string
        description: true, // Should be string
      } as any;

      expect(() => {
        const skill = new ClaudecodeSkill({
          dirName: "invalid-skill",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          otherFiles: [],
        });
        return skill;
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidFrontmatter = {
        name: 123,
        description: true,
      } as any;

      expect(() => {
        const skill = new ClaudecodeSkill({
          dirName: "invalid-skill",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          otherFiles: [],
          validate: false,
        });
        return skill;
      }).not.toThrow();
    });

    it("should handle allowed-tools configuration", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "restricted-skill",
        description: "Skill with tool restrictions",
        "allowed-tools": ["Bash", "Read", "Write"],
      };

      const skill = new ClaudecodeSkill({
        dirName: "restricted-skill",
        frontmatter,
        body: "Restricted skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read", "Write"]);
    });

    it("should use default relativeDirPath", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill",
      };

      const skill = new ClaudecodeSkill({
        baseDir: testDir,
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".claude", "skills"));
    });

    it("should accept custom relativeDirPath", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill",
      };

      const skill = new ClaudecodeSkill({
        baseDir: testDir,
        relativeDirPath: join("custom", "skills"),
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
      });

      expect(skill.getRelativeDirPath()).toBe(join("custom", "skills"));
    });

    it("should support global mode", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "global-skill",
        description: "Global skill",
      };

      const skill = new ClaudecodeSkill({
        dirName: "global-skill",
        frontmatter,
        body: "Global skill body",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "valid-skill",
        description: "Valid skill description",
      };

      const skill = new ClaudecodeSkill({
        dirName: "valid-skill",
        frontmatter,
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

      const skill = new ClaudecodeSkill({
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
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill",
      };

      const skill = new ClaudecodeSkill({
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
        validate: false,
      });

      // Manually set mainFile to undefined to test this edge case
      (skill as any).mainFile = undefined;

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("SKILL.md file does not exist");
    });
  });

  describe("getSettablePaths", () => {
    it("should return default paths", () => {
      const paths = ClaudecodeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".claude", "skills"));
    });

    it("should return same paths for global mode", () => {
      const paths = ClaudecodeSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".claude", "skills"));
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill without allowed-tools", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test description",
      };

      const skill = new ClaudecodeSkill({
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect(rulesyncFrontmatter.name).toBe("test-skill");
      expect(rulesyncFrontmatter.description).toBe("Test description");
      expect(rulesyncFrontmatter.claudecode).toBeUndefined();
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });

    it("should convert to RulesyncSkill with allowed-tools", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "restricted-skill",
        description: "Restricted skill",
        "allowed-tools": ["Bash", "Read"],
      };

      const skill = new ClaudecodeSkill({
        dirName: "restricted-skill",
        frontmatter,
        body: "Restricted body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

      expect(rulesyncFrontmatter.name).toBe("restricted-skill");
      expect(rulesyncFrontmatter.description).toBe("Restricted skill");
      expect(rulesyncFrontmatter.claudecode).toEqual({
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should preserve other files during conversion", () => {
      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill",
      };

      const otherFiles = [
        {
          relativeFilePathToDirPath: "helper.ts",
          fileBuffer: Buffer.from("helper code"),
        },
      ];

      const skill = new ClaudecodeSkill({
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
        otherFiles,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getOtherFiles()).toEqual(otherFiles);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should convert from RulesyncSkill without claudecode config", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test description",
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const frontmatter = claudecodeSkill.getFrontmatter();

      expect(frontmatter.name).toBe("test-skill");
      expect(frontmatter.description).toBe("Test description");
      expect(frontmatter["allowed-tools"]).toBeUndefined();
    });

    it("should convert from RulesyncSkill with claudecode config", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "restricted-skill",
        description: "Restricted skill",
        claudecode: {
          "allowed-tools": ["Bash", "Read"],
        },
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "restricted-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Restricted body",
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const frontmatter = claudecodeSkill.getFrontmatter();

      expect(frontmatter.name).toBe("restricted-skill");
      expect(frontmatter.description).toBe("Restricted skill");
      expect(frontmatter["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("should set correct relativeDirPath", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test skill",
      };

      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        dirName: "test-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(claudecodeSkill.getRelativeDirPath()).toBe(join(".claude", "skills"));
    });

    it("should preserve other files during conversion", () => {
      const otherFiles = [
        {
          relativeFilePathToDirPath: "helper.ts",
          fileBuffer: Buffer.from("helper code"),
        },
      ];

      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test skill",
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
        otherFiles,
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(claudecodeSkill.getOtherFiles()).toEqual(otherFiles);
    });

    it("should skip validation when validate is false", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "valid-skill",
        description: "Valid skill",
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "valid-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: false,
      });

      // Even with validate=false, the skill should be created
      expect(claudecodeSkill).toBeInstanceOf(ClaudecodeSkill);
    });

    it("should support global mode", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "global-skill",
        description: "Global skill",
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "global-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Global body",
        global: true,
      });

      const claudecodeSkill = ClaudecodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(claudecodeSkill.getGlobal()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should always return true for any RulesyncSkill", () => {
      const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test skill",
      };

      const rulesyncSkill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: rulesyncFrontmatter,
        body: "Test body",
      });

      expect(ClaudecodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });
  });

  describe("fromDir", () => {
    it("should load skill from directory", async () => {
      const skillDir = join(testDir, ".claude", "skills", "test-skill");
      await ensureDir(skillDir);

      const frontmatter: ClaudecodeSkillFrontmatter = {
        name: "test-skill",
        description: "Test skill description",
      };

      const content = `---
name: test-skill
description: Test skill description
---

This is the skill body.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      const skill = await ClaudecodeSkill.fromDir({
        baseDir: testDir,
        dirName: "test-skill",
      });

      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("This is the skill body.");
    });

    it("should load skill with allowed-tools", async () => {
      const skillDir = join(testDir, ".claude", "skills", "restricted-skill");
      await ensureDir(skillDir);

      const content = `---
name: restricted-skill
description: Skill with tool restrictions
allowed-tools:
  - Bash
  - Read
  - Write
---

This skill has tool restrictions.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      const skill = await ClaudecodeSkill.fromDir({
        baseDir: testDir,
        dirName: "restricted-skill",
      });

      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read", "Write"]);
    });

    it("should load skill with other files", async () => {
      const skillDir = join(testDir, ".claude", "skills", "multi-file-skill");
      await ensureDir(skillDir);

      const content = `---
name: multi-file-skill
description: Skill with multiple files
---

Main skill content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      await writeFileBuffer(
        join(skillDir, "helper.ts"),
        Buffer.from("export function helper() {}"),
      );

      const skill = await ClaudecodeSkill.fromDir({
        baseDir: testDir,
        dirName: "multi-file-skill",
      });

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(1);
      expect(otherFiles[0]?.relativeFilePathToDirPath).toBe("helper.ts");
      expect(otherFiles[0]?.fileBuffer.toString()).toBe("export function helper() {}");
    });

    it("should throw error when SKILL.md does not exist", async () => {
      const skillDir = join(testDir, ".claude", "skills", "missing-skill");
      await ensureDir(skillDir);

      await expect(
        ClaudecodeSkill.fromDir({
          baseDir: testDir,
          dirName: "missing-skill",
        }),
      ).rejects.toThrow("SKILL.md not found");
    });

    it("should throw error with invalid frontmatter", async () => {
      const skillDir = join(testDir, ".claude", "skills", "invalid-skill");
      await ensureDir(skillDir);

      const content = `---
name: 123
description: true
---

Invalid frontmatter.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      await expect(
        ClaudecodeSkill.fromDir({
          baseDir: testDir,
          dirName: "invalid-skill",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should use custom relativeDirPath when provided", async () => {
      const customPath = join("custom", "skills");
      const skillDir = join(testDir, customPath, "custom-skill");
      await ensureDir(skillDir);

      const content = `---
name: custom-skill
description: Custom path skill
---

Custom path content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      const skill = await ClaudecodeSkill.fromDir({
        baseDir: testDir,
        relativeDirPath: customPath,
        dirName: "custom-skill",
      });

      expect(skill.getRelativeDirPath()).toBe(customPath);
    });

    it("should support global mode", async () => {
      const skillDir = join(testDir, ".claude", "skills", "global-skill");
      await ensureDir(skillDir);

      const content = `---
name: global-skill
description: Global mode skill
---

Global skill content.`;

      await writeFileContent(join(skillDir, SKILL_FILE_NAME), content);

      const skill = await ClaudecodeSkill.fromDir({
        baseDir: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });

  describe("ClaudecodeSkillFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      const validFrontmatter = {
        name: "test-skill",
        description: "Test description",
      };

      const result = ClaudecodeSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });

    it("should validate frontmatter with allowed-tools", () => {
      const validFrontmatter = {
        name: "test-skill",
        description: "Test description",
        "allowed-tools": ["Bash", "Read"],
      };

      const result = ClaudecodeSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });

    it("should reject frontmatter without name", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      const result = ClaudecodeSkillFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {
        name: "test-skill",
      };

      const result = ClaudecodeSkillFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject invalid allowed-tools type", () => {
      const invalidFrontmatter = {
        name: "test-skill",
        description: "Test description",
        "allowed-tools": "not-an-array",
      };

      const result = ClaudecodeSkillFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });
  });
});
