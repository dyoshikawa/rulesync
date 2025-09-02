import { describe, expect, it } from "vitest";
import { ValidationResult } from "./ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "./rulesync-file.js";

// Test implementation of RulesyncFile
class TestRulesyncFile extends RulesyncFile {
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

  static async fromFilePath(_params: any): Promise<TestRulesyncFile> {
    return new TestRulesyncFile({
      baseDir: _params.baseDir || ".",
      relativeDirPath: _params.relativeDirPath,
      relativeFilePath: _params.relativeFilePath,
      fileContent: "test content from file path",
    });
  }
}

describe("RulesyncFile", () => {
  describe("inheritance from AiFile", () => {
    it("should inherit AiFile functionality", () => {
      const file = new TestRulesyncFile({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      // Should have all AiFile methods
      expect(file.getRelativeDirPath()).toBe(".rulesync");
      expect(file.getRelativeFilePath()).toBe("test.md");
      expect(file.getFileContent()).toBe("Test content");
      expect(typeof file.getFilePath).toBe("function");
    });

    it("should support validation like AiFile", () => {
      const file = new TestRulesyncFile({
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        fileContent: "valid content",
      });

      const result = file.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should throw validation errors during construction", () => {
      expect(() => {
        const _instance = new TestRulesyncFile({
          relativeDirPath: ".rulesync",
          relativeFilePath: "test.md",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new TestRulesyncFile({
          relativeDirPath: ".rulesync",
          relativeFilePath: "test.md",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("abstract class behavior", () => {
    it("should throw error for abstract fromFilePath method", async () => {
      await expect(
        RulesyncFile.fromFilePath({
          relativeDirPath: ".",
          relativeFilePath: "test.md",
          filePath: "/path/test.md",
        }),
      ).rejects.toThrow("Please implement this method in the subclass.");
    });
  });

  describe("concrete implementation", () => {
    it("should work with concrete implementation", async () => {
      const file = await TestRulesyncFile.fromFilePath({
        baseDir: "/test",
        relativeDirPath: ".rulesync",
        relativeFilePath: "config.md",
        filePath: "/test/.rulesync/config.md",
      });

      expect(file).toBeInstanceOf(TestRulesyncFile);
      expect(file).toBeInstanceOf(RulesyncFile);
      expect(file.getRelativeDirPath()).toBe(".rulesync");
      expect(file.getRelativeFilePath()).toBe("config.md");
      expect(file.getFileContent()).toBe("test content from file path");
    });
  });

  describe("type definitions", () => {
    it("should accept RulesyncFileParams", () => {
      const params: RulesyncFileParams = {
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        fileContent: "content",
        baseDir: "/base",
        validate: true,
      };

      const file = new TestRulesyncFile(params);
      expect(file.getRelativeDirPath()).toBe(".rulesync");
      expect(file.getRelativeFilePath()).toBe("test.md");
      expect(file.getFileContent()).toBe("content");
    });

    it("should work with minimal params", () => {
      const params: RulesyncFileParams = {
        relativeDirPath: ".rulesync",
        relativeFilePath: "test.md",
        fileContent: "content",
      };

      const file = new TestRulesyncFile(params);
      expect(file.getRelativeDirPath()).toBe(".rulesync");
    });
  });
});
