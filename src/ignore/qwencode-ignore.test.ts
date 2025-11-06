import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("QwencodeIgnore", () => {
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
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(qwencodeIgnore).toBeInstanceOf(QwencodeIgnore);
      expect(qwencodeIgnore.getRelativeDirPath()).toBe(".");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(qwencodeIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".geminiignore",
        fileContent: "*.tmp",
      });

      expect(qwencodeIgnore.getFilePath()).toBe("/custom/path/subdir/.geminiignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new QwencodeIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".geminiignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new QwencodeIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".geminiignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "",
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create QwencodeIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qwencodeIgnore).toBeInstanceOf(QwencodeIgnore);
      expect(qwencodeIgnore.getBaseDir()).toBe(process.cwd());
      expect(qwencodeIgnore.getRelativeDirPath()).toBe(".");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create QwencodeIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(qwencodeIgnore.getBaseDir()).toBe("/custom/base");
      expect(qwencodeIgnore.getFilePath()).toBe("/custom/base/.geminiignore");
      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qwencodeIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .geminiignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, fileContent);

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(qwencodeIgnore).toBeInstanceOf(QwencodeIgnore);
      expect(qwencodeIgnore.getBaseDir()).toBe(testDir);
      expect(qwencodeIgnore.getRelativeDirPath()).toBe(".");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .geminiignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, fileContent);

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .geminiignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, fileContent);

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .geminiignore file", async () => {
      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, "");

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(qwencodeIgnore.getFileContent()).toBe("");
    });

    it("should handle .geminiignore file with complex patterns", async () => {
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

      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, fileContent);

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to '.' when not provided", async () => {
      // Create .geminiignore in current working directory for this test
      const cwd = process.cwd();
      const originalCwd = cwd;

      try {
        // Change to test directory
        process.chdir(testDir);

        const fileContent = "*.log\nnode_modules/";
        const geminiignorePath = ".geminiignore";
        await writeFileContent(geminiignorePath, fileContent);

        const qwencodeIgnore = await QwencodeIgnore.fromFile({});

        expect(qwencodeIgnore.getBaseDir()).toBe(process.cwd());
        expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
      } finally {
        // Restore original cwd
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .geminiignore file does not exist", async () => {
      await expect(
        QwencodeIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const geminiignorePath = join(testDir, ".geminiignore");
      await writeFileContent(geminiignorePath, fileContent);

      const qwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = qwencodeIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = qwencodeIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log",
      });

      expect(qwencodeIgnore.getBaseDir()).toBe("/test/base");
      expect(qwencodeIgnore.getRelativeDirPath()).toBe("subdir");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(qwencodeIgnore.getFilePath()).toBe("/test/base/subdir/.geminiignore");
      expect(qwencodeIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# QwenCode ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // QwencodeIgnore -> RulesyncIgnore -> QwencodeIgnore
      const originalQwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalQwencodeIgnore.toRulesyncIgnore();
      const roundTripQwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripQwencodeIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripQwencodeIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripQwencodeIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripQwencodeIgnore.getRelativeFilePath()).toBe(".geminiignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalQwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalQwencodeIgnore.toRulesyncIgnore();
      const roundTripQwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripQwencodeIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "   \n\t\n   ",
      });

      expect(qwencodeIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(qwencodeIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: longPattern,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(longPattern);
      expect(qwencodeIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: unicodeContent,
      });

      expect(qwencodeIgnore.getFileContent()).toBe(unicodeContent);
      expect(qwencodeIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(qwencodeIgnore.getFilePath(), qwencodeIgnore.getFileContent());

      // Read file back
      const readQwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readQwencodeIgnore.getFileContent()).toBe(fileContent);
      expect(readQwencodeIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(qwencodeIgnore.getFilePath(), qwencodeIgnore.getFileContent());

      const readQwencodeIgnore = await QwencodeIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readQwencodeIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("pattern parsing", () => {
    it("should filter out comment lines and empty lines", () => {
      const fileContent = `# This is a comment
*.log
# Another comment

node_modules/
# Final comment
.env`;

      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = qwencodeIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle patterns with leading/trailing whitespace", () => {
      const fileContent = "  *.log  \n\tnode_modules/\t\n  .env  ";

      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = qwencodeIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should preserve special gitignore patterns", () => {
      const fileContent = "!important.log\n**/*.tmp\n/root-only\ndir/\n*.{js,ts}";

      const qwencodeIgnore = new QwencodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = qwencodeIgnore.getPatterns();
      expect(patterns).toEqual(["!important.log", "**/*.tmp", "/root-only", "dir/", "*.{js,ts}"]);
    });
  });
});
