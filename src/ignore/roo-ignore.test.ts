import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("RooIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("Constructor", () => {
    it("should create RooIgnore with valid patterns", () => {
      const patterns = ["*.log", "node_modules/", "dist/"];

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(rooIgnore.getPatterns()).toEqual(patterns);
    });

    it("should create RooIgnore with empty patterns", () => {
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns: [],
        fileContent: "",
      });

      expect(rooIgnore.getPatterns()).toEqual([]);
    });

    it("should validate patterns array", () => {
      expect(
        () =>
          new RooIgnore({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".rooignore",
            patterns: null as any,
            fileContent: "",
          }),
      ).toThrow("Patterns must be defined");
    });

    it("should validate patterns is array", () => {
      expect(
        () =>
          new RooIgnore({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".rooignore",
            patterns: "not-array" as any,
            fileContent: "",
          }),
      ).toThrow("Patterns must be an array");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct format", () => {
      const patterns = ["*.log", "node_modules/", "!important.log"];

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["roo"],
        description: "Generated from Roo ignore file: .rooignore",
      });
      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("roo.md");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".rulesync/ignore");
    });

    it("should handle empty patterns", () => {
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns: [],
        fileContent: "",
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe("");
      expect(rulesyncIgnore.getFrontmatter().targets).toEqual(["roo"]);
    });

    it("should include correct path information", () => {
      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: "config",
        relativeFilePath: ".rooignore",
        patterns: ["*.tmp"],
        fileContent: "*.tmp",
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".rulesync/ignore");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("roo.md");
      expect(rulesyncIgnore.getFrontmatter().description).toContain(".rooignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create RooIgnore from RulesyncIgnore", () => {
      const body = "*.log\nnode_modules/\n!important.log";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "roo.md",
        frontmatter: {
          targets: ["roo"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["roo"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(rooIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
    });

    it("should filter out comments and empty lines", () => {
      const body =
        "*.log\n# This is a comment\n\nnode_modules/\n  \n!important.log\n\n# Another comment";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "roo.md",
        frontmatter: {
          targets: ["roo"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["roo"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(rooIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
    });

    it("should handle empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "roo.md",
        frontmatter: {
          targets: ["roo"],
          description: "Empty ignore rules",
        },
        body: "",
        fileContent: `---\ntargets: ["roo"]\ndescription: "Empty ignore rules"\n---\n`,
      });

      const rooIgnore = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(rooIgnore.getPatterns()).toEqual([]);
    });
  });

  describe("fromFilePath", () => {
    it("should load RooIgnore from .rooignore file", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = "*.log\nnode_modules/\n# Comment\n\n!important.log";

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
      expect(rooIgnore.getFileContent()).toBe(content);
    });

    it("should handle empty .rooignore file", async () => {
      const filePath = join(testDir, ".rooignore");

      await writeFile(filePath, "", "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual([]);
    });

    it("should filter comments and empty lines", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = [
        "# Roo ignore file",
        "*.log",
        "",
        "# Dependencies",
        "node_modules/",
        "   # Indented comment",
        "dist/",
        "",
        "# Negation",
        "!important.log",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual([
        "*.log",
        "node_modules/",
        "dist/",
        "!important.log",
      ]);
    });

    it("should handle Unicode characters", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = "測試檔案.log\n日本語*.txt\n!重要.log";

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual(["測試檔案.log", "日本語*.txt", "!重要.log"]);
    });

    it("should handle special gitignore patterns", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = [
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual([
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
      ]);
    });

    it("should handle Roo-specific patterns from specification", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = [
        "# Large files over 40KB as recommended",
        "*.png",
        "*.pdf",
        "",
        "# Confidential information",
        "config/secret.json",
        "my/sensitive/dir/",
        "",
        "# Exception patterns",
        "foo/*",
        "!foo/README.md",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual([
        "*.png",
        "*.pdf",
        "config/secret.json",
        "my/sensitive/dir/",
        "foo/*",
        "!foo/README.md",
      ]);
    });
  });

  describe("getDefaultPatterns", () => {
    it("should return comprehensive default patterns", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain("**/test-fixtures/**");
      expect(patterns).toContain("**/*.snap");
      expect(patterns).toContain(".vscode/");
      expect(patterns).toContain(".git/");
      expect(patterns).toContain("!.env.example");
    });

    it("should include security-sensitive patterns", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain("secret.json");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("*.crt");
      expect(patterns).toContain("apikeys.txt");
      expect(patterns).toContain("**/apikeys/");
      expect(patterns).toContain("**/*_token*");
      expect(patterns).toContain("**/*_secret*");
      expect(patterns).toContain("**/*api_key*");
    });

    it("should include large file patterns as recommended", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain("*.png");
      expect(patterns).toContain("*.jpg");
      expect(patterns).toContain("*.pdf");
      expect(patterns).toContain("*.zip");
      expect(patterns).toContain("*.mp4");
      expect(patterns).toContain("*.avi");
    });

    it("should include performance optimization patterns", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain("**/test-fixtures/**");
      expect(patterns).toContain("**/*.snap");
      expect(patterns).toContain("coverage/");
      expect(patterns).toContain(".cache/");
    });

    it("should include cloud provider credentials", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain(".aws/");
      expect(patterns).toContain("aws-exports.js");
      expect(patterns).toContain("gcp-service-account*.json");
      expect(patterns).toContain("azure-credentials.json");
    });

    it("should include database file patterns", () => {
      const patterns = RooIgnore.getDefaultPatterns();

      expect(patterns).toContain("*.db");
      expect(patterns).toContain("*.sqlite");
      expect(patterns).toContain("*.sqlite3");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("should create RooIgnore with default patterns", () => {
      const rooIgnore = RooIgnore.createWithDefaultPatterns({
        baseDir: testDir,
      });

      const patterns = rooIgnore.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.log");
    });

    it("should use default parameters when none provided", () => {
      const rooIgnore = RooIgnore.createWithDefaultPatterns();

      expect(rooIgnore.getRelativeDirPath()).toBe(".");
      expect(rooIgnore.getRelativeFilePath()).toBe(".rooignore");
    });

    it("should allow custom parameters", () => {
      const rooIgnore = RooIgnore.createWithDefaultPatterns({
        baseDir: testDir,
        relativeDirPath: "config",
        relativeFilePath: "custom.rooignore",
      });

      expect(rooIgnore.getRelativeDirPath()).toBe("config");
      expect(rooIgnore.getRelativeFilePath()).toBe("custom.rooignore");
    });
  });

  describe("getSupportedIgnoreFileNames", () => {
    it("should return supported file names", () => {
      const supportedNames = RooIgnore.getSupportedIgnoreFileNames();

      expect(supportedNames).toEqual([".rooignore"]);
    });
  });

  describe("Integration with RulesyncIgnore", () => {
    it("should maintain consistency in round-trip conversion", () => {
      const originalPatterns = ["*.log", "node_modules/", "!important.log"];

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();
      const convertedBack = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(convertedBack.getPatterns()).toEqual(originalPatterns);
    });

    it("should handle complex patterns in round-trip", () => {
      const originalPatterns = [
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts,json}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
        "!keep-this.txt",
      ];

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();
      const convertedBack = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(convertedBack.getPatterns()).toEqual(originalPatterns);
    });

    it("should handle Roo-specific features in conversion", () => {
      const originalPatterns = [
        "# Large files per Roo recommendation",
        "*.png",
        "*.pdf",
        "config/secret.json",
        "my/sensitive/dir/",
        "!config/README.md",
      ];

      // Filter out comments for comparison
      const filteredPatterns = originalPatterns.filter((pattern) => !pattern.startsWith("#"));

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns: filteredPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();
      const convertedBack = RooIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(convertedBack.getPatterns()).toEqual(filteredPatterns);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long pattern lists", () => {
      const patterns = Array.from({ length: 1000 }, (_, i) => `file${i}.tmp`);

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(rooIgnore.getPatterns()).toHaveLength(1000);
      expect(rooIgnore.getPatterns()[0]).toBe("file0.tmp");
      expect(rooIgnore.getPatterns()[999]).toBe("file999.tmp");
    });

    it("should handle patterns with special characters", () => {
      const patterns = [
        "file with spaces.txt",
        "file-with-dashes.txt",
        "file_with_underscores.txt",
        "file.with.dots.txt",
        "file(with)parens.txt",
        "file[with]brackets.txt",
        "file{with}braces.txt",
      ];

      const rooIgnore = new RooIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".rooignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(rooIgnore.getPatterns()).toEqual(patterns);
    });

    it("should handle patterns with only whitespace lines", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = "   \n\t\n\n   \t   \n*.log\n   \n";

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual(["*.log"]);
    });

    it("should handle Roo-specific scenarios from specification", async () => {
      const filePath = join(testDir, ".rooignore");
      const content = [
        "# Roo-specific test based on specification examples",
        "apikeys.txt",
        "secret*",
        "*.cfg",
        "",
        "# Recursively exclude directory",
        "/scripts/**",
        "",
        "# Large files over 40KB",
        "*.png",
        "*.pdf",
        "",
        "# Exception handling",
        "foo/*",
        "!foo/README.md",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual([
        "apikeys.txt",
        "secret*",
        "*.cfg",
        "/scripts/**",
        "*.png",
        "*.pdf",
        "foo/*",
        "!foo/README.md",
      ]);
    });
  });

  describe("Specification Compliance", () => {
    it("should follow Roo Code v3.8+ features", () => {
      const rooIgnore = RooIgnore.createWithDefaultPatterns();

      // Verify basic properties are correctly set
      expect(RooIgnore.getSupportedIgnoreFileNames()).toEqual([".rooignore"]);

      // Verify default patterns include Roo-specific recommendations
      const patterns = rooIgnore.getPatterns();
      expect(patterns).toContain("*.png"); // Large files
      expect(patterns).toContain("apikeys.txt"); // Security
      expect(patterns).toContain("**/*_secret*"); // Token patterns
    });

    it("should target roo in RulesyncIgnore conversion", () => {
      const rooIgnore = RooIgnore.createWithDefaultPatterns();
      const rulesyncIgnore = rooIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter().targets).toEqual(["roo"]);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("roo.md");
    });

    it("should handle immediate reflection requirement", async () => {
      // Test that file loading works correctly (immediate reflection behavior
      // would be handled by the VS Code extension, not this class)
      const filePath = join(testDir, ".rooignore");
      await writeFile(filePath, "*.tmp", "utf-8");

      const rooIgnore = await RooIgnore.fromFilePath({ filePath });

      expect(rooIgnore.getPatterns()).toEqual(["*.tmp"]);
    });
  });
});
