import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { AmazonqcliIgnore } from "./amazonqcli-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("AmazonqcliIgnore", () => {
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
      const patterns = ["node_modules/", "*.log"];
      const ignore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: ".q-ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should have supported ignore file names", () => {
      const fileNames = AmazonqcliIgnore.getSupportedIgnoreFileNames();
      expect(fileNames).toContain(".q-ignore");
      expect(fileNames).toContain(".amazonqignore");
    });

    it("should provide proposed patterns", () => {
      const patterns = AmazonqcliIgnore.getProposedPatterns();
      expect(patterns).toBeInstanceOf(Array);
      expect(patterns.length).toBeGreaterThan(0);

      // Should include common development patterns
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("dist/");

      // Should include security-sensitive patterns
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");

      // Should include Amazon Q specific patterns
      expect(patterns).toContain(".amazonq/");
      expect(patterns).toContain("*.q-ignore");
    });
  });

  describe("fromFilePath", () => {
    it("should read .q-ignore file correctly", async () => {
      const ignoreFilePath = join(testDir, ".q-ignore");
      const patterns = ["node_modules/", "*.log", ".env*", "!.env.example", "build/"];

      await writeFile(ignoreFilePath, patterns.join("\n"));

      const ignore = await AmazonqcliIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should read .amazonqignore file correctly", async () => {
      const ignoreFilePath = join(testDir, ".amazonqignore");
      const patterns = ["dist/", "*.tmp", "secrets/"];

      await writeFile(ignoreFilePath, patterns.join("\n"));

      const ignore = await AmazonqcliIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should filter out comments and empty lines", async () => {
      const ignoreFilePath = join(testDir, ".q-ignore");
      const fileContent = [
        "# Amazon Q CLI ignore file",
        "",
        "node_modules/",
        "# Build artifacts",
        "dist/",
        "",
        "*.log",
        "  # Another comment",
      ].join("\n");

      await writeFile(ignoreFilePath, fileContent);

      const ignore = await AmazonqcliIgnore.fromFilePath({ filePath: ignoreFilePath });

      expect(ignore.getPatterns()).toEqual(["node_modules/", "dist/", "*.log"]);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should convert basic patterns correctly", () => {
      const patterns = ["node_modules/", "*.log", ".env"];
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "amazonqcli.md",
        frontmatter: {
          targets: ["amazonqcli"],
          description: "Amazon Q CLI ignore patterns",
        },
        body: patterns.join("\n"),
        fileContent: patterns.join("\n"),
      });

      const ignore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should handle complex patterns with negation", () => {
      const patterns = ["*.env", "!.env.example", "build/", "dist/", "!dist/public/"];
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "amazonqcli.md",
        frontmatter: {
          targets: ["amazonqcli"],
          description: "Amazon Q CLI ignore patterns with negation",
        },
        body: patterns.join("\n"),
        fileContent: patterns.join("\n"),
      });

      const ignore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("should filter out comments from rulesync body", () => {
      const body = [
        "# Amazon Q CLI patterns",
        "node_modules/",
        "",
        "# Build files",
        "dist/",
        "*.log",
      ].join("\n");

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "amazonqcli.md",
        frontmatter: {
          targets: ["amazonqcli"],
          description: "Amazon Q CLI patterns from rulesync body",
        },
        body,
        fileContent: body,
      });

      const ignore = AmazonqcliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(["node_modules/", "dist/", "*.log"]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore correctly", () => {
      const patterns = ["node_modules/", "*.log", ".env"];
      const ignore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: ".q-ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("createWithProposedPatterns", () => {
    it("should create instance with proposed patterns", () => {
      const ignore = AmazonqcliIgnore.createWithProposedPatterns(testDir);

      const patterns = ignore.getPatterns();
      const proposedPatterns = AmazonqcliIgnore.getProposedPatterns();

      expect(patterns).toEqual(proposedPatterns);
    });

    it("should include header comment in file content", () => {
      const ignore = AmazonqcliIgnore.createWithProposedPatterns(testDir);

      expect(ignore.getFileContent()).toContain("# Amazon Q CLI Ignore File");
      expect(ignore.getFileContent()).toContain("# Generated with proposed patterns");
      expect(ignore.getFileContent()).toContain("# See GitHub Issue #205");
    });
  });

  describe("proposed patterns validation", () => {
    it("should include essential security patterns", () => {
      const patterns = AmazonqcliIgnore.getProposedPatterns();

      // Environment files
      expect(patterns).toContain(".env");
      expect(patterns).toContain(".env.*");
      expect(patterns).toContain("!.env.example");

      // Credentials and keys
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.crt");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");

      // Configuration directories
      expect(patterns).toContain("config/production/");
      expect(patterns).toContain("config/secrets/");
    });

    it("should include common development artifacts", () => {
      const patterns = AmazonqcliIgnore.getProposedPatterns();

      // Dependencies
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("venv/");
      expect(patterns).toContain(".venv/");
      expect(patterns).toContain("__pycache__/");

      // Build outputs
      expect(patterns).toContain("build/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("out/");
      expect(patterns).toContain("target/");

      // IDE files
      expect(patterns).toContain(".vscode/");
      expect(patterns).toContain(".idea/");
      expect(patterns).toContain("*.swp");
      expect(patterns).toContain("*.swo");
    });

    it("should include Amazon Q specific patterns", () => {
      const patterns = AmazonqcliIgnore.getProposedPatterns();

      expect(patterns).toContain(".amazonq/");
      expect(patterns).toContain("*.q-ignore");
      expect(patterns).toContain(".q-*");
    });
  });

  describe("validation", () => {
    it("should validate successfully with valid patterns", () => {
      const ignore = new AmazonqcliIgnore({
        baseDir: testDir,
        relativeDirPath: ".amazonq",
        relativeFilePath: ".q-ignore",
        patterns: ["node_modules/", "*.log"],
        fileContent: "node_modules/\n*.log",
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should fail validation with invalid patterns", () => {
      expect(
        () =>
          new AmazonqcliIgnore({
            baseDir: testDir,
            relativeDirPath: ".amazonq",
            relativeFilePath: ".q-ignore",
            patterns: null as any,
            fileContent: "",
          }),
      ).toThrow();
    });
  });

  describe("future implementation support", () => {
    it("should be ready for when Amazon Q adds native ignore file support", async () => {
      // This test verifies the implementation can handle future features
      const ignoreFilePath = join(testDir, ".q-ignore");
      const futureFeaturePatterns = [
        "# Future Amazon Q CLI ignore file",
        "node_modules/",
        "*.log",
        ".env*",
        "!.env.example",
        "# Advanced features",
        "**/*.tmp",
        "**/temp/**",
      ].join("\n");

      await writeFile(ignoreFilePath, futureFeaturePatterns);

      const ignore = await AmazonqcliIgnore.fromFilePath({ filePath: ignoreFilePath });

      // Should handle advanced patterns
      expect(ignore.getPatterns()).toContain("**/*.tmp");
      expect(ignore.getPatterns()).toContain("**/temp/**");
    });

    it("should maintain compatibility with proposed naming conventions", () => {
      const supportedNames = AmazonqcliIgnore.getSupportedIgnoreFileNames();

      // Primary community request
      expect(supportedNames[0]).toBe(".q-ignore");

      // Alternative naming
      expect(supportedNames).toContain(".amazonqignore");
    });
  });
});
