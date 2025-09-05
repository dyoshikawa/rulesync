import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("CursorIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(cursorIgnore).toBeInstanceOf(CursorIgnore);
      expect(cursorIgnore.getRelativeDirPath()).toBe(".");
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".cursorignore",
        fileContent: "*.tmp",
      });

      expect(cursorIgnore.getFilePath()).toBe("/custom/path/subdir/.cursorignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new CursorIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".cursorignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new CursorIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".cursorignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "",
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create CursorIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(cursorIgnore).toBeInstanceOf(CursorIgnore);
      expect(cursorIgnore.getBaseDir()).toBe(".");
      expect(cursorIgnore.getRelativeDirPath()).toBe(".");
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create CursorIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getBaseDir()).toBe("/custom/base");
      expect(cursorIgnore.getFilePath()).toBe("/custom/base/.cursorignore");
      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(cursorIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .cursorignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, fileContent);

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(cursorIgnore).toBeInstanceOf(CursorIgnore);
      expect(cursorIgnore.getBaseDir()).toBe(testDir);
      expect(cursorIgnore.getRelativeDirPath()).toBe(".");
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .cursorignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, fileContent);

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .cursorignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, fileContent);

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .cursorignore file", async () => {
      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, "");

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(cursorIgnore.getFileContent()).toBe("");
    });

    it("should handle .cursorignore file with complex patterns", async () => {
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

      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, fileContent);

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to '.' when not provided", async () => {
      // Create .cursorignore in current working directory for this test
      const cwd = process.cwd();
      const originalCwd = cwd;

      try {
        // Change to test directory
        process.chdir(testDir);

        const fileContent = "*.log\nnode_modules/";
        const cursorignorePath = join(testDir, ".cursorignore");
        await writeFileContent(cursorignorePath, fileContent);

        const cursorIgnore = await CursorIgnore.fromFile({});

        expect(cursorIgnore.getBaseDir()).toBe(".");
        expect(cursorIgnore.getFileContent()).toBe(fileContent);
      } finally {
        // Restore original cwd
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .cursorignore file does not exist", async () => {
      await expect(
        CursorIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const cursorignorePath = join(testDir, ".cursorignore");
      await writeFileContent(cursorignorePath, fileContent);

      const cursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      const patterns = cursorIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = cursorIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log",
      });

      expect(cursorIgnore.getBaseDir()).toBe("/test/base");
      expect(cursorIgnore.getRelativeDirPath()).toBe("subdir");
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getFilePath()).toBe("/test/base/subdir/.cursorignore");
      expect(cursorIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Cursor ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // CursorIgnore -> RulesyncIgnore -> CursorIgnore
      const originalCursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalCursorIgnore.toRulesyncIgnore();
      const roundTripCursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripCursorIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripCursorIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripCursorIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripCursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalCursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalCursorIgnore.toRulesyncIgnore();
      const roundTripCursorIgnore = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripCursorIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "   \n\t\n   ",
      });

      expect(cursorIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(cursorIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: longPattern,
      });

      expect(cursorIgnore.getFileContent()).toBe(longPattern);
      expect(cursorIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: unicodeContent,
      });

      expect(cursorIgnore.getFileContent()).toBe(unicodeContent);
      expect(cursorIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(cursorIgnore.getFilePath(), cursorIgnore.getFileContent());

      // Read file back
      const readCursorIgnore = await CursorIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readCursorIgnore.getFileContent()).toBe(fileContent);
      expect(readCursorIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(cursorIgnore.getFilePath(), cursorIgnore.getFileContent());

      const readCursorIgnore = await CursorIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readCursorIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Cursor-specific behavior", () => {
    it("should use .cursorignore as the filename", () => {
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "*.log",
      });

      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
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

      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      const patterns = cursorIgnore.getPatterns();
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
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(cursorIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .cursorignore in root (relativeDirPath: ".")
      expect(cursorIgnore.getRelativeDirPath()).toBe(".");
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getFilePath()).toBe("/workspace/root/.cursorignore");
    });
  });
});
