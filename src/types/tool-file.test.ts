import { describe, expect, it } from "vitest";
import { ValidationResult } from "./ai-file.js";
import { ToolFile } from "./tool-file.js";

// Test implementation of ToolFile
class TestToolFile extends ToolFile {
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

  static async fromFilePath(_params: any): Promise<TestToolFile> {
    return new TestToolFile({
      baseDir: _params.baseDir || ".",
      relativeDirPath: _params.relativeDirPath,
      relativeFilePath: _params.relativeFilePath,
      fileContent: "test content from file path",
    });
  }
}

describe("ToolFile", () => {
  describe("inheritance from AiFile", () => {
    it("should inherit all AiFile functionality", () => {
      const file = new TestToolFile({
        relativeDirPath: ".tool",
        relativeFilePath: "config.txt",
        fileContent: "Tool configuration",
      });

      // Should have all AiFile methods
      expect(file.getRelativeDirPath()).toBe(".tool");
      expect(file.getRelativeFilePath()).toBe("config.txt");
      expect(file.getFileContent()).toBe("Tool configuration");
      expect(typeof file.getFilePath).toBe("function");
      expect(typeof file.validate).toBe("function");
    });

    it("should support validation inheritance", () => {
      const validFile = new TestToolFile({
        relativeDirPath: ".tool",
        relativeFilePath: "valid.txt",
        fileContent: "valid content",
      });

      const result = validFile.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should support validation errors", () => {
      expect(() => {
        const _instance = new TestToolFile({
          relativeDirPath: ".tool",
          relativeFilePath: "invalid.txt",
          fileContent: "invalid content",
        });
      }).toThrow("Content contains invalid text");
    });

    it("should support skipping validation", () => {
      expect(() => {
        const _instance = new TestToolFile({
          relativeDirPath: ".tool",
          relativeFilePath: "invalid.txt",
          fileContent: "invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("abstract class characteristics", () => {
    it("should be abstract (cannot be instantiated directly)", () => {
      // This is enforced by TypeScript, but we can test the inheritance chain
      const file = new TestToolFile({
        relativeDirPath: ".tool",
        relativeFilePath: "test.txt",
        fileContent: "content",
      });

      expect(file).toBeInstanceOf(TestToolFile);
      expect(file).toBeInstanceOf(ToolFile);
    });
  });

  describe("concrete implementation functionality", () => {
    it("should work as concrete implementation", async () => {
      const file = await TestToolFile.fromFilePath({
        baseDir: "/test",
        relativeDirPath: ".tool",
        relativeFilePath: "config.txt",
        filePath: "/test/.tool/config.txt",
      });

      expect(file).toBeInstanceOf(TestToolFile);
      expect(file).toBeInstanceOf(ToolFile);
      expect(file.getRelativeDirPath()).toBe(".tool");
      expect(file.getRelativeFilePath()).toBe("config.txt");
      expect(file.getFileContent()).toBe("test content from file path");
    });
  });

  describe("polymorphism", () => {
    it("should support polymorphic usage", () => {
      const file: ToolFile = new TestToolFile({
        relativeDirPath: ".tool",
        relativeFilePath: "poly.txt",
        fileContent: "polymorphic content",
      });

      expect(file.getRelativeDirPath()).toBe(".tool");
      expect(file.getRelativeFilePath()).toBe("poly.txt");
      expect(file.getFileContent()).toBe("polymorphic content");
    });

    it("should maintain type safety through inheritance", () => {
      const file = new TestToolFile({
        relativeDirPath: ".tool",
        relativeFilePath: "typed.txt",
        fileContent: "typed content",
      });

      // Should be both ToolFile and AiFile
      expect(file).toBeInstanceOf(TestToolFile);
      expect(file).toBeInstanceOf(ToolFile);

      // Type assertion should work
      const toolFile: ToolFile = file;
      expect(toolFile.getFileContent()).toBe("typed content");
    });
  });

  describe("path traversal security", () => {
    it("should prevent path traversal via relativeDirPath", () => {
      const file = new TestToolFile({
        baseDir: ".",
        relativeDirPath: "../../etc",
        relativeFilePath: "passwd",
        fileContent: "malicious content",
        validate: false,
      });

      expect(() => file.getFilePath()).toThrow("Path traversal detected");
    });

    it("should prevent path traversal via relativeFilePath", () => {
      const file = new TestToolFile({
        baseDir: ".",
        relativeDirPath: ".tool",
        relativeFilePath: "../../etc/passwd",
        fileContent: "malicious content",
        validate: false,
      });

      expect(() => file.getFilePath()).toThrow("Path traversal detected");
    });

    it("should prevent complex path traversal attacks", () => {
      const file = new TestToolFile({
        baseDir: ".",
        relativeDirPath: "foo/../../..",
        relativeFilePath: "etc/passwd",
        fileContent: "malicious content",
        validate: false,
      });

      expect(() => file.getFilePath()).toThrow("Path traversal detected");
    });

    it("should allow safe relative paths within baseDir", () => {
      const file = new TestToolFile({
        baseDir: ".",
        relativeDirPath: ".tool/config",
        relativeFilePath: "settings.txt",
        fileContent: "safe content",
        validate: false,
      });

      expect(() => file.getFilePath()).not.toThrow();
      expect(file.getFilePath()).toBe(".tool/config/settings.txt");
    });

    it("should allow nested directories within baseDir", () => {
      const file = new TestToolFile({
        baseDir: ".",
        relativeDirPath: "deeply/nested/path",
        relativeFilePath: "file.txt",
        fileContent: "safe content",
        validate: false,
      });

      expect(() => file.getFilePath()).not.toThrow();
      expect(file.getFilePath()).toBe("deeply/nested/path/file.txt");
    });

    it("should handle baseDir with subdirectory correctly", () => {
      const file = new TestToolFile({
        baseDir: "./project",
        relativeDirPath: "src",
        relativeFilePath: "index.ts",
        fileContent: "safe content",
        validate: false,
      });

      expect(() => file.getFilePath()).not.toThrow();
      expect(file.getFilePath()).toBe("project/src/index.ts");
    });

    it("should prevent escaping from nested baseDir", () => {
      const file = new TestToolFile({
        baseDir: "./project/src",
        relativeDirPath: "../../etc",
        relativeFilePath: "passwd",
        fileContent: "malicious content",
        validate: false,
      });

      expect(() => file.getFilePath()).toThrow("Path traversal detected");
    });
  });
});
