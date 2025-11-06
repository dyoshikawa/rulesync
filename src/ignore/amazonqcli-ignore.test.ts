import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AmazonqcliIgnore } from "./amazonqcli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AmazonqcliIgnore", () => {
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
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(amazonqcliIgnore).toBeInstanceOf(AmazonqcliIgnore);
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe(".");
      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".amazonqignore",
        fileContent: "*.tmp",
      });

      expect(amazonqcliIgnore.getFilePath()).toBe("/custom/path/subdir/.amazonqignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AmazonqcliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".amazonqignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new AmazonqcliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".amazonqignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle .amazonqignore file extension", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const rulesyncIgnore = amazonqcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: "",
      });

      const rulesyncIgnore = amazonqcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const rulesyncIgnore = amazonqcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work with .amazonqignore extension", () => {
      const fileContent = "*.log\nbuild/\ndist/";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const rulesyncIgnore = amazonqcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create AmazonqcliIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore).toBeInstanceOf(AmazonqcliIgnore);
      expect(amazonqcliIgnore.getBaseDir()).toBe(".");
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe(".");
      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create AmazonqcliIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore.getBaseDir()).toBe("/custom/base");
      expect(amazonqcliIgnore.getFilePath()).toBe("/custom/base/.amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should always use .amazonqignore as the output filename", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: "/any/path",
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe(".");
    });
  });

  describe("fromFile", () => {
    it("should read .amazonqignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore).toBeInstanceOf(AmazonqcliIgnore);
      expect(amazonqcliIgnore.getBaseDir()).toBe(testDir);
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe(".");
      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .amazonqignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .amazonqignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .amazonqignore file", async () => {
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, "");

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe("");
    });

    it("should handle .amazonqignore file with complex patterns", async () => {
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
Thumbs.db

# Amazon Q specific patterns
.aws/
*.q-cache
q-temp/`;

      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should use provided baseDir when reading file", async () => {
      // Create .amazonqignore in test directory
      const fileContent = "*.log\nnode_modules/";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      // Read file using explicit baseDir
      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getBaseDir()).toBe(testDir);
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .amazonqignore file does not exist", async () => {
      await expect(
        AmazonqcliIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const patterns = amazonqcliIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = amazonqcliIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".amazonqignore",
        fileContent: "*.log",
      });

      expect(amazonqcliIgnore.getBaseDir()).toBe("/test/base");
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe("subdir");
      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFilePath()).toBe("/test/base/subdir/.amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Amazon Q CLI ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp
.q-cache
q-temp/`;

      // AmazonqcliIgnore -> RulesyncIgnore -> AmazonqcliIgnore
      const originalAmazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAmazonqcliIgnore.toRulesyncIgnore();
      const roundTripAmazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripAmazonqcliIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripAmazonqcliIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripAmazonqcliIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripAmazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp", ".q-cache"];
      const originalContent = patterns.join("\n");

      const originalAmazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAmazonqcliIgnore.toRulesyncIgnore();
      const roundTripAmazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripAmazonqcliIgnore.getPatterns()).toEqual(patterns);
    });

    it("should maintain round-trip conversion with .amazonqignore extension", () => {
      const originalContent = "*.log\n.aws/\n*.q-cache";

      // Create with .amazonqignore extension
      const originalAmazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAmazonqcliIgnore.toRulesyncIgnore();
      const roundTripAmazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripAmazonqcliIgnore.getFileContent()).toBe(originalContent);
      // Note: fromRulesyncIgnore now uses .amazonqignore consistently
      expect(roundTripAmazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: "   \n\t\n   ",
      });

      expect(amazonqcliIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(amazonqcliIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: longPattern,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(longPattern);
      expect(amazonqcliIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/\n.q-缓存";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: unicodeContent,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(unicodeContent);
      expect(amazonqcliIgnore.getPatterns()).toEqual([
        "*.log",
        "節点模块/",
        "環境.env",
        "🏗️build/",
        ".q-缓存",
      ]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(amazonqcliIgnore.getFilePath(), amazonqcliIgnore.getFileContent());

      // Read file back
      const readAmazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readAmazonqcliIgnore.getFileContent()).toBe(fileContent);
      expect(readAmazonqcliIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(amazonqcliIgnore.getFilePath(), amazonqcliIgnore.getFileContent());

      const readAmazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readAmazonqcliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("Amazon Q CLI-specific behavior", () => {
    it("should use .amazonqignore as the primary filename in fromRulesyncIgnore", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
    });

    it("should support .amazonqignore as alternative filename in fromFile", async () => {
      const fileContent = "*.log\nnode_modules/";
      const amazonqignorePath = join(testDir, ".amazonqignore");
      await writeFileContent(amazonqignorePath, fileContent);

      const amazonqcliIgnore = await AmazonqcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
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
# Amazon Q specific patterns
.aws/
*.q-cache
q-temp/
.q-context/`;

      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const patterns = amazonqcliIgnore.getPatterns();
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
        ".aws/",
        "*.q-cache",
        "q-temp/",
        ".q-context/",
      ];

      expect(patterns).toEqual(expectedPatterns);
    });

    it("should handle .amazonqignore format content preservation", () => {
      const fileContent = "# Amazon Q CLI ignore patterns\n*.log\n.q-cache/\nq-temp/";
      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      // Content should be preserved exactly as provided
      expect(amazonqcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const amazonqcliIgnore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/\n.q-cache/",
        }),
      });

      // Should always place .amazonqignore in root (relativeDirPath: ".")
      expect(amazonqcliIgnore.getRelativeDirPath()).toBe(".");
      expect(amazonqcliIgnore.getRelativeFilePath()).toBe(".amazonqignore");
      expect(amazonqcliIgnore.getFilePath()).toBe("/workspace/root/.amazonqignore");
    });

    it("should handle Amazon Q specific ignore patterns", () => {
      const fileContent = `# Amazon Q specific patterns
.aws/
.q-cache/
q-temp/
*.q-session
.q-context/
amazon-q-logs/
q-workspace/
# Standard patterns still work
*.log
node_modules/
build/`;

      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent,
      });

      const patterns = amazonqcliIgnore.getPatterns();
      const expectedPatterns = [
        ".aws/",
        ".q-cache/",
        "q-temp/",
        "*.q-session",
        ".q-context/",
        "amazon-q-logs/",
        "q-workspace/",
        "*.log",
        "node_modules/",
        "build/",
      ];

      expect(patterns).toEqual(expectedPatterns);
    });

    it("should support proposed patterns when no ignore files exist (hypothetical)", () => {
      // This tests the proposed default patterns that might be used
      const proposedPatterns = `# Proposed Amazon Q CLI default ignore patterns
.aws/
*.q-cache
.q-context/
q-temp/
amazon-q-logs/
node_modules/
.env*
build/
dist/
*.log`;

      const amazonqcliIgnore = new AmazonqcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".amazonqignore",
        fileContent: proposedPatterns,
      });

      expect(amazonqcliIgnore.getFileContent()).toBe(proposedPatterns);
      const patterns = amazonqcliIgnore.getPatterns();
      expect(patterns).toContain(".aws/");
      expect(patterns).toContain("*.q-cache");
      expect(patterns).toContain(".q-context/");
      expect(patterns).toContain("q-temp/");
      expect(patterns).toContain("amazon-q-logs/");
    });
  });
});
