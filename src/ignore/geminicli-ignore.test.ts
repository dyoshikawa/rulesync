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

  describe("Constructor", () => {
    it("should create GeminiCliIgnore with valid patterns", () => {
      const patterns = ["*.log", "node_modules/", "dist/", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getPatterns()).toEqual(patterns);
      expect(geminiIgnore.getUseGitignore()).toBe(false);
      expect(geminiIgnore.getSupportsNegation()).toBe(true);
    });

    it("should create GeminiCliIgnore with gitignore support", () => {
      const patterns = ["*.log", "build/"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gitignore",
        patterns,
        useGitignore: true,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getPatterns()).toEqual(patterns);
      expect(geminiIgnore.getUseGitignore()).toBe(true);
    });

    it("should create GeminiCliIgnore without negation support", () => {
      const patterns = ["*.log", "node_modules/"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getSupportsNegation()).toBe(false);
    });

    it("should create GeminiCliIgnore with empty patterns", () => {
      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: [],
        fileContent: "",
      });

      expect(geminiIgnore.getPatterns()).toEqual([]);
    });

    it("should validate patterns array", () => {
      expect(() => {
         
        new GeminiCliIgnore({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".aiexclude",
          patterns: null as any,
          fileContent: "",
        });
      }).toThrow("Patterns must be defined");
    });

    it("should validate patterns is array", () => {
      expect(() => {
         
        new GeminiCliIgnore({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".aiexclude",
          patterns: "not-array" as any,
          fileContent: "",
        });
      }).toThrow("Patterns must be an array");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct format", () => {
      const patterns = ["*.log", "node_modules/", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["geminicli"],
        description: "Generated from Gemini CLI ignore file: .aiexclude",
      });
      expect(rulesyncIgnore.getBody()).toContain("*.log");
      expect(rulesyncIgnore.getBody()).toContain("node_modules/");
      expect(rulesyncIgnore.getBody()).toContain("!important.log");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("geminicli.md");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".rulesync/ignore");
    });

    it("should include gitignore information when enabled", () => {
      const patterns = ["*.log", "build/"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".gitignore",
        patterns,
        useGitignore: true,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toContain("Using .gitignore patterns");
    });

    it("should warn about unsupported negation patterns", () => {
      const patterns = ["*.log", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toContain("Warning: Negation patterns detected");
    });

    it("should handle empty patterns", () => {
      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: [],
        fileContent: "",
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toContain("Generated from Gemini CLI ignore");
      expect(rulesyncIgnore.getFrontmatter().targets).toEqual(["geminicli"]);
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create GeminiCliIgnore from RulesyncIgnore", () => {
      const body = "*.log\nnode_modules/\n!important.log";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "geminicli.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["geminicli"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const geminiIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(geminiIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(geminiIgnore.getRelativeFilePath()).toBe(".aiexclude");
      expect(geminiIgnore.getSupportsNegation()).toBe(true); // Detected from ! pattern
    });

    it("should detect gitignore mentions", () => {
      const body = "# Using .gitignore patterns\n*.log\nnode_modules/";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "geminicli.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["geminicli"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const geminiIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(geminiIgnore.getUseGitignore()).toBe(true);
    });

    it("should filter out comments and empty lines", () => {
      const body =
        "*.log\n# This is a comment\n\nnode_modules/\n  \n!important.log\n\n# Another comment";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "geminicli.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["geminicli"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const geminiIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(geminiIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
    });

    it("should handle empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "geminicli.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Empty ignore rules",
        },
        body: "",
        fileContent: `---\ntargets: ["geminicli"]\ndescription: "Empty ignore rules"\n---\n`,
      });

      const geminiIgnore = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(geminiIgnore.getPatterns()).toEqual([]);
    });
  });

  describe("fromFilePath", () => {
    it("should load GeminiCliIgnore from .aiexclude file", async () => {
      const filePath = join(testDir, ".aiexclude");
      const content = "*.log\nnode_modules/\n# Comment\n\n!important.log";

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(geminiIgnore.getRelativeFilePath()).toBe(".aiexclude");
      expect(geminiIgnore.getUseGitignore()).toBe(false);
      expect(geminiIgnore.getSupportsNegation()).toBe(true);
      expect(geminiIgnore.getFileContent()).toBe(content);
    });

    it("should load GeminiCliIgnore from .gitignore file", async () => {
      const filePath = join(testDir, ".gitignore");
      const content = "*.log\nbuild/\ndist/";

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual(["*.log", "build/", "dist/"]);
      expect(geminiIgnore.getRelativeFilePath()).toBe(".gitignore");
      expect(geminiIgnore.getUseGitignore()).toBe(true);
      expect(geminiIgnore.getSupportsNegation()).toBe(false);
    });

    it("should handle .aiexclude in subdirectory", async () => {
      const { mkdir } = await import("node:fs/promises");
      const subDir = join(testDir, "subdir");
      await mkdir(subDir, { recursive: true });
      const filePath = join(subDir, ".aiexclude");
      const content = "*.tmp\nlocal/";

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual(["*.tmp", "local/"]);
      expect(geminiIgnore.getRelativeDirPath()).toContain("subdir");
    });

    it("should handle empty .aiexclude file", async () => {
      const filePath = join(testDir, ".aiexclude");

      await writeFile(filePath, "", "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual([]);
    });

    it("should filter comments and empty lines", async () => {
      const filePath = join(testDir, ".aiexclude");
      const content = [
        "# Gemini CLI ignore file",
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

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual([
        "*.log",
        "node_modules/",
        "dist/",
        "!important.log",
      ]);
    });

    it("should handle Unicode characters", async () => {
      const filePath = join(testDir, ".aiexclude");
      const content = "測試檔案.log\n日本語*.txt\n!重要.log";

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual(["測試檔案.log", "日本語*.txt", "!重要.log"]);
    });

    it("should handle special gitignore patterns", async () => {
      const filePath = join(testDir, ".aiexclude");
      const content = [
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
        "my/sensitive/dir/",
      ].join("\n");

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual([
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
        "my/sensitive/dir/",
      ]);
    });
  });

  describe("generateAiexcludeContent", () => {
    it("should generate formatted .aiexclude content", () => {
      const patterns = ["*.key", ".env", "node_modules/", "dist/", "*.log", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const content = geminiIgnore.generateAiexcludeContent();

      expect(content).toContain("# Gemini CLI Ignore File");
      expect(content).toContain("# Secret keys and API keys");
      expect(content).toContain("*.key");
      expect(content).toContain(".env");
      expect(content).toContain("# Build artifacts and dependencies");
      expect(content).toContain("node_modules/");
      expect(content).toContain("# Negation patterns");
      expect(content).toContain("!important.log");
    });

    it("should warn about unsupported negation", () => {
      const patterns = ["*.log", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false,
        fileContent: patterns.join("\n"),
      });

      const content = geminiIgnore.generateAiexcludeContent();

      expect(content).toContain("Note: Negation patterns (!) may not be supported");
    });
  });

  describe("getDefaultPatterns", () => {
    it("should return comprehensive default patterns", () => {
      const patterns = GeminiCliIgnore.getDefaultPatterns();

      // Security patterns
      expect(patterns).toContain("apikeys.txt");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("/secret.env");
      expect(patterns).toContain(".env*");
      expect(patterns).toContain("secrets/");

      // Dependencies and build artifacts
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("vendor/");

      // Large files
      expect(patterns).toContain("*.csv");
      expect(patterns).toContain("*.db");
      expect(patterns).toContain("data/");

      // Media files
      expect(patterns).toContain("*.mp4");
      expect(patterns).toContain("*.png");

      // System files
      expect(patterns).toContain(".DS_Store");
      expect(patterns).toContain("Thumbs.db");

      // Version control
      expect(patterns).toContain(".git/");
      expect(patterns).toContain(".svn/");

      // Negation pattern
      expect(patterns).toContain("!.env.example");
    });

    it("should include performance optimization patterns", () => {
      const patterns = GeminiCliIgnore.getDefaultPatterns();

      expect(patterns).toContain("**/test-fixtures/**");
      expect(patterns).toContain("**/*.snap");
      expect(patterns).toContain("coverage/");
      expect(patterns).toContain(".cache/");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("should create GeminiCliIgnore with default patterns", () => {
      const geminiIgnore = GeminiCliIgnore.createWithDefaultPatterns({
        baseDir: testDir,
      });

      const patterns = geminiIgnore.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".env*");
      expect(patterns).toContain("*.log");
      expect(geminiIgnore.getUseGitignore()).toBe(false);
      expect(geminiIgnore.getSupportsNegation()).toBe(true);
    });

    it("should use default parameters when none provided", () => {
      const geminiIgnore = GeminiCliIgnore.createWithDefaultPatterns();

      expect(geminiIgnore.getRelativeDirPath()).toBe(".");
      expect(geminiIgnore.getRelativeFilePath()).toBe(".aiexclude");
    });

    it("should allow custom parameters", () => {
      const geminiIgnore = GeminiCliIgnore.createWithDefaultPatterns({
        baseDir: testDir,
        relativeDirPath: "config",
        relativeFilePath: "custom.aiexclude",
        useGitignore: true,
        supportsNegation: false,
      });

      expect(geminiIgnore.getRelativeDirPath()).toBe("config");
      expect(geminiIgnore.getRelativeFilePath()).toBe("custom.aiexclude");
      expect(geminiIgnore.getUseGitignore()).toBe(true);
      expect(geminiIgnore.getSupportsNegation()).toBe(false);
    });
  });

  describe("getSupportedIgnoreFileNames", () => {
    it("should return supported file names", () => {
      const supportedNames = GeminiCliIgnore.getSupportedIgnoreFileNames();

      expect(supportedNames).toEqual([".aiexclude", ".gitignore"]);
    });
  });

  describe("isNegationPattern", () => {
    it("should identify negation patterns", () => {
      expect(GeminiCliIgnore.isNegationPattern("!important.log")).toBe(true);
      expect(GeminiCliIgnore.isNegationPattern("!foo/README.md")).toBe(true);
      expect(GeminiCliIgnore.isNegationPattern("*.log")).toBe(false);
      expect(GeminiCliIgnore.isNegationPattern("node_modules/")).toBe(false);
    });
  });

  describe("filterPatterns", () => {
    it("should return all patterns when negation is supported", () => {
      const patterns = ["*.log", "!important.log", "node_modules/"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: true,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.filterPatterns()).toEqual(patterns);
    });

    it("should filter out negation patterns when not supported", () => {
      const patterns = ["*.log", "!important.log", "node_modules/", "!keep.md"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.filterPatterns()).toEqual(["*.log", "node_modules/"]);
    });
  });

  describe("Integration with RulesyncIgnore", () => {
    it("should maintain consistency in round-trip conversion", () => {
      const originalPatterns = ["*.log", "node_modules/", "!important.log"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();
      const convertedBack = GeminiCliIgnore.fromRulesyncIgnore({
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
        "my/sensitive/dir/",
        "!keep-this.txt",
      ];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = geminiIgnore.toRulesyncIgnore();
      const convertedBack = GeminiCliIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(convertedBack.getPatterns()).toEqual(originalPatterns);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long pattern lists", () => {
      const patterns = Array.from({ length: 1000 }, (_, i) => `file${i}.tmp`);

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getPatterns()).toHaveLength(1000);
      expect(geminiIgnore.getPatterns()[0]).toBe("file0.tmp");
      expect(geminiIgnore.getPatterns()[999]).toBe("file999.tmp");
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

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getPatterns()).toEqual(patterns);
    });

    it("should handle patterns with only whitespace lines", async () => {
      const filePath = join(testDir, ".aiexclude");
      const content = "   \n\t\n\n   \t   \n*.log\n   \n";

      await writeFile(filePath, content, "utf-8");

      const geminiIgnore = await GeminiCliIgnore.fromFilePath({ filePath });

      expect(geminiIgnore.getPatterns()).toEqual(["*.log"]);
    });

    it("should handle mixed hierarchical patterns", () => {
      const patterns = ["foo/*", "!foo/README.md", "my/sensitive/dir/", "/secret.env", "**/*.key"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(geminiIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("Special Cases", () => {
    it("should handle empty .aiexclude blocking everything", () => {
      // Special case: Empty .aiexclude may block everything in Firebase Studio/IDX
      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns: [],
        fileContent: "",
      });

      expect(geminiIgnore.getPatterns()).toEqual([]);
      // This is a special case that should be documented
      const content = geminiIgnore.generateAiexcludeContent();
      expect(content).toContain("Gemini CLI Ignore File");
    });

    it("should handle Firebase Studio/IDX limitations", () => {
      // Firebase Studio/IDX doesn't support negation patterns
      const patterns = ["foo/*", "!foo/README.md"];

      const geminiIgnore = new GeminiCliIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".aiexclude",
        patterns,
        supportsNegation: false, // Firebase environment
        fileContent: patterns.join("\n"),
      });

      const filtered = geminiIgnore.filterPatterns();
      expect(filtered).toEqual(["foo/*"]); // Negation pattern removed
    });
  });
});
