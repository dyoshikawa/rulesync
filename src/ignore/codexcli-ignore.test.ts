import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("CodexcliIgnore", () => {
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
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(codexcliIgnore).toBeInstanceOf(CodexcliIgnore);
      expect(codexcliIgnore.getRelativeDirPath()).toBe(".");
      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
      expect(codexcliIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".codexignore",
        fileContent: "*.tmp",
      });

      expect(codexcliIgnore.getFilePath()).toBe("/custom/path/subdir/.codexignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new CodexcliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".codexignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new CodexcliIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".codexignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const rulesyncIgnore = codexcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: "",
      });

      const rulesyncIgnore = codexcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const rulesyncIgnore = codexcliIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create CodexcliIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(codexcliIgnore).toBeInstanceOf(CodexcliIgnore);
      expect(codexcliIgnore.getBaseDir()).toBe(".");
      expect(codexcliIgnore.getRelativeDirPath()).toBe(".");
      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create CodexcliIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(codexcliIgnore.getBaseDir()).toBe("/custom/base");
      expect(codexcliIgnore.getFilePath()).toBe("/custom/base/.codexignore");
      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(codexcliIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns", () => {
      const fileContent = "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should always set validate to true for validation consistency", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      // The comment in the implementation indicates validate: true
      expect(() => codexcliIgnore.validate()).not.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read .codexignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, fileContent);

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(codexcliIgnore).toBeInstanceOf(CodexcliIgnore);
      expect(codexcliIgnore.getBaseDir()).toBe(testDir);
      expect(codexcliIgnore.getRelativeDirPath()).toBe(".");
      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .codexignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, fileContent);

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .codexignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, fileContent);

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .codexignore file", async () => {
      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, "");

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(codexcliIgnore.getFileContent()).toBe("");
    });

    it("should handle .codexignore file with complex patterns", async () => {
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

      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, fileContent);

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to '.' when not provided", async () => {
      // Create .codexignore in current working directory for this test
      const cwd = process.cwd();
      const originalCwd = cwd;

      try {
        // Change to test directory
        process.chdir(testDir);

        const fileContent = "*.log\nnode_modules/";
        const codexignorePath = ".codexignore";
        await writeFileContent(codexignorePath, fileContent);

        const codexcliIgnore = await CodexcliIgnore.fromFile({});

        expect(codexcliIgnore.getBaseDir()).toBe(".");
        expect(codexcliIgnore.getFileContent()).toBe(fileContent);
      } finally {
        // Restore original cwd
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .codexignore file does not exist", async () => {
      await expect(
        CodexcliIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const codexignorePath = join(testDir, ".codexignore");
      await writeFileContent(codexignorePath, fileContent);

      const codexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const patterns = codexcliIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = codexcliIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".codexignore",
        fileContent: "*.log",
      });

      expect(codexcliIgnore.getBaseDir()).toBe("/test/base");
      expect(codexcliIgnore.getRelativeDirPath()).toBe("subdir");
      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
      expect(codexcliIgnore.getFilePath()).toBe("/test/base/subdir/.codexignore");
      expect(codexcliIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# CodexCLI ignore patterns
*.log
node_modules/
.env*
build/
dist/
*.tmp`;

      // CodexcliIgnore -> RulesyncIgnore -> CodexcliIgnore
      const originalCodexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalCodexcliIgnore.toRulesyncIgnore();
      const roundTripCodexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripCodexcliIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripCodexcliIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripCodexcliIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripCodexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalCodexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalCodexcliIgnore.toRulesyncIgnore();
      const roundTripCodexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripCodexcliIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: "   \n\t\n   ",
      });

      expect(codexcliIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(codexcliIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: longPattern,
      });

      expect(codexcliIgnore.getFileContent()).toBe(longPattern);
      expect(codexcliIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: unicodeContent,
      });

      expect(codexcliIgnore.getFileContent()).toBe(unicodeContent);
      expect(codexcliIgnore.getPatterns()).toEqual(["*.log", "節点模块/", "環境.env", "🏗️build/"]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(codexcliIgnore.getFilePath(), codexcliIgnore.getFileContent());

      // Read file back
      const readCodexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readCodexcliIgnore.getFileContent()).toBe(fileContent);
      expect(readCodexcliIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const codexcliIgnore = new CodexcliIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(codexcliIgnore.getFilePath(), codexcliIgnore.getFileContent());

      const readCodexcliIgnore = await CodexcliIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readCodexcliIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("CodexCLI-specific behavior", () => {
    it("should use .codexignore as the filename", () => {
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent: "*.log",
      });

      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
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

      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const patterns = codexcliIgnore.getPatterns();
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
      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      // Content should be preserved exactly as provided for immediate reflection
      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should work in workspace root context", () => {
      const codexcliIgnore = CodexcliIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .codexignore in root (relativeDirPath: ".")
      expect(codexcliIgnore.getRelativeDirPath()).toBe(".");
      expect(codexcliIgnore.getRelativeFilePath()).toBe(".codexignore");
      expect(codexcliIgnore.getFilePath()).toBe("/workspace/root/.codexignore");
    });

    it("should handle CodexCLI-specific ignore patterns", () => {
      const fileContent = `# CodexCLI specific patterns
*.codex
codex_output/
.codex_cache/
temp_codex_*
**/*.codex.bak
generated_by_codex/`;

      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const patterns = codexcliIgnore.getPatterns();
      const expectedPatterns = [
        "*.codex",
        "codex_output/",
        ".codex_cache/",
        "temp_codex_*",
        "**/*.codex.bak",
        "generated_by_codex/",
      ];

      expect(patterns).toEqual(expectedPatterns);
      expect(codexcliIgnore.getFileContent()).toBe(fileContent);
    });

    it("should support AI model output filtering patterns", () => {
      const fileContent = `# AI model outputs and temporary files
*.ai_output
ai_temp/
model_cache/
*_generated.temp
.ai_session_*
**/*_model_output.*`;

      const codexcliIgnore = new CodexcliIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codexignore",
        fileContent,
      });

      const patterns = codexcliIgnore.getPatterns();
      expect(patterns).toHaveLength(6);
      expect(patterns).toContain("*.ai_output");
      expect(patterns).toContain("ai_temp/");
      expect(patterns).toContain("**/*_model_output.*");
    });
  });
});
