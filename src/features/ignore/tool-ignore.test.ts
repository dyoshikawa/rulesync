import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
} from "./tool-ignore.js";

// Test implementation of abstract ToolIgnore class
class TestToolIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): TestToolIgnore {
    return new TestToolIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".testignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<TestToolIgnore> {
    const fileContent = "*.test\n# comment\n  \n\nnode_modules/\n*.log";

    return new TestToolIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".testignore",
      fileContent,
      validate,
    });
  }
}

describe("ToolIgnore", () => {
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
    it("should create instance with default parameters", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(toolIgnore).toBeInstanceOf(ToolIgnore);
      expect(toolIgnore.getRelativeDirPath()).toBe(".");
      expect(toolIgnore.getRelativeFilePath()).toBe(".testignore");
      expect(toolIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const toolIgnore = new TestToolIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".testignore",
        fileContent: "*.tmp",
      });

      expect(toolIgnore.getFilePath()).toBe("/custom/path/subdir/.testignore");
    });

    it("should parse patterns correctly from file content", () => {
      const fileContent =
        "*.log\n# This is a comment\nnode_modules/\n  \n\n*.tmp\n# Another comment";
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const patterns = toolIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", "*.tmp"]);
    });

    it("should handle empty file content", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "",
      });

      expect(toolIgnore.getPatterns()).toEqual([]);
    });

    it("should handle only comments and whitespace", () => {
      const fileContent = "# Comment only\n  \n\n# Another comment\n   ";
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      expect(toolIgnore.getPatterns()).toEqual([]);
    });

    it("should handle different line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\r*.tmp\n*.cache";
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const patterns = toolIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", "*.tmp", "*.cache"]);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new TestToolIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".testignore",
          fileContent: "*.log",
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      expect(() => {
        const _instance = new TestToolIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".testignore",
          fileContent: "*.log",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should trim whitespace from patterns", () => {
      const fileContent = "  *.log  \n   node_modules/   \n\t*.tmp\t";
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const patterns = toolIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", "*.tmp"]);
    });
  });

  describe("getPatterns", () => {
    it("should return parsed patterns", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "*.log\nnode_modules/\n*.tmp",
      });

      expect(toolIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "*.tmp"]);
    });

    it("should return empty array for empty content", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "",
      });

      expect(toolIgnore.getPatterns()).toEqual([]);
    });

    it("should return patterns array", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "*.log\nnode_modules/",
      });

      const patterns = toolIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/"]);
    });
  });

  describe("validate", () => {
    it("should return success by default", () => {
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent: "*.log",
        validate: false,
      });

      const result = toolIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore using default implementation", () => {
      const fileContent = "*.log\nnode_modules/";
      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const rulesyncIgnore = toolIgnore.toRulesyncIgnore();
      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create instance from RulesyncIgnore", async () => {
      const rulesyncDir = join(testDir, "rulesync-dir");
      await ensureDir(rulesyncDir);

      const fileContent = "*.log\n# comment\nnode_modules/";
      const rulesyncIgnorePath = join(rulesyncDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
      await writeFileContent(rulesyncIgnorePath, fileContent);

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: rulesyncDir,
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      const toolIgnore = TestToolIgnore.fromRulesyncIgnore({
        baseDir: rulesyncDir,
        rulesyncIgnore,
      });

      expect(toolIgnore).toBeInstanceOf(TestToolIgnore);
      expect(toolIgnore.getFileContent()).toBe(fileContent);
      expect(toolIgnore.getPatterns()).toEqual(["*.log", "node_modules/"]);
      expect(toolIgnore.getRelativeFilePath()).toBe(".testignore");
    });

    it("should use default baseDir when not provided", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      const toolIgnore = TestToolIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(toolIgnore.getFilePath()).toBe(join(testDir, ".testignore"));
    });
  });

  describe("fromFile", () => {
    it("should create instance from file using static method", async () => {
      const toolIgnore = await TestToolIgnore.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(toolIgnore).toBeInstanceOf(TestToolIgnore);
      expect(toolIgnore.getPatterns()).toEqual(["*.test", "node_modules/", "*.log"]);
    });

    it("should use default parameters", async () => {
      const toolIgnore = await TestToolIgnore.fromFile({});

      expect(toolIgnore).toBeInstanceOf(TestToolIgnore);
      expect(toolIgnore.getFilePath()).toBe(join(testDir, ".testignore"));
    });
  });

  describe("abstract methods", () => {
    it("should throw error when calling abstract fromRulesyncIgnore on base class", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      expect(() => {
        void ToolIgnore.fromRulesyncIgnore({
          rulesyncIgnore,
        });
      }).toThrow("Please implement this method in the subclass.");
    });

    it("should throw error when calling abstract fromFile on base class", async () => {
      await expect(ToolIgnore.fromFile({})).rejects.toThrow(
        "Please implement this method in the subclass.",
      );
    });
  });

  describe("toRulesyncIgnoreDefault", () => {
    it("should create RulesyncIgnore with default parameters", () => {
      const fileContent = "*.log\nnode_modules/";
      const toolIgnore = new TestToolIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const rulesyncIgnore = toolIgnore.toRulesyncIgnore();
      expect(rulesyncIgnore.getBaseDir()).toBe(".");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("complex pattern parsing", () => {
    it("should handle mixed content with various patterns", () => {
      const fileContent = [
        "# Project ignore patterns",
        "*.log",
        "",
        "# Dependencies",
        "node_modules/",
        "package-lock.json",
        "",
        "  # Build outputs  ",
        "dist/",
        "build/",
        "",
        "# IDE files",
        ".vscode/",
        "*.swp",
        "",
        "# Comments at end",
      ].join("\n");

      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      const expected = [
        "*.log",
        "node_modules/",
        "package-lock.json",
        "dist/",
        "build/",
        ".vscode/",
        "*.swp",
      ];

      expect(toolIgnore.getPatterns()).toEqual(expected);
    });

    it("should handle edge cases in pattern parsing", () => {
      const fileContent = [
        "#",
        "  #  ",
        "pattern1",
        "   ",
        "#comment with spaces",
        "  pattern2  ",
        "",
        "pattern3",
        "  #  final comment  ",
      ].join("\n");

      const toolIgnore = new TestToolIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".testignore",
        fileContent,
      });

      expect(toolIgnore.getPatterns()).toEqual(["pattern1", "pattern2", "pattern3"]);
    });
  });
});
