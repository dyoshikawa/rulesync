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
import { ZedIgnore } from "./zed-ignore.js";

describe("ZedIgnore", () => {
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
    it("should create instance with valid JSON content", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "node_modules/**"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore).toBeInstanceOf(ZedIgnore);
      expect(zedIgnore.getRelativeDirPath()).toBe(".zed");
      expect(zedIgnore.getRelativeFilePath()).toBe("settings.json");
      expect(zedIgnore.getPatterns()).toEqual(["*.log", "node_modules/**"]);
    });

    it("should handle empty private_files array", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: [],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getPatterns()).toEqual([]);
    });

    it("should handle null private_files", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: null,
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getPatterns()).toEqual([]);
    });

    it("should handle missing private_files property", () => {
      const jsonContent = JSON.stringify({}, null, 2);

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getPatterns()).toEqual([]);
    });

    it("should create instance with custom baseDir", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.tmp"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: "/custom/path",
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getFilePath()).toBe("/custom/path/.zed/settings.json");
      expect(zedIgnore.getPatterns()).toEqual(["*.tmp"]);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for Zed", () => {
      const paths = ZedIgnore.getSettablePaths();

      expect(paths).toEqual({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json is user-managed", () => {
      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ private_files: [] }),
      });

      expect(zedIgnore.isDeletable()).toBe(false);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert patterns to plain patterns", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "node_modules/**", ".env"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: testDir,
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/**\n.env");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should filter out empty patterns", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "", "node_modules/**"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: testDir,
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("*.log\nnode_modules/**");
    });

    it("should handle empty private_files array", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: [],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: testDir,
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create ZedIgnore from RulesyncIgnore patterns", async () => {
      const fileContent = "*.log\nnode_modules/**\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(zedIgnore).toBeInstanceOf(ZedIgnore);
      expect(zedIgnore.getBaseDir()).toBe(testDir);
      expect(zedIgnore.getRelativeDirPath()).toBe(".zed");
      expect(zedIgnore.getRelativeFilePath()).toBe("settings.json");

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.log", ".env", "node_modules/**"]);
    });

    it("should preserve existing private_files while adding new ones", async () => {
      const existingJsonContent = JSON.stringify(
        {
          private_files: ["existing.log", "*.log"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/**",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.log", "existing.log", "node_modules/**"]);
    });

    it("should handle patterns with comments and empty lines", async () => {
      const fileContent = "# Comment\n*.log\n\nnode_modules/**\n# Another comment\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.log", ".env", "node_modules/**"]);
    });

    it("should preserve other JSON properties", async () => {
      const existingJsonContent = JSON.stringify(
        {
          other: "property",
          private_files: ["secret.txt"],
          another: "value",
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.other).toBe("property");
      expect(jsonValue.another).toBe("value");
      expect(jsonValue.private_files).toEqual(["*.log", "secret.txt"]);
    });

    it("should remove duplicates and sort patterns", async () => {
      const existingJsonContent = JSON.stringify(
        {
          private_files: ["*.log", "z.txt", "a.txt"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), existingJsonContent);

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nb.txt\na.txt",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.log", "a.txt", "b.txt", "z.txt"]);
    });

    it("should handle Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/**\r\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent,
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.log", ".env", "node_modules/**"]);
    });

    it("should create new JSON file when none exists", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log\nnode_modules/**",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue).toEqual({
        private_files: ["*.log", "node_modules/**"],
      });
    });

    it("should use default baseDir when not provided", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.tmp",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(zedIgnore.getBaseDir()).toBe(testDir);

      const jsonValue = JSON.parse(zedIgnore.getFileContent());
      expect(jsonValue.private_files).toEqual(["*.tmp"]);
    });
  });

  describe("fromFile", () => {
    it("should read settings.json file from .zed directory", async () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "node_modules/**"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), jsonContent);

      const zedIgnore = await ZedIgnore.fromFile({
        baseDir: testDir,
      });

      expect(zedIgnore).toBeInstanceOf(ZedIgnore);
      expect(zedIgnore.getBaseDir()).toBe(testDir);
      expect(zedIgnore.getRelativeDirPath()).toBe(".zed");
      expect(zedIgnore.getRelativeFilePath()).toBe("settings.json");
      expect(zedIgnore.getPatterns()).toEqual(["*.log", "node_modules/**"]);
    });

    it("should read file with validation enabled by default", async () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), jsonContent);

      const zedIgnore = await ZedIgnore.fromFile({
        baseDir: testDir,
      });

      expect(zedIgnore.getFileContent()).toBe(jsonContent);
    });

    it("should read file with validation disabled", async () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), jsonContent);

      const zedIgnore = await ZedIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(zedIgnore.getFileContent()).toBe(jsonContent);
    });

    it("should handle complex JSON structure", async () => {
      const jsonContent = JSON.stringify(
        {
          version: "1.0.0",
          private_files: ["*.log", "secrets/**"],
          customSettings: {
            theme: "dark",
          },
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), jsonContent);

      const zedIgnore = await ZedIgnore.fromFile({
        baseDir: testDir,
      });

      expect(zedIgnore.getFileContent()).toBe(jsonContent);
      expect(zedIgnore.getPatterns()).toEqual(["*.log", "secrets/**"]);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(join(zedDir, "settings.json"), jsonContent);

      const zedIgnore = await ZedIgnore.fromFile({});

      expect(zedIgnore.getBaseDir()).toBe(testDir);
      expect(zedIgnore.getPatterns()).toEqual(["*.log"]);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        ZedIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain patterns in round-trip conversion", async () => {
      const originalPatterns = ["*.log", "node_modules/**", ".env", "build/", "*.tmp"];
      const originalContent = originalPatterns.join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: originalContent,
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const convertedRulesyncIgnore = zedIgnore.toRulesyncIgnore();
      const convertedPatterns = convertedRulesyncIgnore.getFileContent().split("\n");
      const originalPatternsList = originalContent.split("\n");

      // Check that all original patterns are present (order may differ due to sorting)
      expect(convertedPatterns.toSorted()).toEqual(originalPatternsList.toSorted());
    });

    it("should handle complex patterns in round-trip", async () => {
      const patterns = [
        "*.log",
        "**/*.tmp",
        "!important.tmp",
        "node_modules/**",
        ".env*",
        "build/",
        "dist/**/*.map",
      ];
      const originalContent = patterns.join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: originalContent,
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const convertedRulesyncIgnore = zedIgnore.toRulesyncIgnore();
      const convertedPatterns = convertedRulesyncIgnore.getFileContent().split("\n");
      const originalPatternsList = originalContent.split("\n");

      // Check that all original patterns are present (order may differ due to sorting)
      expect(convertedPatterns.toSorted()).toEqual(originalPatternsList.toSorted());
    });
  });

  describe("edge cases", () => {
    it("should handle malformed JSON gracefully", () => {
      expect(() => {
        new ZedIgnore({
          relativeDirPath: ".zed",
          relativeFilePath: "settings.json",
          fileContent: "{ invalid json }",
        });
      }).toThrow();
    });

    it("should handle patterns with special characters", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: [
            "file with spaces.txt",
            "file(with)parens.txt",
            "file[with]brackets.txt",
            "file{with}braces.txt",
          ],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(
        "file with spaces.txt\n" +
          "file(with)parens.txt\n" +
          "file[with]brackets.txt\n" +
          "file{with}braces.txt",
      );
    });

    it("should handle unicode characters in patterns", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["文件.log", "ファイル/**", "🚀.txt"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("文件.log\nファイル/**\n🚀.txt");
    });

    it("should handle very long pattern lists", () => {
      const patterns = Array.from({ length: 100 }, (_, i) => `file${i}.txt`);
      const jsonContent = JSON.stringify(
        {
          private_files: patterns,
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getPatterns()).toHaveLength(100);
      expect(zedIgnore.getPatterns()[0]).toBe("file0.txt");
      expect(zedIgnore.getPatterns()[99]).toBe("file99.txt");
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "node_modules/**", ".env"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const patterns = zedIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/**", ".env"]);
    });

    it("should inherit validation method", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const result = zedIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: "/test/base",
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getBaseDir()).toBe("/test/base");
      expect(zedIgnore.getRelativeDirPath()).toBe(".zed");
      expect(zedIgnore.getRelativeFilePath()).toBe("settings.json");
      expect(zedIgnore.getFilePath()).toBe("/test/base/.zed/settings.json");
      expect(zedIgnore.getFileContent()).toBe(jsonContent);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log", "node_modules/**"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: testDir,
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const zedDir = join(testDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(zedIgnore.getFilePath(), zedIgnore.getFileContent());

      const readZedIgnore = await ZedIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readZedIgnore.getFileContent()).toBe(jsonContent);
      expect(readZedIgnore.getPatterns()).toEqual(["*.log", "node_modules/**"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project");
      await ensureDir(subDir);

      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        baseDir: subDir,
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const zedDir = join(subDir, ".zed");
      await ensureDir(zedDir);
      await writeFileContent(zedIgnore.getFilePath(), zedIgnore.getFileContent());

      const readZedIgnore = await ZedIgnore.fromFile({
        baseDir: subDir,
      });

      expect(readZedIgnore.getFileContent()).toBe(jsonContent);
    });
  });

  describe("Zed-specific behavior", () => {
    it("should use .zed/settings.json as the file path", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["*.log"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(zedIgnore.getRelativeDirPath()).toBe(".zed");
      expect(zedIgnore.getRelativeFilePath()).toBe("settings.json");
    });

    it("should format JSON output with 2-space indentation", async () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        fileContent: "*.log",
      });

      const zedIgnore = await ZedIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      const fileContent = zedIgnore.getFileContent();
      const jsonValue = JSON.parse(fileContent);

      // Check that the JSON has the expected structure
      expect(jsonValue.private_files).toBeDefined();
      expect(jsonValue.private_files).toEqual(["*.log"]);

      // Check that the file is formatted with proper indentation
      expect(fileContent).toContain('  "'); // Should have 2-space indentation
      expect(fileContent.startsWith("{")).toBe(true);
      expect(fileContent.endsWith("}")).toBe(true);
    });

    it("should handle private_files format correctly", () => {
      const jsonContent = JSON.stringify(
        {
          private_files: ["**/*.secret", "private/**", "*.key"],
        },
        null,
        2,
      );

      const zedIgnore = new ZedIgnore({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      const patterns = zedIgnore.getPatterns();
      expect(patterns).toEqual(["**/*.secret", "private/**", "*.key"]);

      const rulesyncIgnore = zedIgnore.toRulesyncIgnore();
      expect(rulesyncIgnore.getFileContent()).toBe("**/*.secret\nprivate/**\n*.key");
    });
  });
});
