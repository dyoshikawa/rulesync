import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, getHomeDirectory, writeFileContent } from "../utils/file.js";
import type { RulesyncSkillFrontmatter } from "./rulesync-skill.js";
import { RulesyncSkill, RulesyncSkillFrontmatterSchema } from "./rulesync-skill.js";

describe("RulesyncSkillFrontmatterSchema", () => {
  it("should accept valid frontmatter with required fields", () => {
    const validFrontmatter = {
      name: "test-skill",
      description: "A test skill",
    };

    expect(() => RulesyncSkillFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
  });

  it("should accept valid frontmatter with claudecode configuration", () => {
    const frontmatterWithClaudeCode = {
      name: "safe-skill",
      description: "A skill with allowed tools",
      claudecode: {
        "allowed-tools": ["Read", "Grep", "Glob"],
      },
    };

    expect(() => RulesyncSkillFrontmatterSchema.parse(frontmatterWithClaudeCode)).not.toThrow();
  });

  it("should accept frontmatter without optional claudecode field", () => {
    const frontmatterWithoutClaudeCode = {
      name: "simple-skill",
      description: "A simple skill",
    };

    expect(() => RulesyncSkillFrontmatterSchema.parse(frontmatterWithoutClaudeCode)).not.toThrow();
  });

  it("should reject frontmatter missing required fields", () => {
    const missingName = {
      description: "A test skill",
    };

    const missingDescription = {
      name: "test-skill",
    };

    expect(() => RulesyncSkillFrontmatterSchema.parse(missingName)).toThrow();
    expect(() => RulesyncSkillFrontmatterSchema.parse(missingDescription)).toThrow();
  });

  it("should accept empty allowed-tools array", () => {
    const emptyAllowedTools = {
      name: "restricted-skill",
      description: "A skill with no tools allowed",
      claudecode: {
        "allowed-tools": [],
      },
    };

    expect(() => RulesyncSkillFrontmatterSchema.parse(emptyAllowedTools)).not.toThrow();
  });
});

describe("RulesyncSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDirectory();
    testDir = setup.testDir;
    cleanup = setup.cleanup;
    // Mock process.cwd() to return the test directory
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const frontmatter: RulesyncSkillFrontmatter = {
        name: "test-skill",
        description: "A test skill",
      };

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/test-skill",
        relativeFilePath: "SKILL.md",
        fileContent: "test content",
        frontmatter,
        body: "Test body content",
        otherSkillFiles: [],
      });

      expect(skill).toBeInstanceOf(RulesyncSkill);
      expect(skill.getFrontmatter()).toEqual(frontmatter);
      expect(skill.getBody()).toBe("Test body content");
      expect(skill.getOtherSkillFiles()).toEqual([]);
    });

    it("should create instance with claudecode configuration", () => {
      const frontmatter: RulesyncSkillFrontmatter = {
        name: "safe-skill",
        description: "A skill with limited tools",
        claudecode: {
          "allowed-tools": ["Read", "Grep"],
        },
      };

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/safe-skill",
        relativeFilePath: "SKILL.md",
        fileContent: "safe content",
        frontmatter,
        body: "Safe skill instructions",
        otherSkillFiles: [],
      });

      expect(skill.getFrontmatter().claudecode?.["allowed-tools"]).toEqual(["Read", "Grep"]);
    });

    it("should create instance with skill files", () => {
      const frontmatter: RulesyncSkillFrontmatter = {
        name: "complex-skill",
        description: "A skill with additional files",
      };

      const otherSkillFiles = [
        {
          relativeDirPath: ".",
          relativeFilePath: "helper.py",
          fileContent: "# Python helper",
          children: [],
        },
        {
          relativeDirPath: "templates",
          relativeFilePath: "template.txt",
          fileContent: "Template content",
          children: [],
        },
      ];

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/complex-skill",
        relativeFilePath: "SKILL.md",
        fileContent: "complex content",
        frontmatter,
        body: "Complex skill instructions",
        otherSkillFiles,
      });

      const files = skill.getOtherSkillFiles();
      expect(files).toHaveLength(2);
      expect(files[0]?.relativeFilePath).toBe("helper.py");
      expect(files[1]?.relativeDirPath).toBe("templates");
    });

    it("should throw error with invalid frontmatter", () => {
      const invalidFrontmatter = {
        name: "invalid-skill",
        // missing description
      };

      expect(() => {
        new RulesyncSkill({
          baseDir: ".",
          relativeDirPath: ".rulesync/skills/invalid-skill",
          relativeFilePath: "SKILL.md",
          fileContent: "invalid content",
          frontmatter: invalidFrontmatter as any,
          body: "Test body",
          otherSkillFiles: [],
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        name: "skip-validation-skill",
        // missing description
      };

      expect(() => {
        new RulesyncSkill({
          baseDir: ".",
          relativeDirPath: ".rulesync/skills/skip-validation-skill",
          relativeFilePath: "SKILL.md",
          fileContent: "content",
          frontmatter: invalidFrontmatter as any,
          body: "Test body",
          otherSkillFiles: [],
          validate: false,
        });
      }).not.toThrow();
    });

    it("should inherit all AiFile functionality", () => {
      const skill = new RulesyncSkill({
        baseDir: "/test",
        relativeDirPath: ".rulesync/skills/inherit-skill",
        relativeFilePath: "SKILL.md",
        fileContent: "inherited content",
        frontmatter: {
          name: "inherit-skill",
          description: "Testing inheritance",
        },
        body: "Inherited body",
        otherSkillFiles: [],
      });

      expect(skill.getBaseDir()).toBe("/test");
      expect(skill.getRelativeDirPath()).toBe(".rulesync/skills/inherit-skill");
      expect(skill.getRelativeFilePath()).toBe("SKILL.md");
      expect(skill.getFileContent()).toBe("inherited content");
      expect(skill.getFilePath()).toBe("/test/.rulesync/skills/inherit-skill/SKILL.md");
      expect(skill.getRelativePathFromCwd()).toBe(".rulesync/skills/inherit-skill/SKILL.md");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncSkillFrontmatter = {
        name: "test-skill",
        description: "A test skill for multiple purposes",
        claudecode: {
          "allowed-tools": ["Read", "Grep", "Glob"],
        },
      };

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/test-skill",
        relativeFilePath: "SKILL.md",
        fileContent: "test content",
        frontmatter,
        body: "Test body",
        otherSkillFiles: [],
      });

      const returnedFrontmatter = skill.getFrontmatter();
      expect(returnedFrontmatter).toEqual(frontmatter);
      expect(returnedFrontmatter.claudecode?.["allowed-tools"]).toEqual(["Read", "Grep", "Glob"]);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const body = "This is the skill body content with instructions.";

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/body-test",
        relativeFilePath: "SKILL.md",
        fileContent: "full content",
        frontmatter: {
          name: "body-test",
          description: "Testing body retrieval",
        },
        body,
        otherSkillFiles: [],
      });

      expect(skill.getBody()).toBe(body);
    });

    it("should handle empty body", () => {
      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/empty-body",
        relativeFilePath: "SKILL.md",
        fileContent: "only frontmatter",
        frontmatter: {
          name: "empty-body",
          description: "Testing empty body",
        },
        body: "",
        otherSkillFiles: [],
      });

      expect(skill.getBody()).toBe("");
    });
  });

  describe("getOtherSkillFiles", () => {
    it("should return empty array when no skill files", () => {
      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/no-files",
        relativeFilePath: "SKILL.md",
        fileContent: "content",
        frontmatter: {
          name: "no-files",
          description: "Skill with no additional files",
        },
        body: "Body",
        otherSkillFiles: [],
      });

      expect(skill.getOtherSkillFiles()).toEqual([]);
    });

    it("should return skill files array", () => {
      const otherSkillFiles = [
        {
          relativeDirPath: "scripts",
          relativeFilePath: "helper.py",
          fileContent: "print('hello')",
          children: [],
        },
      ];

      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/with-files",
        relativeFilePath: "SKILL.md",
        fileContent: "content",
        frontmatter: {
          name: "with-files",
          description: "Skill with files",
        },
        body: "Body",
        otherSkillFiles,
      });

      expect(skill.getOtherSkillFiles()).toEqual(otherSkillFiles);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/valid",
        relativeFilePath: "SKILL.md",
        fileContent: "valid content",
        frontmatter: {
          name: "valid-skill",
          description: "A valid skill",
        },
        body: "Valid body",
        otherSkillFiles: [],
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success when frontmatter is undefined", () => {
      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/undefined",
        relativeFilePath: "SKILL.md",
        fileContent: "content",
        frontmatter: undefined as any,
        body: "body",
        otherSkillFiles: [],
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return error for invalid frontmatter", () => {
      const skill = new RulesyncSkill({
        baseDir: ".",
        relativeDirPath: ".rulesync/skills/invalid-validate",
        relativeFilePath: "SKILL.md",
        fileContent: "invalid content",
        frontmatter: {
          name: "invalid-skill",
          // missing description
        } as any,
        body: "Invalid body",
        otherSkillFiles: [],
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("fromFile - Project Skills", () => {
    it("should create instance from valid Project Skill file", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "test-skill");
      const skillFilePath = join(skillDir, "SKILL.md");
      const fileContent = `---
name: test-skill
description: A skill for testing purposes
claudecode:
  allowed-tools: ["Read", "Grep"]
---
This is the skill body content.

It can contain multiple lines and markdown.`;

      await writeFileContent(skillFilePath, fileContent);

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "test-skill",
      });

      expect(skill).toBeInstanceOf(RulesyncSkill);
      expect(skill.getFrontmatter().name).toBe("test-skill");
      expect(skill.getFrontmatter().description).toBe("A skill for testing purposes");
      expect(skill.getFrontmatter().claudecode?.["allowed-tools"]).toEqual(["Read", "Grep"]);
      expect(skill.getBody()).toBe(
        "This is the skill body content.\n\nIt can contain multiple lines and markdown.",
      );
      expect(skill.getRelativeFilePath()).toBe("SKILL.md");
    });

    it("should create instance with skill files", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "skill-with-files");
      const skillFilePath = join(skillDir, "SKILL.md");
      const helperFilePath = join(skillDir, "helper.py");
      const templateFilePath = join(skillDir, "templates", "template.txt");


      const skillContent = `---
name: skill-with-files
description: A skill with additional files
---
Use the helper script and template.`;

      await writeFileContent(skillFilePath, skillContent);
      await writeFileContent(helperFilePath, "# Python helper script");
      await writeFileContent(templateFilePath, "Template content");

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "skill-with-files",
      });

      expect(skill.getOtherSkillFiles().length).toBeGreaterThan(0);
      const helperFile = skill.getOtherSkillFiles().find((f) => f.relativeFilePath === "helper.py");
      expect(helperFile).toBeDefined();
      if (helperFile) {
        expect(helperFile.fileContent).toBe("# Python helper script");
      }
    });

    it("should exclude SKILL.md from skill files", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "exclude-skill-md");
      const skillFilePath = join(skillDir, "SKILL.md");
      const otherFilePath = join(skillDir, "other.md");


      await writeFileContent(
        skillFilePath,
        `---
name: exclude-skill-md
description: Test SKILL.md exclusion
---
Body`,
      );
      await writeFileContent(otherFilePath, "Other content");

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "exclude-skill-md",
      });

      const otherSkillFiles = skill.getOtherSkillFiles();
      expect(otherSkillFiles.every((f) => f.relativeFilePath !== "SKILL.md")).toBe(true);
      expect(otherSkillFiles.some((f) => f.relativeFilePath === "other.md")).toBe(true);
    });

    it("should throw error for non-existent skill", async () => {
      await expect(
        RulesyncSkill.fromFile({
          relativeFilePath: "SKILL.md",
          skillName: "non-existent-skill",
        }),
      ).rejects.toThrow("SKILL.md not found");
    });

    it("should throw error for invalid frontmatter", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "invalid-skill");
      const skillFilePath = join(skillDir, "SKILL.md");

      const fileContent = `---
name: invalid-skill
# missing description
---
Body`;

      await writeFileContent(skillFilePath, fileContent);

      await expect(
        RulesyncSkill.fromFile({
          relativeFilePath: "SKILL.md",
          skillName: "invalid-skill",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });
  });

  describe("fromFile - Global Skills", () => {
    it("should create instance from valid Global Skill file", async () => {
      const homeDir = getHomeDirectory();
      const skillDir = join(homeDir, ".rulesync", "skills", "global-test-skill");
      const skillFilePath = join(skillDir, "SKILL.md");

      const fileContent = `---
name: global-test-skill
description: A global skill for testing
---
This is a global skill body.`;

      await ensureDir(skillDir);
      await writeFileContent(skillFilePath, fileContent);

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "global-test-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(RulesyncSkill);
      expect(skill.getFrontmatter().name).toBe("global-test-skill");
      expect(skill.getFrontmatter().description).toBe("A global skill for testing");
      expect(skill.getBody()).toBe("This is a global skill body.");
    });

    it("should handle global skill with additional files", async () => {
      const homeDir = getHomeDirectory();
      const skillDir = join(homeDir, ".rulesync", "skills", "global-skill-with-files");
      const skillFilePath = join(skillDir, "SKILL.md");
      const helperFilePath = join(skillDir, "global-helper.sh");

      await ensureDir(skillDir);
      await writeFileContent(
        skillFilePath,
        `---
name: global-skill-with-files
description: Global skill with files
---
Use the helper script.`,
      );
      await writeFileContent(helperFilePath, "#!/bin/bash\necho 'helper'");

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "global-skill-with-files",
        global: true,
      });

      const helperFile = skill
        .getOtherSkillFiles()
        .find((f) => f.relativeFilePath === "global-helper.sh");
      expect(helperFile).toBeDefined();
      if (helperFile) {
        expect(helperFile.fileContent).toContain("#!/bin/bash");
      }
    });
  });

  describe("getSettablePaths", () => {
    it("should return project paths by default", () => {
      const paths = RulesyncSkill.getSettablePaths(false);
      expect(paths.relativeDirPath).toBe(".rulesync/skills");
    });

    it("should return global paths when global=true", () => {
      const paths = RulesyncSkill.getSettablePaths(true);
      const homeDir = getHomeDirectory();
      expect(paths.relativeDirPath).toBe(join(homeDir, ".rulesync", "skills"));
    });
  });

  describe("edge cases", () => {
    it("should handle skill with no additional files", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "minimal-skill");
      const skillFilePath = join(skillDir, "SKILL.md");

      await writeFileContent(
        skillFilePath,
        `---
name: minimal-skill
description: Minimal skill with no extra files
---
Just the basics.`,
      );

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "minimal-skill",
      });

      expect(skill.getOtherSkillFiles()).toEqual([]);
    });

    it("should handle nested directory structures", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "nested-skill");
      const skillFilePath = join(skillDir, "SKILL.md");
      const nestedFilePath = join(skillDir, "deep", "nested", "file.txt");

      await writeFileContent(
        skillFilePath,
        `---
name: nested-skill
description: Skill with nested files
---
Body`,
      );
      await writeFileContent(nestedFilePath, "Nested content");

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "nested-skill",
      });

      const nestedFile = skill.getOtherSkillFiles().find((f) => f.relativeFilePath === "file.txt");
      expect(nestedFile).toBeDefined();
      expect(nestedFile?.relativeDirPath).toContain("deep");
    });

    it("should handle special characters in content", async () => {
      const skillDir = join(testDir, ".rulesync", "skills", "special-chars-skill");
      const skillFilePath = join(skillDir, "SKILL.md");

      const fileContent = `---
name: special-chars-skill
description: "Testing special characters: éñ中文🚀"
---
Body with special characters: éñ中文🚀
Code: \`const x = "hello";\`
Markdown: **bold** _italic_`;

      await writeFileContent(skillFilePath, fileContent);

      const skill = await RulesyncSkill.fromFile({
        relativeFilePath: "SKILL.md",
        skillName: "special-chars-skill",
      });

      expect(skill.getFrontmatter().description).toContain("éñ中文🚀");
      expect(skill.getBody()).toContain("éñ中文🚀");
      expect(skill.getBody()).toContain("**bold**");
    });
  });
});
