import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GooseIgnore } from "./goose-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("GooseIgnore", () => {
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
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(gooseIgnore).toBeInstanceOf(GooseIgnore);
      expect(gooseIgnore.getRelativeDirPath()).toBe(".");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const gooseIgnore = new GooseIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".gooseignore",
        fileContent: "*.tmp",
      });

      expect(gooseIgnore.getFilePath()).toBe("/custom/path/subdir/.gooseignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new GooseIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".gooseignore",
          fileContent: "",
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new GooseIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".gooseignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const gooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const rulesyncIgnore = gooseIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_FILE_NAME);
    });

    it("should handle empty content", () => {
      const gooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: "",
      });

      const rulesyncIgnore = gooseIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const gooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const rulesyncIgnore = gooseIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create GooseIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const gooseIgnore = GooseIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(gooseIgnore).toBeInstanceOf(GooseIgnore);
      expect(gooseIgnore.getBaseDir()).toBe(testDir);
      expect(gooseIgnore.getRelativeDirPath()).toBe(".");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create GooseIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const gooseIgnore = GooseIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(gooseIgnore.getBaseDir()).toBe("/custom/base");
      expect(gooseIgnore.getFilePath()).toBe("/custom/base/.gooseignore");
      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const gooseIgnore = GooseIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(gooseIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const gooseIgnore = GooseIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .gooseignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(gooseIgnore).toBeInstanceOf(GooseIgnore);
      expect(gooseIgnore.getBaseDir()).toBe(testDir);
      expect(gooseIgnore.getRelativeDirPath()).toBe(".");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .gooseignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .gooseignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .gooseignore file", async () => {
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, "");

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(gooseIgnore.getFileContent()).toBe("");
    });

    it("should handle .gooseignore file with complex patterns", async () => {
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

      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      const fileContent = "*.log\nnode_modules/";
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({});

      expect(gooseIgnore.getBaseDir()).toBe(testDir);
      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .gooseignore file does not exist", async () => {
      await expect(
        GooseIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const gooseignorePath = join(testDir, ".gooseignore");
      await writeFileContent(gooseignorePath, fileContent);

      const gooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = gooseIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const gooseIgnore = new GooseIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".gooseignore",
        fileContent: "*.log",
      });

      expect(gooseIgnore.getBaseDir()).toBe("/test/base");
      expect(gooseIgnore.getRelativeDirPath()).toBe("subdir");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFilePath()).toBe("/test/base/subdir/.gooseignore");
      expect(gooseIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Goose ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      const originalGooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalGooseIgnore.toRulesyncIgnore();
      const roundTripGooseIgnore = GooseIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripGooseIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripGooseIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripGooseIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripGooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalGooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalGooseIgnore.toRulesyncIgnore();
      const roundTripGooseIgnore = GooseIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripGooseIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: "   \n\t\n   ",
      });

      expect(gooseIgnore.getFileContent()).toBe("   \n\t\n   ");
      expect(gooseIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: longPattern,
      });

      expect(gooseIgnore.getFileContent()).toBe(longPattern);
      expect(gooseIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: unicodeContent,
      });

      expect(gooseIgnore.getFileContent()).toBe(unicodeContent);
      expect(gooseIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const gooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      await writeFileContent(gooseIgnore.getFilePath(), gooseIgnore.getFileContent());

      const readGooseIgnore = await GooseIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readGooseIgnore.getFileContent()).toBe(fileContent);
      expect(readGooseIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const gooseIgnore = new GooseIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      await writeFileContent(gooseIgnore.getFilePath(), gooseIgnore.getFileContent());

      const readGooseIgnore = await GooseIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readGooseIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Goose-specific behavior", () => {
    it("should use .gooseignore as the filename", () => {
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent: "*.log",
      });

      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
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
.DS_Store
**/.env
**/.env.*
**/secrets.*`;

      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();
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
        "**/.env",
        "**/.env.*",
        "**/secrets.*",
      ];

      expect(patterns).toEqual(expectedPatterns);
    });

    it("should handle immediate reflection semantics (file content preservation)", () => {
      const fileContent = "# This should reflect immediately\n*.log\ntemp/";
      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      expect(gooseIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const gooseIgnore = GooseIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      expect(gooseIgnore.getRelativeDirPath()).toBe(".");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFilePath()).toBe("/workspace/root/.gooseignore");
    });

    it("should handle Goose default protection patterns", () => {
      const fileContent = `# Goose default protection patterns (explicitly defined)
**/.env
**/.env.*
**/secrets.*`;

      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();
      expect(patterns).toEqual(["**/.env", "**/.env.*", "**/secrets.*"]);
    });

    it("should handle negation patterns to re-include files", () => {
      const fileContent = `.env*
!.env.example
!.env.template`;

      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();
      expect(patterns).toEqual([".env*", "!.env.example", "!.env.template"]);
    });

    it("should handle directory patterns", () => {
      const fileContent = `backup/
secrets/
credentials/`;

      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();
      expect(patterns).toEqual(["backup/", "secrets/", "credentials/"]);
    });

    it("should handle nested file patterns", () => {
      const fileContent = `**/credentials.json
**/*.pem
**/*.key`;

      const gooseIgnore = new GooseIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
        fileContent,
      });

      const patterns = gooseIgnore.getPatterns();
      expect(patterns).toEqual(["**/credentials.json", "**/*.pem", "**/*.key"]);
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion with minimal params", () => {
      const gooseIgnore = GooseIgnore.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
      });

      expect(gooseIgnore).toBeInstanceOf(GooseIgnore);
      expect(gooseIgnore.getBaseDir()).toBe(testDir);
      expect(gooseIgnore.getRelativeDirPath()).toBe(".");
      expect(gooseIgnore.getRelativeFilePath()).toBe(".gooseignore");
      expect(gooseIgnore.getFileContent()).toBe("");
    });

    it("should create instance for deletion with default baseDir", () => {
      const gooseIgnore = GooseIgnore.forDeletion({
        relativeDirPath: ".",
        relativeFilePath: ".gooseignore",
      });

      expect(gooseIgnore.getBaseDir()).toBe(testDir);
    });

    it("should skip validation for deletion instances", () => {
      expect(() => {
        GooseIgnore.forDeletion({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".gooseignore",
        });
      }).not.toThrow();
    });
  });
});
