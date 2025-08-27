import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AiFile, AiFileFromFilePathParams, ValidationResult } from "./ai-file.js";

// Concrete implementation for testing the abstract AiFile class
class TestAiFile extends AiFile {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<TestAiFile> {
    return new TestAiFile({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: "test content from file path",
      validate: params.validate || true,
    });
  }

  validate(): ValidationResult {
    if (this.fileContent.includes("invalid")) {
      return {
        success: false,
        error: new Error("Content contains invalid text"),
      };
    }
    return {
      success: true,
      error: undefined,
    };
  }
}

// Test implementation that always fails validation
class InvalidTestAiFile extends AiFile {
  validate(): ValidationResult {
    return {
      success: false,
      error: new Error("Validation always fails"),
    };
  }
}

describe("AiFile", () => {
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
      const aiFile = new TestAiFile({
        relativeDirPath: ".claude",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      expect(aiFile.getRelativeDirPath()).toBe(".claude");
      expect(aiFile.getRelativeFilePath()).toBe("test.md");
      expect(aiFile.getFileContent()).toBe("Test content");
      expect(aiFile.getFilePath()).toBe(join(".", ".claude", "test.md"));
    });

    it("should create instance with custom baseDir", () => {
      const customBaseDir = join(testDir, "custom");
      const _aiFile = new TestAiFile({
        baseDir: customBaseDir,
        relativeDirPath: ".claude",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      expect(_aiFile.getFilePath()).toBe(join(customBaseDir, ".claude", "test.md"));
    });

    it("should validate content by default", () => {
      expect(() => {
        const _aiFile = new TestAiFile({
          relativeDirPath: ".claude",
          relativeFilePath: "test.md",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _aiFile = new TestAiFile({
          relativeDirPath: ".claude",
          relativeFilePath: "test.md",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error when validation fails", () => {
      expect(() => {
        const _aiFile = new InvalidTestAiFile({
          relativeDirPath: ".claude",
          relativeFilePath: "test.md",
          fileContent: "any content",
        });
      }).toThrow("Validation always fails");
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from file path parameters", async () => {
      const aiFile = await TestAiFile.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "test.md",
        filePath: "/some/path/test.md",
      });

      expect(aiFile.getRelativeDirPath()).toBe(".claude");
      expect(aiFile.getRelativeFilePath()).toBe("test.md");
      expect(aiFile.getFileContent()).toBe("test content from file path");
    });

    it("should throw error for abstract base class", () => {
      expect(() => {
        AiFile.fromFilePath({
          relativeDirPath: ".claude",
          relativeFilePath: "test.md",
          filePath: "/some/path/test.md",
        });
      }).toThrow("Please implement this method in the subclass.");
    });
  });

  describe("getter methods", () => {
    let aiFile: TestAiFile;

    beforeEach(() => {
      aiFile = new TestAiFile({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "planner.md",
        fileContent: "# Planner Agent\n\nThis is a test agent.",
      });
    });

    it("should return correct relative directory path", () => {
      expect(aiFile.getRelativeDirPath()).toBe(".claude/agents");
    });

    it("should return correct relative file path", () => {
      expect(aiFile.getRelativeFilePath()).toBe("planner.md");
    });

    it("should return correct full file path", () => {
      const expected = join(testDir, ".claude/agents", "planner.md");
      expect(aiFile.getFilePath()).toBe(expected);
    });

    it("should return correct file content", () => {
      expect(aiFile.getFileContent()).toBe("# Planner Agent\n\nThis is a test agent.");
    });
  });

  describe("validation", () => {
    it("should return success for valid content", () => {
      const aiFile = new TestAiFile({
        relativeDirPath: ".claude",
        relativeFilePath: "test.md",
        fileContent: "valid content",
        validate: false,
      });

      const result = aiFile.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return error for invalid content", () => {
      const aiFile = new TestAiFile({
        relativeDirPath: ".claude",
        relativeFilePath: "test.md",
        fileContent: "invalid content",
        validate: false,
      });

      const result = aiFile.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Content contains invalid text");
    });
  });

  describe("edge cases", () => {
    it("should handle empty content", () => {
      const aiFile = new TestAiFile({
        relativeDirPath: "",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      expect(aiFile.getFileContent()).toBe("");
      expect(aiFile.getFilePath()).toBe(join(".", "", "empty.md"));
    });

    it("should handle deep directory paths", () => {
      const deepPath = "a/very/deep/directory/structure";
      const aiFile = new TestAiFile({
        relativeDirPath: deepPath,
        relativeFilePath: "deep.md",
        fileContent: "Deep content",
      });

      expect(aiFile.getRelativeDirPath()).toBe(deepPath);
      expect(aiFile.getFilePath()).toBe(join(".", deepPath, "deep.md"));
    });

    it("should handle special characters in paths", () => {
      const aiFile = new TestAiFile({
        relativeDirPath: "path with spaces/special-chars_123",
        relativeFilePath: "file-name_with-specials.md",
        fileContent: "Special content",
      });

      expect(aiFile.getRelativeDirPath()).toBe("path with spaces/special-chars_123");
      expect(aiFile.getRelativeFilePath()).toBe("file-name_with-specials.md");
    });
  });
});
