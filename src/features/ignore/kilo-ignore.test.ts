import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloIgnore } from "./kilo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("KiloIgnore", () => {
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
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(kiloIgnore).toBeInstanceOf(KiloIgnore);
      expect(kiloIgnore.getRelativeDirPath()).toBe(".");
      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
      expect(kiloIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const kiloIgnore = new KiloIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".kilocodeignore",
        fileContent: "*.tmp",
      });

      expect(kiloIgnore.getFilePath()).toBe("/custom/path/subdir/.kilocodeignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new KiloIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".kilocodeignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new KiloIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".kilocodeignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      const rulesyncIgnore = kiloIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const kiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: "",
      });

      const rulesyncIgnore = kiloIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const kiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      const rulesyncIgnore = kiloIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create KiloIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiloIgnore = KiloIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiloIgnore).toBeInstanceOf(KiloIgnore);
      expect(kiloIgnore.getBaseDir()).toBe(testDir);
      expect(kiloIgnore.getRelativeDirPath()).toBe(".");
      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create KiloIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiloIgnore = KiloIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(kiloIgnore.getBaseDir()).toBe("/custom/base");
      expect(kiloIgnore.getFilePath()).toBe("/custom/base/.kilocodeignore");
      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const kiloIgnore = KiloIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiloIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiloIgnore = KiloIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .kilocodeignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiloIgnore).toBeInstanceOf(KiloIgnore);
      expect(kiloIgnore.getBaseDir()).toBe(testDir);
      expect(kiloIgnore.getRelativeDirPath()).toBe(".");
      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .kilocodeignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .kilocodeignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .kilocodeignore file", async () => {
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, "");

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiloIgnore.getFileContent()).toBe("");
    });

    it("should handle .kilocodeignore file with complex patterns", async () => {
      const fileContent = `# Build outputs
build/
dist/
*.map

# Dependencies
node_modules/
.pnpm-store/

# Environment files
.env*
!.env.example

# IDE files
.vscode/
.idea/

# Logs
*.log
logs/

# Cache
.cache/
*.tmp
*.temp

# OS generated files
.DS_Store
Thumbs.db`;

      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({});

      expect(kiloIgnore.getBaseDir()).toBe(testDir);
      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .kilocodeignore file does not exist", async () => {
      await expect(
        KiloIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const kilocodeignorePath = join(testDir, ".kilocodeignore");
      await writeFileContent(kilocodeignorePath, fileContent);

      const kiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      const patterns = kiloIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = kiloIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const kiloIgnore = new KiloIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".kilocodeignore",
        fileContent: "*.log",
      });

      expect(kiloIgnore.getBaseDir()).toBe("/test/base");
      expect(kiloIgnore.getRelativeDirPath()).toBe("subdir");
      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
      expect(kiloIgnore.getFilePath()).toBe("/test/base/subdir/.kilocodeignore");
      expect(kiloIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Kilo Code ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // KiloIgnore -> RulesyncIgnore -> KiloIgnore
      const originalKiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalKiloIgnore.toRulesyncIgnore();
      const roundTripKiloIgnore = KiloIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripKiloIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripKiloIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripKiloIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripKiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalKiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalKiloIgnore.toRulesyncIgnore();
      const roundTripKiloIgnore = KiloIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripKiloIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: "   \n\t\n   ",
      });

      expect(kiloIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(kiloIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: longPattern,
      });

      expect(kiloIgnore.getFileContent()).toBe(longPattern);
      expect(kiloIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\nnode_modules/\nenvironment.env\nbuild/";
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: unicodeContent,
      });

      expect(kiloIgnore.getFileContent()).toBe(unicodeContent);
      expect(kiloIgnore.getPatterns()).toEqual([
        "*.log",
        "node_modules/",
        "environment.env",
        "build/",
      ]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(kiloIgnore.getFilePath(), kiloIgnore.getFileContent());

      // Read file back
      const readKiloIgnore = await KiloIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readKiloIgnore.getFileContent()).toBe(fileContent);
      expect(readKiloIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const kiloIgnore = new KiloIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(kiloIgnore.getFilePath(), kiloIgnore.getFileContent());

      const readKiloIgnore = await KiloIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readKiloIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Kilo Code-specific behavior", () => {
    it("should use .kilocodeignore as the filename", () => {
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent: "*.log",
      });

      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
    });

    it("should work with gitignore syntax patterns", () => {
      const fileContent = `# Standard gitignore patterns
*.log
*.tmp
build/
node_modules/
.env*
!.env.example
**/*.cache
temp*/
.DS_Store`;

      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      const patterns = kiloIgnore.getPatterns();
      // Comments are filtered out, only actual patterns remain
      const expectedPatterns = [
        "*.log",
        "*.tmp",
        "build/",
        "node_modules/",
        ".env*",
        "!.env.example",
        "**/*.cache",
        "temp*/",
        ".DS_Store",
      ];

      expect(patterns).toEqual(expectedPatterns);
    });

    it("should handle immediate reflection semantics (file content preservation)", () => {
      const fileContent = "# This should reflect immediately\n*.log\ntemp/";
      const kiloIgnore = new KiloIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".kilocodeignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(kiloIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const kiloIgnore = KiloIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .kilocodeignore in root (relativeDirPath: ".")
      expect(kiloIgnore.getRelativeDirPath()).toBe(".");
      expect(kiloIgnore.getRelativeFilePath()).toBe(".kilocodeignore");
      expect(kiloIgnore.getFilePath()).toBe("/workspace/root/.kilocodeignore");
    });
  });
});
