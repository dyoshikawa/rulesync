import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClineIgnore } from "./cline-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("ClineIgnore", () => {
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
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(clineIgnore).toBeInstanceOf(ClineIgnore);
      expect(clineIgnore.getRelativeDirPath()).toBe(".");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".clineignore",
        fileContent: "*.tmp",
      });

      expect(clineIgnore.getFilePath()).toBe("/custom/path/subdir/.clineignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new ClineIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".clineignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new ClineIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".clineignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(RULESYNC_IGNORE_RELATIVE_FILE_PATH);
    });

    it("should handle empty content", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "",
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create ClineIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(clineIgnore).toBeInstanceOf(ClineIgnore);
      expect(clineIgnore.getBaseDir()).toBe(testDir);
      expect(clineIgnore.getRelativeDirPath()).toBe(".");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create ClineIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(clineIgnore.getBaseDir()).toBe("/custom/base");
      expect(clineIgnore.getFilePath()).toBe("/custom/base/.clineignore");
      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(clineIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .clineignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(clineIgnore).toBeInstanceOf(ClineIgnore);
      expect(clineIgnore.getBaseDir()).toBe(testDir);
      expect(clineIgnore.getRelativeDirPath()).toBe(".");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .clineignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .clineignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .clineignore file", async () => {
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, "");

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(clineIgnore.getFileContent()).toBe("");
    });

    it("should handle .clineignore file with complex patterns", async () => {
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

      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      // process.cwd() is already mocked to return testDir in beforeEach
      const fileContent = "*.log\nnode_modules/";
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({});

      expect(clineIgnore.getBaseDir()).toBe(testDir);
      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .clineignore file does not exist", async () => {
      await expect(
        ClineIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const clineignorePath = join(testDir, ".clineignore");
      await writeFileContent(clineignorePath, fileContent);

      const clineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      const patterns = clineIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = clineIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".clineignore",
        fileContent: "*.log",
      });

      expect(clineIgnore.getBaseDir()).toBe("/test/base");
      expect(clineIgnore.getRelativeDirPath()).toBe("subdir");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFilePath()).toBe("/test/base/subdir/.clineignore");
      expect(clineIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Cline ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // ClineIgnore -> RulesyncIgnore -> ClineIgnore
      const originalClineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalClineIgnore.toRulesyncIgnore();
      const roundTripClineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripClineIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripClineIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripClineIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripClineIgnore.getRelativeFilePath()).toBe(".clineignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalClineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalClineIgnore.toRulesyncIgnore();
      const roundTripClineIgnore = ClineIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripClineIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "   \n\t\n   ",
      });

      expect(clineIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(clineIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: longPattern,
      });

      expect(clineIgnore.getFileContent()).toBe(longPattern);
      expect(clineIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: unicodeContent,
      });

      expect(clineIgnore.getFileContent()).toBe(unicodeContent);
      expect(clineIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(clineIgnore.getFilePath(), clineIgnore.getFileContent());

      // Read file back
      const readClineIgnore = await ClineIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readClineIgnore.getFileContent()).toBe(fileContent);
      expect(readClineIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(clineIgnore.getFilePath(), clineIgnore.getFileContent());

      const readClineIgnore = await ClineIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readClineIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Cline-specific behavior", () => {
    it("should use .clineignore as the filename", () => {
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent: "*.log",
      });

      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
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

      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      const patterns = clineIgnore.getPatterns();
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
      const clineIgnore = new ClineIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(clineIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .clineignore in root (relativeDirPath: ".")
      expect(clineIgnore.getRelativeDirPath()).toBe(".");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFilePath()).toBe("/workspace/root/.clineignore");
    });
  });
});
