import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AugmentcodeIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: "*.log\nnode_modules/",
      });

      expect(augmentcodeIgnore).toBeInstanceOf(AugmentcodeIgnore);
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
      expect(augmentcodeIgnore.getFileContent()).toBe("*.log\nnode_modules/");
    });

    it("should create instance with custom baseDir", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: "/custom/path",
        relativeDirPath: "subdir",
        relativeFilePath: ".augmentignore",
        fileContent: "*.tmp",
      });

      expect(augmentcodeIgnore.getFilePath()).toBe("/custom/path/subdir/.augmentignore");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AugmentcodeIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".augmentignore",
          fileContent: "", // empty content should be valid
        });
      }).not.toThrow();
    });

    it("should skip validation when validate=false", () => {
      expect(() => {
        const _instance = new AugmentcodeIgnore({
          relativeDirPath: ".",
          relativeFilePath: ".augmentignore",
          fileContent: "any content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const rulesyncIgnore = augmentcodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should handle empty content", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: "",
      });

      const rulesyncIgnore = augmentcodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe("");
    });

    it("should preserve patterns and formatting", () => {
      const fileContent = "# Generated files\n*.log\n*.tmp\n\n# Dependencies\nnode_modules/\n.env*";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const rulesyncIgnore = augmentcodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });

    it("should preserve negation patterns (! prefix)", () => {
      const fileContent = "*.log\nnode_modules/\n!important.log\n!keep.txt";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const rulesyncIgnore = augmentcodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create AugmentcodeIgnore from RulesyncIgnore with default baseDir", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(augmentcodeIgnore).toBeInstanceOf(AugmentcodeIgnore);
      expect(augmentcodeIgnore.getBaseDir()).toBe(testDir);
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should create AugmentcodeIgnore from RulesyncIgnore with custom baseDir", () => {
      const fileContent = "*.tmp\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(augmentcodeIgnore.getBaseDir()).toBe("/custom/base");
      expect(augmentcodeIgnore.getFilePath()).toBe("/custom/base/.augmentignore");
      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty content", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "",
      });

      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe("");
    });

    it("should preserve complex patterns including negation", () => {
      const fileContent =
        "# Comments\n*.log\n**/*.tmp\n!important.tmp\nnode_modules/\n.env*\n!.env.example";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent,
      });

      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should always create with repository root placement", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".rulesync",
        relativeFilePath: ".rulesignore",
        fileContent: "*.log",
      });

      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      // AugmentCode uses single .augmentignore file at repository root
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
    });
  });

  describe("fromFile", () => {
    it("should read .augmentignore file from baseDir with default baseDir", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(augmentcodeIgnore).toBeInstanceOf(AugmentcodeIgnore);
      expect(augmentcodeIgnore.getBaseDir()).toBe(testDir);
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .augmentignore file with validation enabled by default", async () => {
      const fileContent = "*.log\nnode_modules/";
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should read .augmentignore file with validation disabled", async () => {
      const fileContent = "*.log\nnode_modules/";
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle empty .augmentignore file", async () => {
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, "");

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe("");
    });

    it("should handle .augmentignore file with AugmentCode specific patterns", async () => {
      const fileContent = `# Security-focused patterns
.env
.env.*
!.env.example
*.key
*.pem
*.p12
*.crt
*.cer

# Build outputs
build/
dist/
*.map

# Dependencies
node_modules/
.pnpm-store/

# Logs and debug files
*.log
logs/
debug/

# IDE and editor files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
Thumbs.db
desktop.ini

# Temporary files
*.tmp
*.temp
.cache/`;

      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should default baseDir to process.cwd() when not provided", async () => {
      const fileContent = "*.log\nnode_modules/";
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({});

      expect(augmentcodeIgnore.getBaseDir()).toBe(testDir);
      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should throw error when .augmentignore file does not exist", async () => {
      await expect(
        AugmentcodeIgnore.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with Windows line endings", async () => {
      const fileContent = "*.log\r\nnode_modules/\r\n.env";
      const augmentignorePath = join(testDir, ".augmentignore");
      await writeFileContent(augmentignorePath, fileContent);

      const augmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("inheritance from ToolIgnore", () => {
    it("should inherit getPatterns method", () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should inherit validation method", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: "*.log\nnode_modules/",
      });

      const result = augmentcodeIgnore.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should inherit file path methods from ToolFile", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: "/test/base",
        relativeDirPath: "subdir",
        relativeFilePath: ".augmentignore",
        fileContent: "*.log",
      });

      expect(augmentcodeIgnore.getBaseDir()).toBe("/test/base");
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe("subdir");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
      expect(augmentcodeIgnore.getFilePath()).toBe("/test/base/subdir/.augmentignore");
      expect(augmentcodeIgnore.getFileContent()).toBe("*.log");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content integrity in round-trip conversion", () => {
      const originalContent = `# AugmentCode ignore patterns
*.log
node_modules/
.env*
!.env.example
build/
dist/
*.tmp`;

      // AugmentcodeIgnore -> RulesyncIgnore -> AugmentcodeIgnore
      const originalAugmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAugmentcodeIgnore.toRulesyncIgnore();
      const roundTripAugmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        rulesyncIgnore,
      });

      expect(roundTripAugmentcodeIgnore.getFileContent()).toBe(originalContent);
      expect(roundTripAugmentcodeIgnore.getBaseDir()).toBe(testDir);
      expect(roundTripAugmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(roundTripAugmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
    });

    it("should maintain patterns in round-trip conversion", () => {
      const patterns = ["*.log", "node_modules/", ".env", "!.env.example", "build/", "*.tmp"];
      const originalContent = patterns.join("\n");

      const originalAugmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: originalContent,
      });

      const rulesyncIgnore = originalAugmentcodeIgnore.toRulesyncIgnore();
      const roundTripAugmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(roundTripAugmentcodeIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("edge cases", () => {
    it("should handle file content with only whitespace", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: "   \n\t\n   ",
      });

      expect(augmentcodeIgnore.getFileContent()).toBe("   \n\t\n   ");
      // Patterns are trimmed and empty lines are filtered out
      expect(augmentcodeIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file content with mixed line endings", () => {
      const fileContent = "*.log\r\nnode_modules/\n.env\r\nbuild/";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(fileContent);
    });

    it("should handle very long patterns", () => {
      const longPattern = "a".repeat(1000);
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: longPattern,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(longPattern);
      expect(augmentcodeIgnore.getPatterns()).toEqual([longPattern]);
    });

    it("should handle unicode characters in patterns", () => {
      const unicodeContent = "*.log\n節点模块/\n環境.env\n🏗️build/";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: unicodeContent,
      });

      expect(augmentcodeIgnore.getFileContent()).toBe(unicodeContent);
      expect(augmentcodeIgnore.getPatterns()).toEqual([
        "*.log",
        "節点模块/",
        "環境.env",
        "🏗️build/",
      ]);
    });
  });

  describe("file integration", () => {
    it("should write and read file correctly", async () => {
      const fileContent = "*.log\nnode_modules/\n.env";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(augmentcodeIgnore.getFilePath(), augmentcodeIgnore.getFileContent());

      // Read file back
      const readAugmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: testDir,
      });

      expect(readAugmentcodeIgnore.getFileContent()).toBe(fileContent);
      expect(readAugmentcodeIgnore.getPatterns()).toEqual(["*.log", "node_modules/", ".env"]);
    });

    it("should handle subdirectory placement", async () => {
      const subDir = join(testDir, "project", "config");
      await ensureDir(subDir);

      const fileContent = "*.log\nbuild/";
      const augmentcodeIgnore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: "project/config",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      // Write file using writeFileContent utility
      await writeFileContent(augmentcodeIgnore.getFilePath(), augmentcodeIgnore.getFileContent());

      const readAugmentcodeIgnore = await AugmentcodeIgnore.fromFile({
        baseDir: join(testDir, "project/config"),
      });

      expect(readAugmentcodeIgnore.getFileContent()).toBe(fileContent);
    });
  });

  describe("AugmentCode-specific behavior", () => {
    it("should use .augmentignore as the filename", () => {
      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent: "*.log",
      });

      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
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

      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();
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

    it("should handle two-tier exclusion approach semantics", () => {
      const fileContent = `# First tier: standard gitignore patterns
*.log
node_modules/
build/

# Second tier: AugmentCode specific patterns
.env
.env.*
!.env.example

# Re-include important files that Git might ignore
!important.min.js
!vendor/critical.css`;

      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();
      expect(patterns).toContain("!important.min.js");
      expect(patterns).toContain("!vendor/critical.css");
      expect(patterns).toContain("!.env.example");
    });

    it("should work in repository root context", () => {
      const augmentcodeIgnore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: "/workspace/root",
        rulesyncIgnore: new RulesyncIgnore({
          relativeDirPath: ".rulesync",
          relativeFilePath: ".rulesignore",
          fileContent: "*.log\nnode_modules/",
        }),
      });

      // Should always place .augmentignore in root (relativeDirPath: ".")
      expect(augmentcodeIgnore.getRelativeDirPath()).toBe(".");
      expect(augmentcodeIgnore.getRelativeFilePath()).toBe(".augmentignore");
      expect(augmentcodeIgnore.getFilePath()).toBe("/workspace/root/.augmentignore");
    });

    it("should handle security-focused default patterns", () => {
      const fileContent = `# Security-focused patterns
.env
.env.*
!.env.example
*.key
*.pem
*.p12
*.crt
*.cer
*.keystore
config/secrets.yml
secrets.json
private/
confidential/
**/*password*
**/*secret*
**/*credential*`;

      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("**/*password*");
      expect(patterns).toContain("**/*secret*");
      expect(patterns).toContain("**/*credential*");
    });

    it("should support negation patterns for re-including files", () => {
      const fileContent = `# Exclude all env files first
.env*

# But include examples and templates
!.env.example
!.env.template
!.env.sample

# Exclude all config files
config/*

# But keep public configs
!config/public.yml
!config/app.default.json`;

      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();
      expect(patterns).toContain(".env*");
      expect(patterns).toContain("!.env.example");
      expect(patterns).toContain("!.env.template");
      expect(patterns).toContain("!.env.sample");
      expect(patterns).toContain("config/*");
      expect(patterns).toContain("!config/public.yml");
      expect(patterns).toContain("!config/app.default.json");
    });

    it("should work with standard wildcard patterns", () => {
      const fileContent = `# Single char wildcard
?.log
test?.txt

# Multi char wildcard  
*.log
temp*

# Directory wildcard
**/node_modules/
**/build/
**/*.cache

# Mixed patterns
src/**/*.test.js
docs/**/temp.*`;

      const augmentcodeIgnore = new AugmentcodeIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".augmentignore",
        fileContent,
      });

      const patterns = augmentcodeIgnore.getPatterns();
      expect(patterns).toContain("?.log");
      expect(patterns).toContain("test?.txt");
      expect(patterns).toContain("**/node_modules/");
      expect(patterns).toContain("src/**/*.test.js");
      expect(patterns).toContain("docs/**/temp.*");
    });
  });
});
