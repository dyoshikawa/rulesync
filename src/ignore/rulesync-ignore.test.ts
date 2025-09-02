import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RulesyncIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with ignore content", () => {
      const content = "node_modules/\n*.log\ndist/";
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: content,
      });

      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(ignore.getRelativeDirPath()).toBe(".");
    });

    it("should inherit from RulesyncFile", () => {
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "test content",
      });

      expect(ignore).toBeInstanceOf(RulesyncIgnore);
      // Note: We can't test direct inheritance from RulesyncFile without importing it
      // but the type system ensures this relationship
    });
  });

  describe("validate", () => {
    it("should always return successful validation", () => {
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "any content here",
        validate: false, // Skip constructor validation
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation for empty content", () => {
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "",
        validate: false,
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return successful validation for any content", () => {
      const testCases = [
        "# Comments only",
        "node_modules/\n*.log\ndist/",
        "invalid patterns here",
        "!negation\n**/*.temp",
        "unicode: 中文/",
        "",
      ];

      for (const content of testCases) {
        const ignore = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          fileContent: content,
          validate: false,
        });

        const result = ignore.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("fromFile", () => {
    it("should read from .rulesyncignore file", async () => {
      const content = "# Rulesync ignore\nnode_modules/\n*.log\ndist/";
      const ignoreFilePath = join(testDir, ".rulesyncignore");
      await writeFileContent(ignoreFilePath, content);

      // Change working directory to test directory for fromFile to work
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const ignore = await RulesyncIgnore.fromFile();

        expect(ignore.getFileContent()).toBe(content);
        expect(ignore.getRelativeFilePath()).toBe(".rulesyncignore");
        expect(ignore.getRelativeDirPath()).toBe(".");
        expect(ignore).toBeInstanceOf(RulesyncIgnore);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should throw error when file doesn't exist", async () => {
      // Change to test directory where no .rulesyncignore exists
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(RulesyncIgnore.fromFile()).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("fromFilePath", () => {
    it("should throw error directing to use fromFile", async () => {
      await expect(RulesyncIgnore.fromFilePath({ filePath: "test" })).rejects.toThrow(
        "Please use the fromFile method instead.",
      );
    });

    it("should throw error regardless of parameters", async () => {
      const testCases = [
        { filePath: ".rulesyncignore" },
        { filePath: "/absolute/path/.rulesyncignore" },
        { filePath: "" },
      ];

      for (const params of testCases) {
        await expect(RulesyncIgnore.fromFilePath(params)).rejects.toThrow(
          "Please use the fromFile method instead.",
        );
      }
    });
  });

  describe("integration", () => {
    it("should work with various ignore patterns", () => {
      const ignorePatterns = [
        "# Node.js\nnode_modules/\nnpm-debug.log*",
        "# Build artifacts\ndist/\nbuild/\nout/",
        "# Environment\n.env*\n!.env.example",
        "# IDE\n.vscode/\n.idea/\n*.swp",
        "# Logs\n*.log\nlogs/",
      ];

      for (const content of ignorePatterns) {
        const ignore = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          fileContent: content,
        });

        expect(ignore.getFileContent()).toBe(content);
        expect(ignore.validate().success).toBe(true);
      }
    });

    it("should maintain file path structure", () => {
      const ignore = new RulesyncIgnore({
        baseDir: "/project",
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "test",
      });

      expect(ignore.getFilePath()).toBe(join("/project", ".", ".rulesyncignore"));
    });
  });

  describe("edge cases", () => {
    it("should handle very large ignore files", () => {
      const largeContent = "pattern\n".repeat(10000);
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: largeContent,
      });

      expect(ignore.getFileContent()).toBe(largeContent);
      expect(ignore.validate().success).toBe(true);
    });

    it("should handle ignore files with special characters", () => {
      const content = "# Special chars\n**/*[temp]*\n中文目录/\n🚀*.log";
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: content,
      });

      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.validate().success).toBe(true);
    });

    it("should handle binary or malformed content gracefully", () => {
      // Test with content that looks like it could be problematic
      const content = "\x00\x01\x02binary data mixed with text\npattern/";
      const ignore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: content,
      });

      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.validate().success).toBe(true);
    });
  });
});
