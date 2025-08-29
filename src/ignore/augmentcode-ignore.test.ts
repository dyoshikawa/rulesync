import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AugmentcodeIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("basic functionality", () => {
    it("should create instance with basic parameters", () => {
      const patterns = ["*.csv", "*.sqlite", "test-data/"];
      const ignore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augmentignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should have supported ignore file names", () => {
      const fileNames = AugmentcodeIgnore.getSupportedIgnoreFileNames();
      expect(fileNames).toContain(".augmentignore");
      expect(fileNames).toHaveLength(1);
    });

    it("should provide default security-focused patterns", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();
      expect(patterns).toBeInstanceOf(Array);
      expect(patterns.length).toBeGreaterThan(0);

      // Should include security-sensitive patterns
      expect(patterns).toContain(".env");
      expect(patterns).toContain(".env.*");
      expect(patterns).toContain("!.env.example");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");

      // Should include build artifacts
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("build/");

      // Should include large data files
      expect(patterns).toContain("*.csv");
      expect(patterns).toContain("*.xlsx");
      expect(patterns).toContain("data/");
      expect(patterns).toContain("datasets/");

      // Should include media files
      expect(patterns).toContain("*.mp4");
      expect(patterns).toContain("*.png");
      expect(patterns).toContain("*.jpg");
    });
  });

  describe("fromFilePath", () => {
    it("should read .augmentignore file correctly", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const patterns = ["*.csv", "*.sqlite", "test-data/", "!important.csv"];

      await writeFile(ignoreFilePath, patterns.join("\n"));

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should filter out comments and empty lines", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const fileContent = [
        "# AugmentCode ignore file",
        "",
        "*.csv",
        "# Large data files",
        "*.sqlite",
        "",
        "test-data/",
        "  # Another comment",
      ].join("\n");

      await writeFile(ignoreFilePath, fileContent);

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(["*.csv", "*.sqlite", "test-data/"]);
    });

    it("should preserve negation patterns for re-inclusion", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const patterns = ["*.log", "!important.log", "build/", "!build/public/"];

      await writeFile(ignoreFilePath, patterns.join("\n"));

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(patterns);
      expect(ignore.getPatterns()).toContain("!important.log");
      expect(ignore.getPatterns()).toContain("!build/public/");
    });

    it("should handle complex two-tier patterns", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const fileContent = [
        "# Additional AI-specific exclusions",
        "*.csv",
        "*.sqlite",
        "test/fixtures/large-*.json",
        "internal-docs/",
        "",
        "# Re-include specific documentation the AI needs",
        "!docs/api/**",
        "!docs/architecture.md",
        "!.env.example",
      ].join("\n");

      await writeFile(ignoreFilePath, fileContent);

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      const expectedPatterns = [
        "*.csv",
        "*.sqlite",
        "test/fixtures/large-*.json",
        "internal-docs/",
        "!docs/api/**",
        "!docs/architecture.md",
        "!.env.example",
      ];

      expect(ignore.getPatterns()).toEqual(expectedPatterns);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should convert basic patterns correctly", () => {
      const patterns = ["*.csv", "*.sqlite", "test-data/"];
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "augmentcode.md",
        body: patterns.join("\n"),
        fileContent: patterns.join("\n"),
      });

      const ignore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should handle patterns with negation for re-inclusion", () => {
      const patterns = ["*.log", "!important.log", "docs/**", "!docs/api/**"];
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "augmentcode.md",
        body: patterns.join("\n"),
        fileContent: patterns.join("\n"),
      });

      const ignore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should filter out comments from rulesync body", () => {
      const body = [
        "# AugmentCode patterns",
        "*.csv",
        "",
        "# Test data files",
        "test-data/",
        "!test-data/examples/",
      ].join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "augmentcode.md",
        body,
        fileContent: body,
      });

      const ignore = AugmentcodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(["*.csv", "test-data/", "!test-data/examples/"]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore correctly", () => {
      const patterns = ["*.csv", "*.sqlite", "!important.csv"];
      const ignore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augmentignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });

    it("should use fixed path regardless of original file path", () => {
      const patterns = ["*.csv"];
      const ignore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "custom-ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("should create instance with default patterns", () => {
      const ignore = AugmentcodeIgnore.createWithDefaultPatterns(testDir);

      const patterns = ignore.getPatterns();
      const defaultPatterns = AugmentcodeIgnore.getDefaultPatterns();

      expect(patterns).toEqual(defaultPatterns);
    });

    it("should include header comment in file content", () => {
      const ignore = AugmentcodeIgnore.createWithDefaultPatterns(testDir);

      expect(ignore.getFileContent()).toContain("# AugmentCode Ignore File");
      expect(ignore.getFileContent()).toContain(
        "# Generated with security-focused default patterns",
      );
      expect(ignore.getFileContent()).toContain(
        "# AugmentCode processes .gitignore first, then .augmentignore",
      );
      expect(ignore.getFileContent()).toContain("# Use !pattern to re-include files");
    });
  });

  describe("default patterns validation", () => {
    it("should include essential security patterns", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();

      // Environment files
      expect(patterns).toContain(".env");
      expect(patterns).toContain(".env.*");
      expect(patterns).toContain("!.env.example");

      // Credentials and keys
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.crt");
      expect(patterns).toContain("*.p12");
      expect(patterns).toContain("*.pfx");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");
      expect(patterns).toContain("config/secrets/");

      // Cloud credentials
      expect(patterns).toContain(".aws/");
      expect(patterns).toContain("aws-exports.js");
      expect(patterns).toContain("gcp-service-account*.json");
      expect(patterns).toContain("azure-credentials.json");
    });

    it("should include database and infrastructure patterns", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();

      // Database files
      expect(patterns).toContain("*.db");
      expect(patterns).toContain("*.sqlite");
      expect(patterns).toContain("*.sqlite3");
      expect(patterns).toContain("database.yml");

      // Infrastructure state
      expect(patterns).toContain("*.tfstate");
      expect(patterns).toContain("*.tfstate.*");
      expect(patterns).toContain(".terraform/");
      expect(patterns).toContain("cdk.out/");
    });

    it("should include build artifacts and dependencies", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();

      // Dependencies
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".pnpm-store/");
      expect(patterns).toContain(".yarn/");

      // Build outputs
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("out/");
      expect(patterns).toContain("target/");
      expect(patterns).toContain(".next/");
      expect(patterns).toContain(".nuxt/");
    });

    it("should include large data files and media", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();

      // Data files
      expect(patterns).toContain("*.csv");
      expect(patterns).toContain("*.xlsx");
      expect(patterns).toContain("data/");
      expect(patterns).toContain("datasets/");

      // Media files
      expect(patterns).toContain("*.mp4");
      expect(patterns).toContain("*.avi");
      expect(patterns).toContain("*.png");
      expect(patterns).toContain("*.jpg");
      expect(patterns).toContain("*.jpeg");
      expect(patterns).toContain("*.gif");

      // Archives
      expect(patterns).toContain("*.zip");
      expect(patterns).toContain("*.tar.gz");
      expect(patterns).toContain("*.rar");
    });

    it("should include development environment files", () => {
      const patterns = AugmentcodeIgnore.getDefaultPatterns();

      // IDE files
      expect(patterns).toContain(".vscode/settings.json");
      expect(patterns).toContain(".idea/");
      expect(patterns).toContain("*.swp");
      expect(patterns).toContain("*.swo");
      expect(patterns).toContain("*~");

      // System files
      expect(patterns).toContain(".DS_Store");
      expect(patterns).toContain("Thumbs.db");

      // Temporary files
      expect(patterns).toContain("*.tmp");
      expect(patterns).toContain(".cache/");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain("logs/");
    });
  });

  describe("validation", () => {
    it("should validate successfully with valid patterns", () => {
      const ignore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augmentignore",
        patterns: ["*.csv", "*.sqlite", "!important.csv"],
        fileContent: "*.csv\n*.sqlite\n!important.csv",
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation with invalid patterns", () => {
      expect(() => {
        const ignore = new AugmentcodeIgnore({
          baseDir: testDir,
          relativeDirPath: ".augment",
          relativeFilePath: ".augmentignore",
          patterns: null as any,
          fileContent: "",
        });
        return ignore;
      }).toThrow();
    });
  });

  describe("two-tier ignore system support", () => {
    it("should handle re-inclusion patterns correctly", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const patterns = [
        "# Exclude all images",
        "*.png",
        "*.jpg",
        "# But re-include specific ones",
        "!logo.png",
        "!favicon.jpg",
        "# Exclude all documentation",
        "docs/**",
        "# But re-include API docs",
        "!docs/api/**",
      ];

      await writeFile(ignoreFilePath, patterns.join("\n"));

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      // Should preserve negation patterns
      expect(ignore.getPatterns()).toContain("!logo.png");
      expect(ignore.getPatterns()).toContain("!favicon.jpg");
      expect(ignore.getPatterns()).toContain("!docs/api/**");
    });

    it("should maintain pattern order for proper precedence", async () => {
      const ignoreFilePath = join(testDir, ".augmentignore");
      const orderedPatterns = [
        "*.log",
        "!important.log",
        "build/**",
        "!build/public/**",
        "!build/assets/critical.css",
      ];

      await writeFile(ignoreFilePath, orderedPatterns.join("\n"));

      const ignore = await AugmentcodeIgnore.fromFilePath({ filePath: ignoreFilePath });

      // Pattern order should be preserved for correct evaluation
      expect(ignore.getPatterns()).toEqual(orderedPatterns);
    });
  });

  describe("AugmentCode-specific features", () => {
    it("should be compatible with Git ignore processing", () => {
      // AugmentCode processes .gitignore first, then .augmentignore
      // This test verifies the implementation can work with this two-tier system
      const patterns = [
        "# Additional exclusions beyond .gitignore",
        "*.csv",
        "*.sqlite",
        "# Re-include files that might be in .gitignore",
        "!config/example.json",
        "!docs/README.md",
      ];

      const ignore = new AugmentcodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: ".augmentignore",
        patterns: patterns.filter((p) => !p.startsWith("#")),
        fileContent: patterns.join("\n"),
      });

      expect(ignore.getPatterns()).toContain("!config/example.json");
      expect(ignore.getPatterns()).toContain("!docs/README.md");
    });

    it("should support single file at repository root only", () => {
      // AugmentCode only supports single .augmentignore at repo root
      const fileNames = AugmentcodeIgnore.getSupportedIgnoreFileNames();

      expect(fileNames).toHaveLength(1);
      expect(fileNames[0]).toBe(".augmentignore");
    });
  });
});
