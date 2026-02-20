import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RooIgnore", () => {
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
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(rooIgnore).toBeInstanceOf(RooIgnore);
      expect(rooIgnore.getRelativeDirPath()).toBe(".");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const rooIgnore = new RooIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".rooignore",
        fileContent: "*.tmp",
      });

      expect(rooIgnore.getFilePath()).toBe("/custom/path/subdir/.rooignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        new RooIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rooignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        new RooIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".rooignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: "",
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create RooIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(rooIgnore).toBeInstanceOf(RooIgnore);
      expect(rooIgnore.getBaseDir()).toBe(testDir);
      expect(rooIgnore.getRelativeDirPath()).toBe(".");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create RooIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(rooIgnore.getBaseDir()).toBe("/custom/base");
      expect(rooIgnore.getFilePath()).toBe("/custom/base/.rooignore");
      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(rooIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .rooignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(rooIgnore).toBeInstanceOf(RooIgnore);
      expect(rooIgnore.getBaseDir()).toBe(testDir);
      expect(rooIgnore.getRelativeDirPath()).toBe(".");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .rooignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .rooignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .rooignore file", async () => {
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, "");

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(rooIgnore.getFileContent()).toBe("");
    });

    it("should handle .rooignore file with complex patterns", async () => {
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

      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({});

      expect(rooIgnore.getBaseDir()).toBe(testDir);
      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .rooignore file does not exist", async () => {
      await expect(
        RooIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const rooignorePath = join(testDir, ".rooignore");
      await writeFileContent(rooignorePath, fileContent);

      const rooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      const patterns = rooIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = rooIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const rooIgnore = new RooIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".rooignore",
        fileContent: "*.log",
      });

      expect(rooIgnore.getBaseDir()).toBe("/test/base");
      expect(rooIgnore.getRelativeDirPath()).toBe("subdir");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFilePath()).toBe("/test/base/subdir/.rooignore");
      expect(rooIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Roo ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // RooIgnore -> RulesyncIgnore -> RooIgnore
      const originalRooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalRooIgnore.toRulesyncIgnore();
      const roundTripRooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripRooIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripRooIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripRooIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripRooIgnore.getRelativeFilePath()).toBe(".rooignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalRooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalRooIgnore.toRulesyncIgnore();
      const roundTripRooIgnore = RooIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripRooIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: "   \n\t\n   ",
      });

      expect(rooIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(rooIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: longPattern,
      });

      expect(rooIgnore.getFileContent()).toBe(longPattern);
      expect(rooIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: unicodeContent,
      });

      expect(rooIgnore.getFileContent()).toBe(unicodeContent);
      expect(rooIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(rooIgnore.getFilePath(), rooIgnore.getFileContent());

      // Read file back
      const readRooIgnore = await RooIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readRooIgnore.getFileContent()).toBe(fileContent);
      expect(readRooIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(rooIgnore.getFilePath(), rooIgnore.getFileContent());

      const readRooIgnore = await RooIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readRooIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Roo Code specific behavior", () => {
    it("should use .rooignore as the filename", () => {
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent: "*.log",
      });

      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
    });

    it("should work with gitignore syntax patterns", () => {
      const fileContent = `# Standard gitignore patterns for Roo Code
*.log
*.tmp
build/
node_modules/
.env*
!.env.example
**/*.cache
temp*/
.DS_Store`;

      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      const patterns = rooIgnore.getPatterns();
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
      const fileContent = "# This should reflect immediately in Roo Code\n*.log\ntemp/";
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(rooIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .rooignore in root (relativeDirPath: ".")
      expect(rooIgnore.getRelativeDirPath()).toBe(".");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFilePath()).toBe("/workspace/root/.rooignore");
    });

    it("should handle self-protection pattern (.rooignore implicitly ignored)", () => {
      const fileContent = "*.log\nnode_modules/\n# .rooignore itself is always ignored implicitly";
      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Content should be preserved - self-protection is handled by Roo Code itself
      expect(rooIgnore.getFileContent()).toBe(fileContent);
      expect(rooIgnore.getPatterns()).toEqual(["*.log", "node_modules/"]);
    });

    it("should handle strict blocking semantics (content preservation)", () => {
      const fileContent = `# Strict blocking - both read and write prohibited
*.secret
confidential/
private.key
.env.production`;

      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Content should be preserved exactly for strict blocking implementation
      expect(rooIgnore.getFileContent()).toBe(fileContent);
      const patterns = rooIgnore.getPatterns();
      expect(patterns).toEqual(["*.secret", "confidential/", "private.key", ".env.production"]);
    });

    it("should support bypass mechanism patterns", () => {
      const fileContent = `# Files that can be explicitly mentioned with @/path/to/file
*.log
build/
node_modules/
# Bypass: @/specific/important.log would still be accessible`;

      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Content preservation allows for bypass mechanism documentation
      expect(rooIgnore.getFileContent()).toBe(fileContent);
      expect(rooIgnore.getPatterns()).toEqual(["*.log", "build/", "node_modules/"]);
    });

    it("should handle visual indicator patterns (lock icon support)", () => {
      const fileContent = `# Files that will show lock icon 🔒 when showRooIgnoredFiles=true
*.private
sensitive/
credentials.json
api-keys.txt`;

      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      expect(rooIgnore.getFileContent()).toBe(fileContent);
      expect(rooIgnore.getPatterns()).toEqual([
        "*.private",
        "sensitive/",
        "credentials.json",
        "api-keys.txt",
      ]);
    });

    it("should work with Roo Code 3.8+ specifications", () => {
      const fileContent = `# Roo Code 3.8+ official support (2025-03-13)
# Workspace root folder only
*.log
temp/
build/
node_modules/
.env*
!.env.example`;

      const rooIgnore = new RooIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        fileContent,
      });

      // Should maintain all specifications for Roo Code 3.8+
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFileContent()).toBe(fileContent);

      const patterns = rooIgnore.getPatterns();
      expect(patterns).toEqual([
        "*.log",
        "temp/",
        "build/",
        "node_modules/",
        ".env*",
        "!.env.example",
      ]);
    });
  });
});
