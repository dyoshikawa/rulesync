import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("GeminiCliIgnore", () => {
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
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(geminiCliIgnore).toBeInstanceOf(GeminiCliIgnore);
      expect(geminiCliIgnore.getRelativeDirPath()).toBe(".");
      expect(geminiCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(geminiCliIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".geminiignore",
        fileContent: "*.tmp",
      });

      expect(geminiCliIgnore.getFilePath()).toBe("/custom/path/subdir/.geminiignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new GeminiCliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".geminiignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new GeminiCliIgnore({
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
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = geminiCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "",
      });

      const rulesyncIgnore = geminiCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const rulesyncIgnore = geminiCliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create GeminiCliIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const geminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(geminiCliIgnore).toBeInstanceOf(GeminiCliIgnore);
      expect(geminiCliIgnore.getBaseDir()).toBe(".");
      expect(geminiCliIgnore.getRelativeDirPath()).toBe(".");
      expect(geminiCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create GeminiCliIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const geminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(geminiCliIgnore.getBaseDir()).toBe("/custom/base");
      expect(geminiCliIgnore.getFilePath()).toBe("/custom/base/.geminiignore");
      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const geminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(geminiCliIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const geminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFile", () => {
    it("should read .geminiignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, fileContent);

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliIgnore).toBeInstanceOf(GeminiCliIgnore);
      expect(geminiCliIgnore.getBaseDir()).toBe(testDir);
      expect(geminiCliIgnore.getRelativeDirPath()).toBe(".");
      expect(geminiCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .geminiignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, fileContent);

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .geminiignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, fileContent);

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .geminiignore file", async () => {
      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, "");

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliIgnore.getFileContent()).toBe("");
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

      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, fileContent);

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to '.' when not provided", async () => {
      // Create .geminiignore in current working directory for this test
      const cwd = process.cwd();
      const originalCwd = cwd;

      try {
        // Change to test directory
        process.chdir(testDir);

        const fileContent = "*.log\nnode_modules/";
        const aiexcludePath = join(testDir, ".geminiignore");
        await writeFileContent(aiexcludePath, fileContent);

        const geminiCliIgnore = await GeminiCliIgnore.fromFile({});

        expect(geminiCliIgnore.getBaseDir()).toBe(".");
        expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
      } finally {
        // Restore original cwd
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .geminiignore file does not exist", async () => {
      await expect(
        GeminiCliIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const aiexcludePath = join(testDir, ".geminiignore");
      await writeFileContent(aiexcludePath, fileContent);

      const geminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      const patterns = geminiCliIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = geminiCliIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".geminiignore",
        fileContent: "*.log",
      });

      expect(geminiCliIgnore.getBaseDir()).toBe("/test/base");
      expect(geminiCliIgnore.getRelativeDirPath()).toBe("subdir");
      expect(geminiCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
      expect(geminiCliIgnore.getFilePath()).toBe("/test/base/subdir/.geminiignore");
      expect(geminiCliIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# Gemini CLI ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // GeminiCliIgnore -> RulesyncIgnore -> GeminiCliIgnore
      const originalGeminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalGeminiCliIgnore.toRulesyncIgnore();
      const roundTripGeminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripGeminiCliIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripGeminiCliIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripGeminiCliIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripGeminiCliIgnore.getRelativeFilePath()).toBe(".geminiignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalGeminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalGeminiCliIgnore.toRulesyncIgnore();
      const roundTripGeminiCliIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripGeminiCliIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: "   \n\t\n   ",
      });

      expect(geminiCliIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(geminiCliIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: longPattern,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(longPattern);
      expect(geminiCliIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const geminiCliIgnore = new GeminiCliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent: unicodeContent,
      });

      expect(geminiCliIgnore.getFileContent()).toBe(unicodeContent);
      expect(geminiCliIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(geminiCliIgnore.getFilePath(), geminiCliIgnore.getFileContent());

      // Read file back
      const readGeminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readGeminiCliIgnore.getFileContent()).toBe(fileContent);
      expect(readGeminiCliIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const geminiCliIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".geminiignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(geminiCliIgnore.getFilePath(), geminiCliIgnore.getFileContent());

      const readGeminiCliIgnore = await GeminiCliIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readGeminiCliIgnore.getFileContent()).toBe(fileContent);
    });
  });
});
