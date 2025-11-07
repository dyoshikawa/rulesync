import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import type { RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  RulesyncSubagent,
  RulesyncSubagentFrontmatterSchema,
  RulesyncSubagentModelSchema,
} from "./rulesync-subagent.js";

describe("RulesyncSubagentModelSchema", () => {
  it("should accept valid model values", () => {
    expect(() => RulesyncSubagentModelSchema.parse("opus")).not.toThrow();
    expect(() => RulesyncSubagentModelSchema.parse("sonnet")).not.toThrow();
    expect(() => RulesyncSubagentModelSchema.parse("haiku")).not.toThrow();
    expect(() => RulesyncSubagentModelSchema.parse("inherit")).not.toThrow();
  });

  it("should reject invalid model values", () => {
    expect(() => RulesyncSubagentModelSchema.parse("invalid")).toThrow();
    expect(() => RulesyncSubagentModelSchema.parse("")).toThrow();
    expect(() => RulesyncSubagentModelSchema.parse(null)).toThrow();
    expect(() => RulesyncSubagentModelSchema.parse(undefined)).toThrow();
  });
});

describe("RulesyncSubagentFrontmatterSchema", () => {
  it("should accept valid frontmatter with required fields", () => {
    const validFrontmatter = {
      targets: ["*"],
      name: "test-subagent",
      description: "A test subagent",
    };

    expect(() => RulesyncSubagentFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
  });

  it("should accept valid frontmatter with claudecode configuration", () => {
    const frontmatterWithClaudeCode = {
      targets: ["cursor"],
      name: "cursor-subagent",
      description: "A subagent for Cursor",
      claudecode: {
        model: "sonnet",
      },
    };

    expect(() => RulesyncSubagentFrontmatterSchema.parse(frontmatterWithClaudeCode)).not.toThrow();
  });

  it("should accept frontmatter without optional claudecode field", () => {
    const frontmatterWithoutClaudeCode = {
      targets: ["copilot"],
      name: "copilot-subagent",
      description: "A subagent for GitHub Copilot",
    };

    expect(() =>
      RulesyncSubagentFrontmatterSchema.parse(frontmatterWithoutClaudeCode),
    ).not.toThrow();
  });

  it("should reject frontmatter missing required fields", () => {
    const missingName = {
      targets: ["*"],
      description: "A test subagent",
    };

    const missingDescription = {
      targets: ["*"],
      name: "test-subagent",
    };

    const missingTargets = {
      name: "test-subagent",
      description: "A test subagent",
    };

    expect(() => RulesyncSubagentFrontmatterSchema.parse(missingName)).toThrow();
    expect(() => RulesyncSubagentFrontmatterSchema.parse(missingDescription)).toThrow();
    expect(() => RulesyncSubagentFrontmatterSchema.parse(missingTargets)).toThrow();
  });

  it("should reject frontmatter with invalid claudecode model", () => {
    const invalidClaudeCodeModel = {
      targets: ["*"],
      name: "test-subagent",
      description: "A test subagent",
      claudecode: {
        model: "invalid-model",
      },
    };

    expect(() => RulesyncSubagentFrontmatterSchema.parse(invalidClaudeCodeModel)).toThrow();
  });
});

describe("RulesyncSubagent", () => {
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const setup = await setupTestDirectory();
    cleanup = setup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["*"],
        name: "test-subagent",
        description: "A test subagent",
      };

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "test content",
        frontmatter,
        body: "Test body content",
      });

      expect(subagent).toBeInstanceOf(RulesyncSubagent);
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe("Test body content");
    });

    it("should create instance with claudecode configuration", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "claude-subagent",
        description: "A Claude Code subagent",
        claudecode: {
          model: "opus",
        },
      };

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "claude.md",
        fileContent: "claude content",
        frontmatter,
        body: "Claude specific instructions",
      });

      expect(subagent.getFrontmatter().claudecode?.model).toBe("opus");
    });

    it("should throw error with invalid frontmatter", () => {
      const invalidFrontmatter = {
        targets: ["*"],
        name: "test-subagent",
        // missing description
      };

      expect(() => {
        const _instance = new RulesyncSubagent({
          baseDir: ".",
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "invalid.md",
          fileContent: "invalid content",
          frontmatter: invalidFrontmatter as any,
          body: "Test body",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        targets: ["*"],
        name: "test-subagent",
        // missing description
      };

      expect(() => {
        const _instance = new RulesyncSubagent({
          baseDir: ".",
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "skip-validation.md",
          fileContent: "content",
          frontmatter: invalidFrontmatter as any,
          body: "Test body",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should inherit all AiFile functionality", () => {
      const subagent = new RulesyncSubagent({
        baseDir: "/test",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "inherit.md",
        fileContent: "inherited content",
        frontmatter: {
          targets: ["*"],
          name: "inherit-subagent",
          description: "Testing inheritance",
        },
        body: "Inherited body",
      });

      expect(subagent.getBaseDir()).toBe("/test");
      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(subagent.getRelativeFilePath()).toBe("inherit.md");
      expect(subagent.getFileContent()).toBe("inherited content");
      expect(subagent.getFilePath()).toBe("/test/.rulesync/subagents/inherit.md");
      expect(subagent.getRelativePathFromCwd()).toBe(".rulesync/subagents/inherit.md");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["cursor", "copilot"],
        name: "multi-tool-subagent",
        description: "A subagent for multiple tools",
        claudecode: {
          model: "haiku",
        },
      };

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "multi.md",
        fileContent: "multi content",
        frontmatter,
        body: "Multi tool body",
      });

      const returnedFrontmatter = subagent.getFrontmatter();
      expect(returnedFrontmatter).toEqual(frontmatter);
      expect(returnedFrontmatter.targets).toEqual(["cursor", "copilot"]);
      expect(returnedFrontmatter.claudecode?.model).toBe("haiku");
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const body = "This is the subagent body content with instructions.";

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "body-test.md",
        fileContent: "full content",
        frontmatter: {
          targets: ["*"],
          name: "body-test",
          description: "Testing body retrieval",
        },
        body,
      });

      expect(subagent.getBody()).toBe(body);
    });

    it("should handle empty body", () => {
      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "empty-body.md",
        fileContent: "only frontmatter",
        frontmatter: {
          targets: ["*"],
          name: "empty-body",
          description: "Testing empty body",
        },
        body: "",
      });

      expect(subagent.getBody()).toBe("");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "valid.md",
        fileContent: "valid content",
        frontmatter: {
          targets: ["*"],
          name: "valid-subagent",
          description: "A valid subagent",
        },
        body: "Valid body",
        validate: false, // Skip validation in constructor for testing
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success when frontmatter is undefined", () => {
      // Create a subagent with invalid frontmatter but skip validation
      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "undefined.md",
        fileContent: "content",
        frontmatter: undefined as any,
        body: "body",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return error for invalid frontmatter", () => {
      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "invalid-validate.md",
        fileContent: "invalid content",
        frontmatter: {
          targets: ["*"],
          name: "invalid-subagent",
          // missing description
        } as any,
        body: "Invalid body",
        validate: false, // Skip validation in constructor for testing
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("fromFile", () => {
    let createdFiles: string[] = [];

    afterEach(async () => {
      // Clean up any created test files
      for (const filePath of createdFiles) {
        try {
          await import("node:fs/promises").then((fs) => fs.unlink(filePath));
        } catch {
          // Ignore cleanup errors
        }
      }
      createdFiles = [];
    });

    it("should create instance from valid file", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-valid.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: file-subagent
description: A subagent loaded from file
claudecode:
  model: sonnet
---
This is the body content from the file.

It can contain multiple lines and markdown.`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-valid.md",
      });

      expect(subagent).toBeInstanceOf(RulesyncSubagent);
      expect(subagent.getFrontmatter().name).toBe("file-subagent");
      expect(subagent.getFrontmatter().description).toBe("A subagent loaded from file");
      expect(subagent.getFrontmatter().targets).toEqual(["*"]);
      expect(subagent.getFrontmatter().claudecode?.model).toBe("sonnet");
      expect(subagent.getBody()).toBe(
        "This is the body content from the file.\n\nIt can contain multiple lines and markdown.",
      );
      expect(subagent.getRelativeFilePath()).toBe("test-fromfile-valid.md");
      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
    });

    it("should handle file with minimal frontmatter", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-minimal.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["cursor"]
name: minimal-subagent
description: Minimal configuration
---
Simple body content.`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-minimal.md",
      });

      expect(subagent.getFrontmatter().name).toBe("minimal-subagent");
      expect(subagent.getFrontmatter().claudecode).toBeUndefined();
      expect(subagent.getBody()).toBe("Simple body content.");
    });

    it("should use basename for relativeFilePath", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-nested.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: nested-subagent
description: Nested subagent
---
Nested content.`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-nested.md",
      });

      expect(subagent.getRelativeFilePath()).toBe("test-fromfile-nested.md");
      expect(basename("test-fromfile-nested.md")).toBe("test-fromfile-nested.md");
    });

    it("should throw error for invalid frontmatter in file", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-invalid.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: invalid-subagent
# missing description
---
Invalid content.`;

      await writeFileContent(filePath, fileContent);

      await expect(
        RulesyncSubagent.fromFile({
          relativeFilePath: "test-fromfile-invalid.md",
        }),
      ).rejects.toThrow("Invalid frontmatter in test-fromfile-invalid.md:");
    });

    it("should throw error for non-existent file", async () => {
      await expect(
        RulesyncSubagent.fromFile({
          relativeFilePath: "non-existent.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle files with different target configurations", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-multitarget.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["cursor", "copilot", "cline"]
name: multi-target-subagent
description: A subagent targeting multiple tools
claudecode:
  model: inherit
---
Instructions for multiple AI tools.`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-multitarget.md",
      });

      expect(subagent.getFrontmatter().targets).toEqual(["cursor", "copilot", "cline"]);
      expect(subagent.getFrontmatter().claudecode?.model).toBe("inherit");
    });

    it("should trim body content", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-whitespace.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: whitespace-subagent
description: Testing whitespace handling
---

  Body content with leading/trailing whitespace.  

`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-whitespace.md",
      });

      expect(subagent.getBody()).toBe("Body content with leading/trailing whitespace.");
    });
  });

  describe("integration with inheritance", () => {
    it("should work with polymorphic usage", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["*"],
        name: "poly-subagent",
        description: "Polymorphic usage test",
      };

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "poly.md",
        fileContent: "poly content",
        frontmatter,
        body: "Poly body",
      });

      // Should work as RulesyncFile
      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(subagent.getRelativeFilePath()).toBe("poly.md");
      expect(subagent.getFileContent()).toBe("poly content");

      // Should work as RulesyncSubagent
      expect(subagent.getFrontmatter()).toEqual(frontmatter);
      expect(subagent.getBody()).toBe("Poly body");

      // Should have validation
      const result = subagent.validate();
      expect(result.success).toBe(true);
    });

    it("should maintain type safety", () => {
      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "typed.md",
        fileContent: "typed content",
        frontmatter: {
          targets: ["*"],
          name: "typed-subagent",
          description: "Type safety test",
        },
        body: "Typed body",
      });

      // TypeScript should allow these calls
      expect(typeof subagent.getFrontmatter).toBe("function");
      expect(typeof subagent.getBody).toBe("function");
      expect(typeof subagent.validate).toBe("function");

      // Should return correct types
      const frontmatter = subagent.getFrontmatter();
      expect(typeof frontmatter.name).toBe("string");
      expect(typeof frontmatter.description).toBe("string");
      expect(Array.isArray(frontmatter.targets)).toBe(true);

      const body = subagent.getBody();
      expect(typeof body).toBe("string");
    });
  });

  describe("edge cases", () => {
    let createdFiles: string[] = [];

    afterEach(async () => {
      // Clean up any created test files
      for (const filePath of createdFiles) {
        try {
          await import("node:fs/promises").then((fs) => fs.unlink(filePath));
        } catch {
          // Ignore cleanup errors
        }
      }
      createdFiles = [];
    });

    it("should handle empty body from file", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-emptybody.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: empty-body-file
description: File with empty body
---`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-emptybody.md",
      });

      expect(subagent.getBody()).toBe("");
    });

    it("should handle complex target arrays", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["cursor", "copilot", "cline", "claudecode", "augmentcode"],
        name: "complex-targets",
        description: "Complex targets test",
      };

      const subagent = new RulesyncSubagent({
        baseDir: ".",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "complex.md",
        fileContent: "complex content",
        frontmatter,
        body: "Complex body",
        validate: false, // Skip validation to test complex arrays
      });

      expect(subagent.getFrontmatter().targets).toHaveLength(5);
      expect(subagent.getFrontmatter().targets).toContain("cursor");
      expect(subagent.getFrontmatter().targets).toContain("claudecode");
    });

    it("should handle content with special characters", async () => {
      const subagentsDir = join(process.cwd(), ".rulesync", "subagents");
      const filePath = join(subagentsDir, "test-fromfile-specialchars.md");
      createdFiles.push(filePath);
      const fileContent = `---
targets: ["*"]
name: special-chars-subagent
description: "Testing special characters: éñ中文🚀"
---
Body with special characters: éñ中文🚀
And some code: \`const x = "hello";\`
And markdown: **bold** _italic_`;

      await writeFileContent(filePath, fileContent);

      const subagent = await RulesyncSubagent.fromFile({
        relativeFilePath: "test-fromfile-specialchars.md",
      });

      expect(subagent.getFrontmatter().description).toContain("éñ中文🚀");
      expect(subagent.getBody()).toContain("éñ中文🚀");
      expect(subagent.getBody()).toContain("**bold**");
      expect(subagent.getBody()).toContain("const x =");
    });
  });
});
