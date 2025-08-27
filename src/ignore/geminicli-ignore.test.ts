import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../test-utils/index.js";
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
    it("creates instance with default values", () => {
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        fileContent: "",
      });

      expect(ignore.getPatterns()).toEqual([]);
      expect(ignore.getUseGitignore()).toBe(false);
      expect(ignore.getSupportsNegation()).toBe(true);
    });

    it("creates instance with custom patterns", () => {
      const patterns = ["*.log", "node_modules/", "dist/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      expect(ignore.getPatterns()).toEqual(patterns);
    });

    it("creates instance with gitignore settings", () => {
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gitignore",
        useGitignore: true,
        supportsNegation: false,
        fileContent: "",
      });

      expect(ignore.getUseGitignore()).toBe(true);
      expect(ignore.getSupportsNegation()).toBe(false);
    });
  });

  describe("fromFilePath", () => {
    it("creates instance from .aiexclude file", async () => {
      const aiexcludePath = join(testDir, ".aiexclude");
      const content = `# Secret keys and API keys
*.key
*.pem
.env
.env.*

# Build artifacts
node_modules/
dist/
build/
*.log

# Negation patterns
foo/*
!foo/README.md`;

      await writeFile(aiexcludePath, content, "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: aiexcludePath });

      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
      expect(ignore.getUseGitignore()).toBe(false);
      expect(ignore.getSupportsNegation()).toBe(true);
      expect(ignore.getPatterns()).toEqual([
        "*.key",
        "*.pem",
        ".env",
        ".env.*",
        "node_modules/",
        "dist/",
        "build/",
        "*.log",
        "foo/*",
        "!foo/README.md",
      ]);
    });

    it("creates instance from .gitignore file", async () => {
      const gitignorePath = join(testDir, ".gitignore");
      const content = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
*.log

# Environment files
.env
.env.*
!.env.example`;

      await writeFile(gitignorePath, content, "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: gitignorePath });

      expect(ignore.getRelativeFilePath()).toBe(".gitignore");
      expect(ignore.getUseGitignore()).toBe(true);
      expect(ignore.getSupportsNegation()).toBe(true);
      expect(ignore.getPatterns()).toEqual([
        "node_modules/",
        ".pnpm-store/",
        "dist/",
        "build/",
        "*.log",
        ".env",
        ".env.*",
        "!.env.example",
      ]);
    });

    it("handles empty file", async () => {
      const aiexcludePath = join(testDir, ".aiexclude");
      await writeFile(aiexcludePath, "", "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: aiexcludePath });

      expect(ignore.getPatterns()).toEqual([]);
      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
    });

    it("handles file with only comments and empty lines", async () => {
      const aiexcludePath = join(testDir, ".aiexclude");
      const content = `# This is a comment

# Another comment

   # Comment with leading whitespace
`;

      await writeFile(aiexcludePath, content, "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: aiexcludePath });

      expect(ignore.getPatterns()).toEqual([]);
    });

    it("handles complex patterns", async () => {
      const aiexcludePath = join(testDir, ".aiexclude");
      const content = `/absolute/path
relative/path
**.log
test/**/*.tmp
[abc]test.txt
file?.txt
!important.log`;

      await writeFile(aiexcludePath, content, "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: aiexcludePath });

      expect(ignore.getPatterns()).toEqual([
        "/absolute/path",
        "relative/path",
        "**.log",
        "test/**/*.tmp",
        "[abc]test.txt",
        "file?.txt",
        "!important.log",
      ]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("converts to RulesyncIgnore with proper frontmatter", () => {
      const patterns = ["*.log", "node_modules/", "!important.log"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["geminicli"],
        description: "Generated from Gemini CLI ignore file: .aiexclude",
      });

      const body = rulesyncIgnore.getBody();
      expect(body).toContain("# Gemini CLI Coding Assistant Ignore File");
      expect(body).toContain("*.log");
      expect(body).toContain("node_modules/");
      expect(body).toContain("!important.log");
    });

    it("generates organized content with categorized patterns", () => {
      const patterns = ["*.key", ".env", "node_modules/", "dist/", "*.csv", "*.png", "custom/path"];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toContain("# Security and Secrets");
      expect(body).toContain("*.key");
      expect(body).toContain(".env");

      expect(body).toContain("# Build Artifacts and Dependencies");
      expect(body).toContain("node_modules/");
      expect(body).toContain("dist/");

      expect(body).toContain("# Data Files and Large Assets");
      expect(body).toContain("*.csv");
      expect(body).toContain("*.png");

      expect(body).toContain("# Other Exclusions");
      expect(body).toContain("custom/path");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("converts from RulesyncIgnore", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test ignore file",
        },
        body: `# Test ignore file
*.log
node_modules/
!important.log`,
        fileContent: "",
      });

      const ignore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
    });

    it("handles empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "empty.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Empty ignore file",
        },
        body: "",
        fileContent: "",
      });

      const ignore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual([]);
    });

    it("filters out comments and empty lines", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test ignore file",
        },
        body: `# This is a comment
*.log

# Another comment
node_modules/

   # Comment with whitespace
dist/`,
        fileContent: "",
      });

      const ignore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      expect(ignore.getPatterns()).toEqual(["*.log", "node_modules/", "dist/"]);
    });
  });

  describe("generateAiexcludeContent", () => {
    it("generates content with header", () => {
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: [],
        fileContent: "",
      });

      const content = ignore.generateAiexcludeContent();

      expect(content).toContain("# Gemini CLI Coding Assistant Ignore File");
      expect(content).toContain("# Exclude files and directories from AI context");
      expect(content).toContain("# Syntax: same as .gitignore");
      expect(content).toContain("# No patterns specified");
    });

    it("organizes patterns by category", () => {
      const patterns = [
        "*.key", // security
        "node_modules/", // build
        "*.csv", // data
        "custom/path", // other
        ".env", // security
        "dist/", // build
        "*.png", // data
      ];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const content = ignore.generateAiexcludeContent();

      // Check that sections appear in order
      const securityIndex = content.indexOf("# Security and Secrets");
      const buildIndex = content.indexOf("# Build Artifacts and Dependencies");
      const dataIndex = content.indexOf("# Data Files and Large Assets");
      const otherIndex = content.indexOf("# Other Exclusions");

      expect(securityIndex).toBeGreaterThan(0);
      expect(buildIndex).toBeGreaterThan(securityIndex);
      expect(dataIndex).toBeGreaterThan(buildIndex);
      expect(otherIndex).toBeGreaterThan(dataIndex);

      // Check that patterns appear in their sections
      expect(content.substring(securityIndex, buildIndex)).toContain("*.key");
      expect(content.substring(securityIndex, buildIndex)).toContain(".env");
      expect(content.substring(buildIndex, dataIndex)).toContain("node_modules/");
      expect(content.substring(buildIndex, dataIndex)).toContain("dist/");
      expect(content.substring(dataIndex, otherIndex)).toContain("*.csv");
      expect(content.substring(dataIndex, otherIndex)).toContain("*.png");
      expect(content.substring(otherIndex)).toContain("custom/path");
    });
  });

  describe("filterPatterns", () => {
    it("keeps all patterns when negation is supported", () => {
      const patterns = ["*.log", "!important.log", "node_modules/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: true,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("*.log");
      expect(content).toContain("!important.log");
      expect(content).toContain("node_modules/");
    });

    it("filters out negation patterns when not supported", () => {
      const patterns = ["*.log", "!important.log", "node_modules/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false, // Firebase Studio/IDX mode
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test
      });

      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("*.log");
      expect(content).not.toContain("!important.log");
      expect(content).toContain("node_modules/");
    });
  });

  describe("validation", () => {
    it("validates successfully with supported patterns", () => {
      const patterns = ["*.log", "node_modules/", "dist/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: true,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("validates successfully with negation patterns when supported", () => {
      const patterns = ["*.log", "!important.log"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: true,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
    });

    it("fails validation with negation patterns when not supported", () => {
      const patterns = ["*.log", "!important.log"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false,
        validate: false, // Skip validation in constructor
        fileContent: patterns.join("\n"),
      });

      const result = ignore.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Negation patterns are not supported in Firebase Studio/IDX environment",
      );
    });
  });

  describe("isNegationPattern", () => {
    it("identifies negation patterns", () => {
      expect(GeminiCliIgnore.isNegationPattern("!file.txt")).toBe(true);
      expect(GeminiCliIgnore.isNegationPattern("!path/to/file")).toBe(true);
      expect(GeminiCliIgnore.isNegationPattern("!**/*.md")).toBe(true);
    });

    it("identifies non-negation patterns", () => {
      expect(GeminiCliIgnore.isNegationPattern("file.txt")).toBe(false);
      expect(GeminiCliIgnore.isNegationPattern("*.log")).toBe(false);
      expect(GeminiCliIgnore.isNegationPattern("node_modules/")).toBe(false);
      expect(GeminiCliIgnore.isNegationPattern("# comment")).toBe(false);
    });
  });

  describe("getDefaultPatterns", () => {
    it("returns comprehensive default patterns", () => {
      const patterns = GeminiCliIgnore.getDefaultPatterns();

      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("*.csv");
      expect(patterns).toContain("*.png");
      expect(patterns).toContain(".DS_Store");
    });

    it("includes comments for organization", () => {
      const patterns = GeminiCliIgnore.getDefaultPatterns();

      expect(patterns).toContain("# Secret keys and API keys");
      expect(patterns).toContain("# Build artifacts and dependencies");
      expect(patterns).toContain("# Data files and large assets");
      expect(patterns).toContain("# IDE and OS files");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("creates instance with default patterns", () => {
      const ignore = GeminiCliIgnore.createWithDefaultPatterns();

      expect(ignore.getPatterns().length).toBeGreaterThan(0);
      expect(ignore.getPatterns()).toContain("*.key");
      expect(ignore.getPatterns()).toContain("node_modules/");
      expect(ignore.getRelativeFilePath()).toBe(".aiexclude");
    });

    it("accepts custom parameters", () => {
      const ignore = GeminiCliIgnore.createWithDefaultPatterns({
        baseDir: "/custom/base",
        relativeFilePath: "custom.aiexclude",
        supportsNegation: false,
      });

      expect((ignore as any).baseDir).toBe("/custom/base");
      expect(ignore.getRelativeFilePath()).toBe("custom.aiexclude");
      expect(ignore.getSupportsNegation()).toBe(false);
    });
  });

  describe("getSupportedFileNames", () => {
    it("returns supported file names", () => {
      const fileNames = GeminiCliIgnore.getSupportedFileNames();

      expect(fileNames).toEqual([".aiexclude", ".gitignore"]);
    });
  });

  describe("round-trip conversion", () => {
    it("maintains patterns through conversion cycle", () => {
      const originalPatterns = [
        "*.key",
        ".env.*",
        "node_modules/",
        "dist/",
        "*.csv",
        "custom/path",
      ];

      const original = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      // Convert to RulesyncIgnore and back
      const rulesyncIgnore = original.toRulesyncIgnore();
      const converted = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      // Should maintain all patterns
      expect(converted.getPatterns()).toEqual(originalPatterns);
    });

    it("handles negation patterns in round-trip", () => {
      const originalPatterns = [
        "*.log",
        "!important.log",
        "node_modules/",
        "!node_modules/package.json",
      ];

      const original = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: originalPatterns,
        supportsNegation: true,
        fileContent: originalPatterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const rulesyncIgnore = original.toRulesyncIgnore();
      const converted = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        rulesyncIgnore,
      });

      // Should contain all patterns, but order may be different due to categorization
      originalPatterns.forEach((pattern) => {
        expect(converted.getPatterns()).toContain(pattern);
      });
      expect(converted.getPatterns()).toHaveLength(originalPatterns.length);
    });
  });

  describe("pattern categorization", () => {
    it("correctly categorizes security patterns", () => {
      const securityPatterns = [
        "*.key",
        "*.pem",
        ".env",
        "secret.json",
        "**/apikeys/",
        "auth-token.txt",
        ".aws/credentials",
      ];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: securityPatterns,
        fileContent: securityPatterns.join("\n"),
      });

      const content = ignore.generateAiexcludeContent();
      const securitySection = content.substring(
        content.indexOf("# Security and Secrets"),
        content.indexOf("# Build Artifacts and Dependencies") !== -1
          ? content.indexOf("# Build Artifacts and Dependencies")
          : content.length,
      );

      securityPatterns.forEach((pattern) => {
        expect(securitySection).toContain(pattern);
      });
    });

    it("correctly categorizes build patterns", () => {
      const buildPatterns = [
        "node_modules/",
        "dist/",
        "build/",
        "out/",
        "target/",
        "*.log",
        "logs/",
        ".cache/",
      ];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: buildPatterns,
        fileContent: buildPatterns.join("\n"),
      });

      const content = ignore.generateAiexcludeContent();
      const buildSection = content.substring(
        content.indexOf("# Build Artifacts and Dependencies"),
        content.indexOf("# Data Files and Large Assets") !== -1
          ? content.indexOf("# Data Files and Large Assets")
          : content.length,
      );

      buildPatterns.forEach((pattern) => {
        expect(buildSection).toContain(pattern);
      });
    });

    it("correctly categorizes data patterns", () => {
      const dataPatterns = [
        "*.csv",
        "*.xlsx",
        "*.db",
        "*.sqlite",
        "*.mp4",
        "*.png",
        "*.zip",
        "data/",
        "datasets/",
      ];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: dataPatterns,
        fileContent: dataPatterns.join("\n"),
      });

      const content = ignore.generateAiexcludeContent();
      const dataSection = content.substring(
        content.indexOf("# Data Files and Large Assets"),
        content.indexOf("# Other Exclusions") !== -1
          ? content.indexOf("# Other Exclusions")
          : content.length,
      );

      dataPatterns.forEach((pattern) => {
        expect(dataSection).toContain(pattern);
      });
    });
  });

  describe("edge cases", () => {
    it("handles Unicode patterns", () => {
      const patterns = ["測試/*.log", "日本語/ディレクトリ/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("測試/*.log");
      expect(content).toContain("日本語/ディレクトリ/");
    });

    it("handles patterns with special characters", () => {
      const patterns = ["file[abc].txt", "path with spaces/", "file?.log", "**/nested/**/path"];

      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const content = ignore.generateAiexcludeContent();
      patterns.forEach((pattern) => {
        expect(content).toContain(pattern);
      });
    });

    it("handles large pattern lists", () => {
      const patterns = Array.from({ length: 100 }, (_, i) => `pattern${i}.txt`);
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
        validate: false, // Skip validation for test with negation patterns
      });

      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("pattern0.txt");
      expect(content).toContain("pattern99.txt");
    });
  });

  describe("Firebase Studio/IDX compatibility", () => {
    it("handles empty file as block-everything for Firebase Studio/IDX", () => {
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: [], // Empty patterns
        supportsNegation: false, // Firebase Studio/IDX mode
        fileContent: "",
      });

      // Empty .aiexclude in Firebase Studio/IDX blocks everything
      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("# No patterns specified");

      // Validation should still pass
      const result = ignore.validate();
      expect(result.success).toBe(true);
    });

    it("removes negation patterns for Firebase Studio/IDX", () => {
      const patterns = ["*.log", "!important.log", "node_modules/"];
      const ignore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false, // Firebase Studio/IDX mode
        validate: false, // Skip constructor validation
        fileContent: patterns.join("\n"),
      });

      const content = ignore.generateAiexcludeContent();
      expect(content).toContain("*.log");
      expect(content).not.toContain("!important.log"); // Filtered out
      expect(content).toContain("node_modules/");
    });
  });

  describe("gitignore integration", () => {
    it("handles gitignore file properly", async () => {
      const gitignorePath = join(testDir, ".gitignore");
      const content = `# Dependencies
node_modules/

# Environment
.env
.env.*
!.env.example`;

      await writeFile(gitignorePath, content, "utf-8");

      const ignore = await GeminiCliIgnore.fromFilePath({ filePath: gitignorePath });

      expect(ignore.getUseGitignore()).toBe(true);
      expect(ignore.getSupportsNegation()).toBe(true);
      expect(ignore.getPatterns()).toContain("node_modules/");
      expect(ignore.getPatterns()).toContain(".env");
      expect(ignore.getPatterns()).toContain("!.env.example");
    });

    it("treats gitignore patterns same as aiexclude", () => {
      const patterns = ["node_modules/", "dist/", "*.log"];

      const aiexcludeIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        useGitignore: false,
        fileContent: patterns.join("\n"),
      });

      const gitignoreIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gitignore",
        patterns,
        useGitignore: true,
        fileContent: patterns.join("\n"),
      });

      // Both should generate similar content (different only in source description)
      const aiexcludeContent = aiexcludeIgnore.generateAiexcludeContent();
      const gitignoreContent = gitignoreIgnore.generateAiexcludeContent();

      patterns.forEach((pattern) => {
        expect(aiexcludeContent).toContain(pattern);
        expect(gitignoreContent).toContain(pattern);
      });
    });
  });
});
