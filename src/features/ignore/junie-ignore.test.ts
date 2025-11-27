import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieIgnore } from "./junie-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("JunieIgnore", () => {
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
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(junieIgnore).toBeInstanceOf(JunieIgnore);
      expect(junieIgnore.getRelativeDirPath()).toBe(".");
      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(junieIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const junieIgnore = new JunieIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".aiignore",
        fileContent: "*.tmp",
      });

      expect(junieIgnore.getFilePath()).toBe("/custom/path/subdir/.aiignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new JunieIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".aiignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new JunieIgnore({
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
      const junieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
    });

    it("should handle empty content", () => {
      const junieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "",
      });

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const junieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create JunieIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const junieIgnore = JunieIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(junieIgnore).toBeInstanceOf(JunieIgnore);
      expect(junieIgnore.getBaseDir()).toBe(testDir);
      expect(junieIgnore.getRelativeDirPath()).toBe(".");
      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create JunieIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const junieIgnore = JunieIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(junieIgnore.getBaseDir()).toBe("/custom/base");
      expect(junieIgnore.getFilePath()).toBe("/custom/base/.aiignore");
      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const junieIgnore = JunieIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(junieIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const junieIgnore = JunieIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .aiignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(junieIgnore).toBeInstanceOf(JunieIgnore);
      expect(junieIgnore.getBaseDir()).toBe(testDir);
      expect(junieIgnore.getRelativeDirPath()).toBe(".");
      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .aiignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .aiignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .aiignore file", async () => {
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, "");

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(junieIgnore.getFileContent()).toBe("");
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

      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({});

      expect(junieIgnore.getBaseDir()).toBe(testDir);
      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .aiignore file does not exist", async () => {
      await expect(
        JunieIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const junieignorePath = join(testDir, ".aiignore");
      await writeFileContent(junieignorePath, fileContent);

      const junieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = junieIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const junieIgnore = new JunieIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".aiignore",
        fileContent: "*.log",
      });

      expect(junieIgnore.getBaseDir()).toBe("/test/base");
      expect(junieIgnore.getRelativeDirPath()).toBe("subdir");
      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(junieIgnore.getFilePath()).toBe("/test/base/subdir/.aiignore");
      expect(junieIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Junie ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // JunieIgnore -> RulesyncIgnore -> JunieIgnore
      const originalJunieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalJunieIgnore.toRulesyncIgnore();
      const roundTripJunieIgnore = JunieIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripJunieIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripJunieIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripJunieIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripJunieIgnore.getRelativeFilePath()).toBe(".aiignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalJunieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalJunieIgnore.toRulesyncIgnore();
      const roundTripJunieIgnore = JunieIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripJunieIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "   \n\t\n   ",
      });

      expect(junieIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(junieIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: longPattern,
      });

      expect(junieIgnore.getFileContent()).toBe(longPattern);
      expect(junieIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: unicodeContent,
      });

      expect(junieIgnore.getFileContent()).toBe(unicodeContent);
      expect(junieIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const junieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(junieIgnore.getFilePath(), junieIgnore.getFileContent());

      // Read file back
      const readJunieIgnore = await JunieIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readJunieIgnore.getFileContent()).toBe(fileContent);
      expect(readJunieIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const junieIgnore = new JunieIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(junieIgnore.getFilePath(), junieIgnore.getFileContent());

      const readJunieIgnore = await JunieIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readJunieIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Junie-specific behavior", () => {
    it("should use .aiignore as the filename", () => {
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent: "*.log",
      });

      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
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

      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();
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
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(junieIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const junieIgnore = JunieIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .aiignore in root (relativeDirPath: ".")
      expect(junieIgnore.getRelativeDirPath()).toBe(".");
      expect(junieIgnore.getRelativeFilePath()).toBe(".aiignore");
      expect(junieIgnore.getFilePath()).toBe("/workspace/root/.aiignore");
    });
  });

  describe("pattern filtering behavior", () => {
    it("should filter out empty lines and comments", () => {
      const fileContent = `# This is a comment
*.log

# Another comment
node_modules/

.env
# Final comment`;

      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should trim whitespace from patterns", () => {
      const fileContent = "  *.log  \n  node_modules/  \n  .env  ";
      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle various comment styles", () => {
      const fileContent = `# Standard comment
*.log
## Double hash comment
node_modules/
### Triple hash comment
.env
#### Documentation comment
build/`;

      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();
      expect(patterns).toEqual(["*.log", "node_modules/", ".env", "build/"]);
    });

    it("should preserve negation patterns", () => {
      const fileContent = `*.log
!important.log
node_modules/
!node_modules/keep/
.env*
!.env.example`;

      const junieIgnore = new JunieIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        fileContent,
      });

      const patterns = junieIgnore.getPatterns();
      expect(patterns).toEqual([
        "*.log",
        "!important.log",
        "node_modules/",
        "!node_modules/keep/",
        ".env*",
        "!.env.example",
      ]);
    });
  });
});
