import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { CopilotRule, CopilotRuleFrontmatterSchema } from "./copilot-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CopilotRule", () => {
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
    it("should create instance with basic parameters", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter: {
          description: "Test rule",
          applyTo: "*.js",
        },
        body: "This is a test rule.",
      });

      expect(copilotRule).toBeInstanceOf(CopilotRule);
      expect(copilotRule.getRelativeDirPath()).toBe(".github/instructions");
      expect(copilotRule.getRelativeFilePath()).toBe("test.instructions.md");
      expect(copilotRule.getFrontmatter()).toEqual({
        description: "Test rule",
        applyTo: "*.js",
      });
      expect(copilotRule.getBody()).toBe("This is a test rule.");
    });

    it("should create instance with custom baseDir", () => {
      const customBaseDir = "/custom/path";
      const copilotRule = new CopilotRule({
        baseDir: customBaseDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "custom.instructions.md",
        frontmatter: {
          description: "Custom rule",
        },
        body: "Custom rule content",
      });

      expect(copilotRule.getFilePath()).toBe(
        "/custom/path/.github/instructions/custom.instructions.md",
      );
    });

    it("should create root copilot rule", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter: {
          description: "",
          applyTo: "**",
        },
        body: "Root copilot instructions",
        root: true,
      });

      expect(copilotRule.isRoot()).toBe(true);
      expect(copilotRule.getRelativeDirPath()).toBe(".github");
      expect(copilotRule.getRelativeFilePath()).toBe("copilot-instructions.md");
    });

    it("should validate frontmatter when validation is enabled", () => {
      expect(() => {
        const copilotRule = new CopilotRule({
          baseDir: testDir,
          relativeDirPath: ".github/instructions",
          relativeFilePath: "test.instructions.md",
          frontmatter: {
            description: "Valid rule",
            applyTo: "*.js",
          },
          body: "Valid content",
          validate: true,
        });
        expect(copilotRule).toBeInstanceOf(CopilotRule);
      }).not.toThrow();
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(() => {
        const copilotRule = new CopilotRule({
          baseDir: testDir,
          relativeDirPath: ".github/instructions",
          relativeFilePath: "test.instructions.md",
          frontmatter: {
            description: 123, // Invalid type
          } as any,
          body: "Content",
          validate: true,
        });
        expect(copilotRule).toBeInstanceOf(CopilotRule);
      }).toThrow();
    });

    it("should create instance without validation by default", () => {
      expect(() => {
        const copilotRule = new CopilotRule({
          baseDir: testDir,
          relativeDirPath: ".github/instructions",
          relativeFilePath: "test.instructions.md",
          frontmatter: {
            description: 123, // Invalid type but validation is disabled
          } as any,
          body: "Content",
        });
        expect(copilotRule).toBeInstanceOf(CopilotRule);
      }).not.toThrow();
    });

    it("should create instance with minimal frontmatter", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "minimal.instructions.md",
        frontmatter: {},
        body: "Minimal rule content",
      });

      expect(copilotRule.getFrontmatter()).toEqual({});
      expect(copilotRule.getBody()).toBe("Minimal rule content");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert non-root CopilotRule to RulesyncRule", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter: {
          description: "Test rule",
          applyTo: "*.js",
        },
        body: "Test rule content",
      });

      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter()).toEqual({
        targets: ["*"],
        root: false,
        description: "Test rule",
        globs: ["*.js"],
      });
      expect(rulesyncRule.getBody()).toBe("Test rule content");
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
    });

    it("should strip .instructions.md extension when converting to RulesyncRule", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "example.instructions.md",
        frontmatter: {
          description: "Example rule",
          applyTo: "*.ts",
        },
        body: "Example rule content",
      });

      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("example.md");
    });

    it("should convert root CopilotRule to RulesyncRule", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter: {
          description: "Root rule",
          applyTo: "**",
        },
        body: "Root rule content",
        root: true,
      });

      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter()).toEqual({
        targets: ["*"],
        root: true,
        description: "Root rule",
        globs: ["**/*"],
      });
      expect(rulesyncRule.getBody()).toBe("Root rule content");
    });

    it("should include copilot-specific fields when converting", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter: {
          description: "Root rule",
          applyTo: "**",
          excludeAgent: "code-review",
        },
        body: "Root rule content",
        root: true,
      });

      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().copilot).toEqual({
        excludeAgent: "code-review",
      });
    });

    it("should handle undefined description in frontmatter", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter: {
          applyTo: "*.ts",
        },
        body: "Content without description",
      });

      const rulesyncRule = copilotRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().description).toBeUndefined();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create CopilotRule from non-root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test rule from rulesync",
          globs: ["*.js", "*.ts"],
        },
        body: "Rulesync rule content",
        validate: true,
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(copilotRule.getFrontmatter()).toEqual({
        description: "Test rule from rulesync",
        applyTo: "*.js,*.ts",
      });
      expect(copilotRule.getBody()).toBe("Rulesync rule content");
      expect(copilotRule.getRelativeDirPath()).toBe(".github/instructions");
      expect(copilotRule.getRelativeFilePath()).toBe("test.instructions.md");
      expect(copilotRule.isRoot()).toBe(false);
    });

    it("should create root CopilotRule from root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: {
          targets: ["*"],
          root: true,
          description: "Root rule from rulesync",
          globs: ["**/*"],
        },
        body: "Root rulesync rule content",
        validate: true,
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(copilotRule.getFrontmatter()).toEqual({
        description: "Root rule from rulesync",
        applyTo: "**/*",
      });
      expect(copilotRule.getBody()).toBe("Root rulesync rule content");
      expect(copilotRule.getRelativeDirPath()).toBe(".github");
      expect(copilotRule.getRelativeFilePath()).toBe("copilot-instructions.md");
      expect(copilotRule.isRoot()).toBe(true);
    });

    it("should carry copilot-specific fields from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "root.md",
        frontmatter: {
          targets: ["*"],
          root: true,
          description: "Root rule from rulesync",
          globs: ["**/*"],
          copilot: {
            excludeAgent: "coding-agent",
          },
        },
        body: "Root rulesync rule content",
        validate: true,
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
        validate: true,
      });

      expect(copilotRule.getFrontmatter().excludeAgent).toBe("coding-agent");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test rule",
        },
        body: "Content",
        validate: true,
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(copilotRule.getBaseDir()).toBe(testDir);
    });

    it("should handle RulesyncRule without globs", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          root: false,
          description: "Test rule",
          // globs is undefined
        },
        body: "Content",
        validate: true,
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(copilotRule.getFrontmatter().applyTo).toBeUndefined();
    });
  });

  describe("fromFile", () => {
    it("should create CopilotRule from non-root file", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      const fileContent = `---
description: "Test rule from file"
applyTo: "*.js"
---

This is test rule content from file.`;

      const filePath = join(instructionsDir, "test.instructions.md");
      await writeFileContent(filePath, fileContent);

      const copilotRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.instructions.md",
        validate: true,
      });

      expect(copilotRule.getFrontmatter()).toEqual({
        description: "Test rule from file",
        applyTo: "*.js",
      });
      expect(copilotRule.getBody()).toBe("This is test rule content from file.");
      expect(copilotRule.getRelativeDirPath()).toBe(".github/instructions");
      expect(copilotRule.getRelativeFilePath()).toBe("test.instructions.md");
      expect(copilotRule.isRoot()).toBe(false);
    });

    it("should create root CopilotRule from copilot-instructions.md", async () => {
      const githubDir = join(testDir, ".github");
      await ensureDir(githubDir);

      const rootContent = "This is the root copilot instructions content.";
      const rootFilePath = join(githubDir, "copilot-instructions.md");
      await writeFileContent(rootFilePath, rootContent);

      const copilotRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "copilot-instructions.md",
        validate: true,
      });

      expect(copilotRule.getFrontmatter()).toEqual({});
      expect(copilotRule.getBody()).toBe("This is the root copilot instructions content.");
      expect(copilotRule.getRelativeDirPath()).toBe(".github");
      expect(copilotRule.getRelativeFilePath()).toBe("copilot-instructions.md");
      expect(copilotRule.isRoot()).toBe(true);
    });

    it("should use default baseDir when not provided", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      const fileContent = `---
description: "Test with default baseDir"
---

Content with default baseDir.`;

      const filePath = join(instructionsDir, "default.instructions.md");
      await writeFileContent(filePath, fileContent);

      const copilotRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "default.instructions.md",
      });

      expect(copilotRule.getBaseDir()).toBe(testDir);
    });

    it("should throw error for invalid frontmatter with validation", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      const invalidContent = `---
description: 123
invalid_field: "not allowed"
---

Content with invalid frontmatter.`;

      const filePath = join(instructionsDir, "invalid.instructions.md");
      await writeFileContent(filePath, invalidContent);

      await expect(
        CopilotRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.instructions.md",
          validate: true,
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should handle file without frontmatter", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      const contentWithoutFrontmatter = "Just content without frontmatter.";
      const filePath = join(instructionsDir, "no-frontmatter.instructions.md");
      await writeFileContent(filePath, contentWithoutFrontmatter);

      const copilotRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-frontmatter.instructions.md",
        validate: true,
      });

      expect(copilotRule.getFrontmatter()).toEqual({});
      expect(copilotRule.getBody()).toBe("Just content without frontmatter.");
    });

    it("should trim whitespace from body content", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      const contentWithWhitespace = `---
description: "Test trimming"
---

  Content with leading/trailing whitespace.  

`;

      const filePath = join(instructionsDir, "trim.instructions.md");
      await writeFileContent(filePath, contentWithWhitespace);

      const copilotRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "trim.instructions.md",
      });

      expect(copilotRule.getBody()).toBe("Content with leading/trailing whitespace.");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "valid.instructions.md",
        frontmatter: {
          description: "Valid description",
          applyTo: "*.js",
        },
        body: "Valid content",
      });

      const result = copilotRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty frontmatter", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "empty.instructions.md",
        frontmatter: {},
        body: "Content with empty frontmatter",
      });

      const result = copilotRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "invalid.instructions.md",
        frontmatter: {
          description: 123, // Invalid type
          applyTo: true, // Invalid type
        } as any,
        body: "Content",
        validate: false, // Skip validation in constructor
      });

      const result = copilotRule.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter = {
        description: "Test frontmatter",
        applyTo: "*.ts",
      };

      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter,
        body: "Content",
      });

      expect(copilotRule.getFrontmatter()).toEqual(frontmatter);
      expect(copilotRule.getFrontmatter()).toBe(frontmatter); // Same reference
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const body = "This is the rule body content.";

      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter: {
          description: "Test",
        },
        body,
      });

      expect(copilotRule.getBody()).toBe(body);
      expect(copilotRule.getBody()).toBe(body); // Same reference
    });
  });

  describe("getFileContent", () => {
    it("should omit frontmatter for root rule", () => {
      const body = "This is the root rule content.";
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter: {
          description: "Root rule",
          applyTo: "**",
          excludeAgent: "code-review" as const,
        },
        body,
        root: true,
      });

      const fileContent = copilotRule.getFileContent();
      const { frontmatter: parsedFrontmatter, body: parsedBody } = parseFrontmatter(fileContent);

      expect(parsedFrontmatter).toEqual({});
      expect(parsedBody.trim()).toBe(body);
    });

    it("should return body with frontmatter for non-root rule", () => {
      const body = "This is a non-root rule content.";
      const frontmatter = {
        description: "Non-root rule",
        applyTo: "*.js",
      };
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter,
        body,
        root: false,
      });

      const fileContent = copilotRule.getFileContent();

      // Non-root rule should contain frontmatter
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Non-root rule");
      expect(fileContent).toContain("applyTo: '*.js'"); // YAML uses single quotes
      expect(fileContent).toContain(body);
    });

    it("should handle empty body for root rule", () => {
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter: {
          description: "",
          applyTo: "**",
        },
        body: "",
        root: true,
      });

      const fileContent = copilotRule.getFileContent();
      const { frontmatter, body } = parseFrontmatter(fileContent);

      expect(frontmatter).toEqual({});
      expect(body.trim()).toBe("");
    });

    it("should handle complex frontmatter for non-root rule", () => {
      const body = "Complex rule content.";
      const frontmatter = {
        description: 'This is a "complex" rule with special characters',
        applyTo: "*.ts,*.tsx,*.js,*.jsx",
      };
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "complex.instructions.md",
        frontmatter,
        body,
        root: false,
      });

      const fileContent = copilotRule.getFileContent();

      expect(fileContent).toContain("---");
      // YAML serializer handles quotes
      expect(fileContent).toContain(
        'description: This is a "complex" rule with special characters',
      );
      expect(fileContent).toContain("applyTo: '*.ts,*.tsx,*.js,*.jsx'");
      expect(fileContent).toContain(body);
    });

    it("should handle minimal frontmatter for non-root rule", () => {
      const body = "Minimal rule content.";
      const copilotRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "minimal.instructions.md",
        frontmatter: {},
        body,
        root: false,
      });

      const fileContent = copilotRule.getFileContent();

      // With empty frontmatter, YAML serializer may output just the body
      // or empty frontmatter section. Let's just check that body is present.
      expect(fileContent).toContain(body);
    });
  });

  describe("CopilotRuleFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      const validFrontmatter = {
        description: "Valid description",
        applyTo: "*.js",
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(validFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should validate frontmatter with optional fields missing", () => {
      const minimalFrontmatter = {};

      const result = CopilotRuleFrontmatterSchema.safeParse(minimalFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it("should validate frontmatter with only description", () => {
      const partialFrontmatter = {
        description: "Only description",
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(partialFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(partialFrontmatter);
      }
    });

    it("should validate frontmatter with only applyTo", () => {
      const partialFrontmatter = {
        applyTo: "*.ts",
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(partialFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(partialFrontmatter);
      }
    });

    it("should validate frontmatter with excludeAgent", () => {
      const frontmatterWithExclude = {
        excludeAgent: "coding-agent" as const,
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(frontmatterWithExclude);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(frontmatterWithExclude);
      }
    });

    it("should reject invalid excludeAgent", () => {
      const invalidFrontmatter = {
        excludeAgent: "invalid-agent",
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        description: 123,
        applyTo: true,
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should allow frontmatter with extra fields (zod/mini doesn't have strict mode)", () => {
      const extraFieldsFrontmatter = {
        description: "Valid description",
        applyTo: "*.js",
        extraField: "allowed in zod/mini",
      };

      const result = CopilotRuleFrontmatterSchema.safeParse(extraFieldsFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Valid description");
        expect(result.data.applyTo).toBe("*.js");
        // Extra field is not included in the parsed data
        expect((result.data as any).extraField).toBeUndefined();
      }
    });
  });

  describe("Integration tests", () => {
    it("should create, convert, and validate round-trip with RulesyncRule", () => {
      // Create original CopilotRule
      const originalCopilot = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "integration.instructions.md",
        frontmatter: {
          description: "Integration test rule",
          applyTo: "*.ts,*.js",
        },
        body: "Integration test content",
      });

      // Convert to RulesyncRule
      const rulesyncRule = originalCopilot.toRulesyncRule();

      // Convert back to CopilotRule
      const convertedCopilot = CopilotRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      // Verify the round-trip conversion
      expect(convertedCopilot.getFrontmatter().description).toBe("Integration test rule");
      // applyTo should be preserved through round-trip conversion
      expect(convertedCopilot.getFrontmatter().applyTo).toBe("*.ts,*.js");
      expect(convertedCopilot.getBody()).toBe("Integration test content");
    });

    it("should handle file operations end-to-end", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      await ensureDir(instructionsDir);

      // Create rule from parameters
      const originalRule = new CopilotRule({
        baseDir: testDir,
        relativeDirPath: ".github/instructions",
        relativeFilePath: "e2e.instructions.md",
        frontmatter: {
          description: "End-to-end test rule",
          applyTo: "*.e2e.js",
        },
        body: "End-to-end test content",
      });

      // Write to file using writeFileContent
      await writeFileContent(originalRule.getFilePath(), originalRule.getFileContent());

      // Read back from file
      const loadedRule = await CopilotRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "e2e.instructions.md",
        validate: true,
      });

      // Verify loaded rule matches original
      expect(loadedRule.getFrontmatter()).toEqual(originalRule.getFrontmatter());
      expect(loadedRule.getBody()).toBe(originalRule.getBody());
      expect(loadedRule.getFilePath()).toBe(originalRule.getFilePath());
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting copilot", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["copilot"],
        },
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting copilot", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "agentsmd"],
        },
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including copilot", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot", "agentsmd"],
        },
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(CopilotRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
