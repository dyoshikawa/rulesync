import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

// Test implementation of ToolIgnore
class TestToolIgnore extends ToolIgnore {
  static fromRulesyncIgnore(params: ToolIgnoreFromRulesyncIgnoreParams) {
    return new TestToolIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.rulesyncIgnore.getRelativeDirPath(),
      relativeFilePath: "test-ignore",
      fileContent: params.rulesyncIgnore.getFileContent(),
    });
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static async fromFile(): Promise<TestToolIgnore> {
    return new TestToolIgnore({
      relativeDirPath: ".",
      relativeFilePath: "test-ignore",
      fileContent: "# Test ignore file\nnode_modules/\n*.log\n",
    });
  }
}

describe("ToolIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance and parse patterns correctly", () => {
      const content = `# Comment line
node_modules/
*.log

# Another comment
*.tmp
dist/`;

      const ignore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual(["node_modules/", "*.log", "*.tmp", "dist/"]);
    });

    it("should filter out empty lines and comments", () => {
      const content = `
# This is a comment
node_modules/

# Another comment

*.log
   
   # Indented comment
dist/

`;

      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual(["node_modules/", "*.log", "dist/"]);
    });

    it("should handle empty content", () => {
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: "",
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual([]);
    });

    it("should handle content with only comments", () => {
      const content = `# Only comments here
# Another comment
# And another one`;

      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual([]);
    });

    it("should validate during construction by default", () => {
      // This should not throw since the test implementation always returns success
      expect(() => {
        const _instance = new TestToolIgnore({
          relativeDirPath: ".",
          relativeFilePath: "test-ignore",
          fileContent: "node_modules/",
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new TestToolIgnore({
          relativeDirPath: ".",
          relativeFilePath: "test-ignore",
          fileContent: "node_modules/",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getPatterns", () => {
    it("should return parsed patterns", () => {
      const content = "pattern1\npattern2\n# comment\npattern3";
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual(["pattern1", "pattern2", "pattern3"]);
    });
  });

  describe("validate", () => {
    it("should return success for valid content", () => {
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: "node_modules/",
        validate: false,
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore correctly", () => {
      const content = "node_modules/\n*.log\ndist/";
      const ignore = new TestToolIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(content);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("static methods", () => {
    describe("fromRulesyncIgnore", () => {
      it("should create instance from RulesyncIgnore", () => {
        const rulesyncIgnore = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          fileContent: "pattern1\npattern2",
        });

        const ignore = TestToolIgnore.fromRulesyncIgnore({
          baseDir: testDir,
          rulesyncIgnore,
        });

        expect(ignore.getPatterns()).toEqual(["pattern1", "pattern2"]);
        expect(ignore.getFileContent()).toBe("pattern1\npattern2");
      });
    });

    describe("fromFile", () => {
      it("should create instance from file", async () => {
        const ignore = await TestToolIgnore.fromFile();

        expect(ignore).toBeInstanceOf(TestToolIgnore);
        expect(ignore.getPatterns()).toContain("node_modules/");
        expect(ignore.getPatterns()).toContain("*.log");
      });
    });

    describe("abstract class methods", () => {
      it("should throw error for abstract fromRulesyncIgnore", () => {
        const rulesyncIgnore = new RulesyncIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rulesyncignore",
          fileContent: "test",
        });

        expect(() => {
          ToolIgnore.fromRulesyncIgnore({ rulesyncIgnore });
        }).toThrow("Please implement this method in the subclass.");
      });

      it("should throw error for abstract fromFile", async () => {
        await expect(ToolIgnore.fromFile()).rejects.toThrow(
          "Please implement this method in the subclass.",
        );
      });

      it("should throw error for fromFilePath", async () => {
        await expect(ToolIgnore.fromFilePath({ filePath: "test" })).rejects.toThrow(
          "Please use the fromFile method instead.",
        );
      });
    });
  });

  describe("edge cases", () => {
    it("should handle patterns with whitespace", () => {
      const content = "  pattern1  \n  pattern2\t\n\tpattern3 ";
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual(["pattern1", "pattern2", "pattern3"]);
    });

    it("should handle mixed line endings", () => {
      const content = "pattern1\r\npattern2\rpattern3\n";
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      // All line ending types should be handled correctly
      expect(patterns).toHaveLength(3);
      expect(patterns).toEqual(["pattern1", "pattern2", "pattern3"]);
    });

    it("should handle Unicode characters", () => {
      const content = "файл*.txt\n中文目录/\n🚀*.log";
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual(["файл*.txt", "中文目录/", "🚀*.log"]);
    });

    it("should handle very long patterns", () => {
      const longPattern = "very".repeat(100) + "longpattern";
      const content = `${longPattern}\nshort`;
      const ignore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: "test-ignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual([longPattern, "short"]);
    });
  });
});
