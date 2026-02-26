import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  RulesyncSkill,
  type RulesyncSkillFrontmatterInput,
  RulesyncSkillFrontmatterSchema,
  type SkillFile,
} from "./rulesync-skill.js";

describe("RulesyncSkill", () => {
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
    it("should create a RulesyncSkill with valid frontmatter and body", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test skill description",
      };

      const skill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter,
        body: "This is a test skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
        targets: ["*"], // Default value added by z._default
      });
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        name: 123, // Should be string
        description: true, // Should be string
      } as any;

      expect(() => {
        const skill = new RulesyncSkill({
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
        const skill = new RulesyncSkill({
          dirName: "invalid-skill",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          otherFiles: [],
          validate: false,
        });
        return skill;
      }).not.toThrow();
    });

    it("should handle claudecode-specific configuration", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "claudecode-skill",
        description: "Claude Code specific skill",
        claudecode: {
          "allowed-tools": ["Bash", "Read", "Write"],
        },
      };

      const skill = new RulesyncSkill({
        dirName: "claudecode-skill",
        frontmatter,
        body: "Claude Code skill body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter().claudecode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write"],
      });
    });

    it("should handle other skill files", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "complex-skill",
        description: "Skill with additional files",
      };

      const otherFiles: SkillFile[] = [
        {
          relativeFilePathToDirPath: "scripts/search.ts",
          fileBuffer: Buffer.from("console.log('search');"),
        },
        {
          relativeFilePathToDirPath: "utils/helper.ts",
          fileBuffer: Buffer.from("export const helper = () => {};"),
        },
      ];

      const skill = new RulesyncSkill({
        dirName: "complex-skill",
        frontmatter,
        body: "Complex skill body",
        otherFiles,
      });

      expect(skill.getOtherFiles()).toHaveLength(2);
      expect(skill.getOtherFiles()[0]?.relativeFilePathToDirPath).toBe("scripts/search.ts");
      expect(skill.getOtherFiles()[1]?.relativeFilePathToDirPath).toBe("utils/helper.ts");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "Test description",
      };

      const skill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter,
        body: "Test body",
        otherFiles: [],
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test description",
        targets: ["*"], // Default value added by z._default
      });
    });
  });

  describe("getBody", () => {
    it("should return the skill body", () => {
      const body = "This is the skill content\nwith multiple lines";

      const skill = new RulesyncSkill({
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test",
        },
        body,
        otherFiles: [],
      });

      expect(skill.getBody()).toBe(body);
    });
  });

  describe("getOtherFiles", () => {
    it("should return empty array when no other files", () => {
      const skill = new RulesyncSkill({
        dirName: "simple-skill",
        frontmatter: {
          name: "simple-skill",
          description: "Simple skill",
        },
        body: "Simple body",
        otherFiles: [],
      });

      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should return other skill files", () => {
      const otherFiles: SkillFile[] = [
        {
          relativeFilePathToDirPath: "file1.ts",
          fileBuffer: Buffer.from("content1"),
        },
        {
          relativeFilePathToDirPath: "file2.ts",
          fileBuffer: Buffer.from("content2"),
        },
      ];

      const skill = new RulesyncSkill({
        dirName: "multi-file-skill",
        frontmatter: {
          name: "multi-file-skill",
          description: "Skill with multiple files",
        },
        body: "Body",
        otherFiles,
      });

      expect(skill.getOtherFiles()).toEqual(otherFiles);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "valid-skill",
        description: "Valid skill description",
      };

      const skill = new RulesyncSkill({
        dirName: "valid-skill",
        frontmatter,
        body: "Test body",
        otherFiles: [],
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        name: 123, // Should be string
        description: true, // Should be string
      } as any;

      const skill = new RulesyncSkill({
        dirName: "invalid-skill",
        frontmatter: invalidFrontmatter,
        body: "Test body",
        otherFiles: [],
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("Invalid frontmatter");
    });
  });

  describe("getSettablePaths", () => {
    it("should return the correct settable paths", () => {
      const paths = RulesyncSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(RULESYNC_SKILLS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromDir", () => {
    it("should load skill from directory with valid SKILL.md", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "test-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: test-skill
description: Test skill from directory
---

This is the skill body content.
It can span multiple lines.`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      const skill = await RulesyncSkill.fromDir({
        dirName: "test-skill",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill from directory",
        targets: ["*"], // Default value added by z._default
      });
      expect(skill.getBody()).toBe("This is the skill body content.\nIt can span multiple lines.");
      expect(skill.getOtherFiles()).toEqual([]);
    });

    it("should load skill with claudecode configuration", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "claudecode-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: claudecode-skill
description: Claude Code skill
claudecode:
  allowed-tools:
    - Bash
    - Read
    - Write
---

Claude Code skill body`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      const skill = await RulesyncSkill.fromDir({
        dirName: "claudecode-skill",
      });

      expect(skill.getFrontmatter().claudecode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write"],
      });
    });

    it("should load skill with opencode configuration", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "opencode-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: opencode-skill
description: OpenCode skill
opencode:
  allowed-tools:
    - Bash
    - Read
    - Write
---

OpenCode skill body`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      const skill = await RulesyncSkill.fromDir({
        dirName: "opencode-skill",
      });

      expect(skill.getFrontmatter().opencode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write"],
      });
    });

    it("should collect other skill files from directory", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "multi-file-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: multi-file-skill
description: Skill with multiple files
---

Main skill body`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      // Create additional files
      const scriptsDir = join(skillDir, "scripts");
      await ensureDir(scriptsDir);
      await writeFileContent(join(scriptsDir, "search.ts"), "console.log('search');");
      await writeFileContent(join(scriptsDir, "index.ts"), "export * from './search';");

      const utilsDir = join(skillDir, "utils");
      await ensureDir(utilsDir);
      await writeFileContent(join(utilsDir, "helper.ts"), "export const helper = () => {};");

      const skill = await RulesyncSkill.fromDir({
        dirName: "multi-file-skill",
      });

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(3);

      const filePaths = otherFiles.map((f) => f.relativeFilePathToDirPath).toSorted();
      expect(filePaths).toEqual([
        join("scripts", "index.ts"),
        join("scripts", "search.ts"),
        join("utils", "helper.ts"),
      ]);

      const searchFile = otherFiles.find(
        (f) => f.relativeFilePathToDirPath === join("scripts", "search.ts"),
      );
      expect(searchFile?.fileBuffer.toString()).toBe("console.log('search');");
    });

    it("should exclude SKILL.md from other skill files", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "exclude-test");
      await ensureDir(skillDir);

      const skillContent = `---
name: exclude-test
description: Test SKILL.md exclusion
---

Skill body`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      await writeFileContent(join(skillDir, "other.ts"), "content");

      const skill = await RulesyncSkill.fromDir({
        dirName: "exclude-test",
      });

      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(1);
      expect(otherFiles[0]?.relativeFilePathToDirPath).toBe("other.ts");

      const hasSKILLmd = otherFiles.some((f) => f.relativeFilePathToDirPath === SKILL_FILE_NAME);
      expect(hasSKILLmd).toBe(false);
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "missing-skill");
      await ensureDir(skillDir);

      await expect(
        RulesyncSkill.fromDir({
          dirName: "missing-skill",
        }),
      ).rejects.toThrow(`${SKILL_FILE_NAME} not found`);
    });

    it("should throw error for invalid frontmatter", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "invalid-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: 123
description: true
---

Invalid skill`;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      await expect(
        RulesyncSkill.fromDir({
          dirName: "invalid-skill",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should trim whitespace from body content", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "whitespace-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: whitespace-skill
description: Whitespace test
---


This has leading and trailing whitespace.

   `;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      const skill = await RulesyncSkill.fromDir({
        dirName: "whitespace-skill",
      });

      expect(skill.getBody()).toBe("This has leading and trailing whitespace.");
    });
  });

  describe("RulesyncSkillFrontmatterSchema", () => {
    it("should validate valid frontmatter with required fields", () => {
      const frontmatter = {
        name: "test-skill",
        description: "Test description",
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "test-skill",
          description: "Test description",
          targets: ["*"], // Default value added by z._default
        });
      }
    });

    it("should validate frontmatter with claudecode configuration", () => {
      const frontmatter = {
        name: "claudecode-skill",
        description: "Claude Code skill",
        claudecode: {
          "allowed-tools": ["Bash", "Read"],
        },
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claudecode).toEqual({
          "allowed-tools": ["Bash", "Read"],
        });
      }
    });

    it("should validate frontmatter without claudecode field", () => {
      const frontmatter = {
        name: "simple-skill",
        description: "Simple skill",
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claudecode).toBeUndefined();
      }
    });

    it("should reject missing name field", () => {
      const frontmatter = {
        description: "Missing name",
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject missing description field", () => {
      const frontmatter = {
        name: "test-skill",
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject non-string name", () => {
      const frontmatter = {
        name: 123,
        description: "Test",
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject non-string description", () => {
      const frontmatter = {
        name: "test-skill",
        description: 123,
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject invalid claudecode configuration", () => {
      const frontmatter = {
        name: "test-skill",
        description: "Test",
        claudecode: {
          "allowed-tools": "not-array",
        },
      };

      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });
  });

  describe("integration", () => {
    it("should create and validate a complete skill workflow", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const skillDir = join(skillsDir, "integration-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: integration-skill
description: "Comprehensive integration test skill"
claudecode:
  allowed-tools:
    - Bash
    - Read
    - Write
    - Grep
---

# Integration Test Skill

This skill demonstrates comprehensive functionality:

1. **Complete frontmatter**: All supported fields
2. **Additional files**: Scripts and utilities
3. **Claude Code configuration**: Specific tool restrictions

## Usage

\`\`\`typescript
// Example usage
import { helper } from './utils/helper';

helper();
\`\`\``;

      const skillFilePath = join(skillDir, SKILL_FILE_NAME);
      await writeFileContent(skillFilePath, skillContent);

      // Create additional files
      const scriptsDir = join(skillDir, "scripts");
      await ensureDir(scriptsDir);
      await writeFileContent(
        join(scriptsDir, "main.ts"),
        "export const main = () => console.log('main');",
      );

      const utilsDir = join(skillDir, "utils");
      await ensureDir(utilsDir);
      await writeFileContent(join(utilsDir, "helper.ts"), "export const helper = () => {};");

      const skill = await RulesyncSkill.fromDir({
        dirName: "integration-skill",
      });

      // Validate frontmatter
      expect(skill.getFrontmatter().name).toBe("integration-skill");
      expect(skill.getFrontmatter().description).toBe("Comprehensive integration test skill");
      expect(skill.getFrontmatter().claudecode).toEqual({
        "allowed-tools": ["Bash", "Read", "Write", "Grep"],
      });

      // Validate body content
      const body = skill.getBody();
      expect(body).toContain("# Integration Test Skill");
      expect(body).toContain("Example usage");

      // Validate other files
      const otherFiles = skill.getOtherFiles();
      expect(otherFiles).toHaveLength(2);

      const filePaths = otherFiles.map((f) => f.relativeFilePathToDirPath).toSorted();
      expect(filePaths).toEqual([join("scripts", "main.ts"), join("utils", "helper.ts")]);

      // Test validation
      const validationResult = skill.validate();
      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBeNull();

      // Test that the skill can be recreated with constructor
      const recreatedSkill = new RulesyncSkill({
        dirName: "integration-skill",
        frontmatter: skill.getFrontmatter(),
        body: skill.getBody(),
        otherFiles: skill.getOtherFiles(),
      });

      expect(recreatedSkill.getFrontmatter()).toEqual(skill.getFrontmatter());
      expect(recreatedSkill.getBody()).toBe(skill.getBody());
      expect(recreatedSkill.getOtherFiles()).toEqual(skill.getOtherFiles());
    });
  });
});
