import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("KiroIgnore", () => {
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
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(kiroIgnore).toBeInstanceOf(KiroIgnore);
      expect(kiroIgnore.getRelativeDirPath()).toBe(".");
      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(kiroIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const kiroIgnore = new KiroIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".aiignore",
        fileContent: "*.tmp",
      });

      expect(kiroIgnore.getFilePath()).toBe("/custom/path/subdir/.aiignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new KiroIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".aiignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new KiroIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".aiignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const rulesyncIgnore = kiroIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const kiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "",
      });

      const rulesyncIgnore = kiroIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const kiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const rulesyncIgnore = kiroIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create KiroIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiroIgnore = KiroIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiroIgnore).toBeInstanceOf(KiroIgnore);
      expect(kiroIgnore.getBaseDir()).toBe(testDir);
      expect(kiroIgnore.getRelativeDirPath()).toBe(".");
      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create KiroIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiroIgnore = KiroIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(kiroIgnore.getBaseDir()).toBe("/custom/base");
      expect(kiroIgnore.getFilePath()).toBe("/custom/base/.aiignore");
      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const kiroIgnore = KiroIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiroIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const kiroIgnore = KiroIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .aiignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiroIgnore).toBeInstanceOf(KiroIgnore);
      expect(kiroIgnore.getBaseDir()).toBe(testDir);
      expect(kiroIgnore.getRelativeDirPath()).toBe(".");
      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .aiignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .aiignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .aiignore file", async () => {
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, "");

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiroIgnore.getFileContent()).toBe("");
    });

    it("should handle .aiignore file with complex patterns", async () => {
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

      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({});

      expect(kiroIgnore.getBaseDir()).toBe(testDir);
      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .aiignore file does not exist", async () => {
      await expect(
        KiroIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const aiignorePath = join(testDir, ".aiignore");
      await writeFileContent(aiignorePath, fileContent);

      const kiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = kiroIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = kiroIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const kiroIgnore = new KiroIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".aiignore",
        fileContent: "*.log",
      });

      expect(kiroIgnore.getBaseDir()).toBe("/test/base");
      expect(kiroIgnore.getRelativeDirPath()).toBe("subdir");
      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(kiroIgnore.getFilePath()).toBe("/test/base/subdir/.aiignore");
      expect(kiroIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Kiro ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // KiroIgnore -> RulesyncIgnore -> KiroIgnore
      const originalKiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalKiroIgnore.toRulesyncIgnore();
      const roundTripKiroIgnore = KiroIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripKiroIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripKiroIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripKiroIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripKiroIgnore.getRelativeFilePath()).toBe(".aiignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalKiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalKiroIgnore.toRulesyncIgnore();
      const roundTripKiroIgnore = KiroIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripKiroIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "   \n\t\n   ",
      });

      expect(kiroIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(kiroIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: longPattern,
      });

      expect(kiroIgnore.getFileContent()).toBe(longPattern);
      expect(kiroIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: unicodeContent,
      });

      expect(kiroIgnore.getFileContent()).toBe(unicodeContent);
      expect(kiroIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const kiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(kiroIgnore.getFilePath(), kiroIgnore.getFileContent());

      // Read file back
      const readKiroIgnore = await KiroIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readKiroIgnore.getFileContent()).toBe(fileContent);
      expect(readKiroIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const kiroIgnore = new KiroIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(kiroIgnore.getFilePath(), kiroIgnore.getFileContent());

      const readKiroIgnore = await KiroIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readKiroIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Kiro-specific behavior", () => {
    it("should use .aiignore as the filename", () => {
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log",
      });

      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
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

      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = kiroIgnore.getPatterns();
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
      const kiroIgnore = new KiroIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(kiroIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const kiroIgnore = KiroIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .aiignore in root (relativeDirPath: ".")
      expect(kiroIgnore.getRelativeDirPath()).toBe(".");
      expect(kiroIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(kiroIgnore.getFilePath()).toBe("/workspace/root/.aiignore");
    });
  });
});
