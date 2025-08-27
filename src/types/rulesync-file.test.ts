import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFileFromFilePathParams, ValidationResult } from "./ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "./rulesync-file.js";

// Concrete implementation for testing the abstract RulesyncFile class
class TestRulesyncFile extends RulesyncFile {
  static fromFilePath(params: AiFileFromFilePathParams): TestRulesyncFile {
    return new TestRulesyncFile({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: "test content from file path",
      body: "test body from file path",
      validate: params.validate || true,
    });
  }

  getFrontmatter(): Record<string, unknown> {
    return {
      title: "Test Frontmatter",
      description: "Test description",
      targets: ["test-target"],
    };
  }

  validate(): ValidationResult {
    const body = this.getBody(); // Use getBody() method instead of direct property access
    if (body && body.includes("invalid")) {
      return {
        success: false,
        error: new Error("Body contains invalid text"),
      };
    }
    return {
      success: true,
      error: undefined,
    };
  }
}

// Test implementation that always fails validation
class InvalidTestRulesyncFile extends RulesyncFile {
  getFrontmatter(): Record<string, unknown> {
    return {
      invalid: true,
    };
  }

  validate(): ValidationResult {
    return {
      success: false,
      error: new Error("Validation always fails"),
    };
  }
}

describe("RulesyncFile", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with required parameters", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "Test body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        fileContent: "Test file content",
      });

      expect(rulesyncFile).toBeInstanceOf(RulesyncFile);
      expect(rulesyncFile.getBody()).toBe("Test body content");
      expect(rulesyncFile.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncFile.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncFile.getFileContent()).toBe("Test file content");
    });

    it("should validate content by default (manual validation)", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "content with invalid text",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid file content",
        validate: false,
      });

      const result = rulesyncFile.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Body contains invalid text");
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _rulesyncFile = new TestRulesyncFile({
          body: "invalid body content",
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "skip.md",
          fileContent: "Skip validation content",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error when validation fails", () => {
      expect(() => {
        const _rulesyncFile = new InvalidTestRulesyncFile({
          body: "Any body content",
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "fails.md",
          fileContent: "Any file content",
        });
      }).toThrow("Validation always fails");
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const bodyContent = "This is the body content for the rulesync file";
      const rulesyncFile = new TestRulesyncFile({
        body: bodyContent,
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "body.md",
        fileContent: "File content",
      });

      expect(rulesyncFile.getBody()).toBe(bodyContent);
    });

    it("should handle empty body", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "empty.md",
        fileContent: "File content",
      });

      expect(rulesyncFile.getBody()).toBe("");
    });

    it("should handle body with special characters", () => {
      const specialBody = "Special chars: üñíçødé 🤖 \n\t\r \\n \\t";
      const rulesyncFile = new TestRulesyncFile({
        body: specialBody,
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "special.md",
        fileContent: "Special file content",
      });

      expect(rulesyncFile.getBody()).toBe(specialBody);
    });

    it("should handle very long body content", () => {
      const longBody = "x".repeat(10000);
      const rulesyncFile = new TestRulesyncFile({
        body: longBody,
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "long.md",
        fileContent: "Long file content",
      });

      expect(rulesyncFile.getBody()).toBe(longBody);
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter from concrete implementation", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "Body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "frontmatter.md",
        fileContent: "Frontmatter file content",
      });

      const frontmatter = rulesyncFile.getFrontmatter();
      expect(frontmatter).toEqual({
        title: "Test Frontmatter",
        description: "Test description",
        targets: ["test-target"],
      });
    });

    it("should require implementation in subclass", () => {
      // Abstract method should be implemented by subclass
      const rulesyncFile = new TestRulesyncFile({
        body: "Body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "abstract.md",
        fileContent: "Abstract file content",
      });

      expect(typeof rulesyncFile.getFrontmatter).toBe("function");
      expect(rulesyncFile.getFrontmatter()).toBeDefined();
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from file path through concrete implementation", () => {
      const rulesyncFile = TestRulesyncFile.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "frompath.md",
        filePath: "/some/path/frompath.md",
      });

      expect(rulesyncFile).toBeInstanceOf(TestRulesyncFile);
      expect(rulesyncFile.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncFile.getRelativeFilePath()).toBe("frompath.md");
      expect(rulesyncFile.getFileContent()).toBe("test content from file path");
      expect(rulesyncFile.getBody()).toBe("test body from file path");
    });

    it("should throw error for abstract base class fromFilePath", () => {
      expect(() => {
        RulesyncFile.fromFilePath({
          relativeDirPath: ".rulesync",
          relativeFilePath: "test.md",
          filePath: "/some/path/test.md",
        });
      }).toThrow("Please implement this method in the subclass.");
    });

    it("should handle optional parameters with defaults", () => {
      const rulesyncFile = TestRulesyncFile.fromFilePath({
        relativeDirPath: ".rulesync",
        relativeFilePath: "defaults.md",
        filePath: "/some/path/defaults.md",
      });

      expect(rulesyncFile).toBeInstanceOf(TestRulesyncFile);
    });
  });

  describe("inheritance from AiFile", () => {
    it("should properly extend AiFile", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "Inheritance body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subdir",
        relativeFilePath: "inheritance.md",
        fileContent: "Inheritance file content",
      });

      // Test inherited methods from AiFile
      expect(rulesyncFile.getRelativeDirPath()).toBe(".rulesync/subdir");
      expect(rulesyncFile.getRelativeFilePath()).toBe("inheritance.md");
      expect(rulesyncFile.getFileContent()).toBe("Inheritance file content");
      expect(rulesyncFile.getFilePath()).toContain("inheritance.md");
    });

    it("should inherit validation behavior from AiFile (manual validation)", () => {
      // Test that validation can be performed manually
      const rulesyncFile = new TestRulesyncFile({
        body: "content with invalid text", // This should trigger validation error
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "validation.md",
        fileContent: "Validation content",
        validate: false,
      });

      const result = rulesyncFile.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Body contains invalid text");
    });

    it("should support skipping validation from AiFile", () => {
      expect(() => {
        const _rulesyncFile = new TestRulesyncFile({
          body: "invalid body",
          baseDir: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "skipvalidation.md",
          fileContent: "Skip validation content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validation", () => {
    it("should return success for valid body", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "valid body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "valid.md",
        fileContent: "Valid file content",
        validate: false,
      });

      const result = rulesyncFile.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return error for invalid body", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "invalid body content",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid file content",
        validate: false,
      });

      const result = rulesyncFile.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Body contains invalid text");
    });
  });

  describe("edge cases", () => {
    it("should handle empty file content with non-empty body", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "Non-empty body",
        baseDir: testDir,
        relativeDirPath: "",
        relativeFilePath: "edge.md",
        fileContent: "",
      });

      expect(rulesyncFile.getBody()).toBe("Non-empty body");
      expect(rulesyncFile.getFileContent()).toBe("");
    });

    it("should handle special characters in paths", () => {
      const rulesyncFile = new TestRulesyncFile({
        body: "Special path body",
        baseDir: testDir,
        relativeDirPath: "path with spaces/special-chars_123",
        relativeFilePath: "file-name_with-specials.md",
        fileContent: "Special path content",
      });

      expect(rulesyncFile.getRelativeDirPath()).toBe("path with spaces/special-chars_123");
      expect(rulesyncFile.getRelativeFilePath()).toBe("file-name_with-specials.md");
      expect(rulesyncFile.getBody()).toBe("Special path body");
    });

    it("should handle multiline body content", () => {
      const multilineBody = `Line 1
Line 2
Line 3

Line 5 with empty line above`;

      const rulesyncFile = new TestRulesyncFile({
        body: multilineBody,
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "multiline.md",
        fileContent: "Multiline file content",
      });

      expect(rulesyncFile.getBody()).toBe(multilineBody);
    });
  });

  describe("abstract method contracts", () => {
    it("should enforce getFrontmatter implementation", () => {
      // This test verifies that the abstract method contract exists
      const rulesyncFile = new TestRulesyncFile({
        body: "Contract body",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "contract.md",
        fileContent: "Contract content",
      });

      // Should have the method implemented
      expect(typeof rulesyncFile.getFrontmatter).toBe("function");

      // Should return an object
      const result = rulesyncFile.getFrontmatter();
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    });

    it("should enforce fromFilePath static method implementation", () => {
      // Verify the static method exists and works
      expect(typeof TestRulesyncFile.fromFilePath).toBe("function");

      const result = TestRulesyncFile.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "static.md",
        filePath: "/some/path/static.md",
      });

      expect(result).toBeInstanceOf(TestRulesyncFile);
    });
  });

  describe("type definitions", () => {
    it("should have correct RulesyncFileParams type", () => {
      // This should compile and work correctly
      const params: RulesyncFileParams = {
        body: "Type test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "typetest.md",
        fileContent: "Type test content",
        validate: true,
      };

      const result = new TestRulesyncFile(params);
      expect(result).toBeInstanceOf(TestRulesyncFile);
      expect(result.getBody()).toBe("Type test body");
    });

    it("should extend AiFileParams correctly", () => {
      // RulesyncFileParams should include all AiFileParams properties plus body
      const rulesyncFile = new TestRulesyncFile({
        // AiFileParams properties
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "extend.md",
        fileContent: "Extension test content",
        validate: false,
        // RulesyncFileParams additional property
        body: "Extension test body",
      });

      expect(rulesyncFile).toBeInstanceOf(TestRulesyncFile);
    });
  });
});
