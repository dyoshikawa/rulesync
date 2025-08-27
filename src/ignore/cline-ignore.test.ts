import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClineIgnore } from "./cline-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("ClineIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("Constructor", () => {
    it("should create ClineIgnore with valid patterns", () => {
      const patterns = ["*.log", "node_modules/", "dist/"];

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(clineIgnore.getPatterns()).toEqual(patterns);
    });

    it("should create ClineIgnore with empty patterns", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns: [],
        fileContent: "",
      });

      expect(clineIgnore.getPatterns()).toEqual([]);
    });

    it("should validate patterns array", () => {
      expect(
        () =>
          new ClineIgnore({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".clineignore",
            patterns: null as any,
            fileContent: "",
          }),
      ).toThrow("Patterns must be defined");
    });

    it("should validate patterns is array", () => {
      expect(
        () =>
          new ClineIgnore({
            baseDir: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".clineignore",
            patterns: "not-array" as any,
            fileContent: "",
          }),
      ).toThrow("Patterns must be an array");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct format", () => {
      const patterns = ["*.log", "node_modules/", "!important.log"];

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["cline"],
        description: "Generated from Cline ignore file: .clineignore",
      });
      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("cline.md");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".rulesync/ignore");
    });

    it("should handle empty patterns", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns: [],
        fileContent: "",
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe("");
      expect(rulesyncIgnore.getFrontmatter().targets).toEqual(["cline"]);
    });

    it("should include correct path information", () => {
      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: "config",
        relativeFilePath: ".clineignore",
        patterns: ["*.tmp"],
        fileContent: "*.tmp",
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".rulesync/ignore");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe("cline.md");
      expect(rulesyncIgnore.getFrontmatter().description).toContain(".clineignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create ClineIgnore from RulesyncIgnore", () => {
      const body = "*.log\nnode_modules/\n!important.log";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "cline.md",
        frontmatter: {
          targets: ["cline"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["cline"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(clineIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
    });

    it("should filter out comments and empty lines", () => {
      const body =
        "*.log\n# This is a comment\n\nnode_modules/\n  \n!important.log\n\n# Another comment";

      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "cline.md",
        frontmatter: {
          targets: ["cline"],
          description: "Test ignore rules",
        },
        body,
        fileContent: `---\ntargets: ["cline"]\ndescription: "Test ignore rules"\n---\n${body}`,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(clineIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
    });

    it("should handle empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "cline.md",
        frontmatter: {
          targets: ["cline"],
          description: "Empty ignore rules",
        },
        body: "",
        fileContent: `---\ntargets: ["cline"]\ndescription: "Empty ignore rules"\n---\n`,
      });

      const clineIgnore = ClineIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(clineIgnore.getPatterns()).toEqual([]);
    });
  });

  describe("fromFilePath", () => {
    it("should load ClineIgnore from .clineignore file", async () => {
      const filePath = join(testDir, ".clineignore");
      const content = "*.log\nnode_modules/\n# Comment\n\n!important.log";

      await writeFile(filePath, content, "utf-8");

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual(["*.log", "node_modules/", "!important.log"]);
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
      expect(clineIgnore.getFileContent()).toBe(content);
    });

    it("should handle empty .clineignore file", async () => {
      const filePath = join(testDir, ".clineignore");

      await writeFile(filePath, "", "utf-8");

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual([]);
    });

    it("should filter comments and empty lines", async () => {
      const filePath = join(testDir, ".clineignore");
      const content = [
        "# Cline ignore file",
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

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual([
        "*.log",
        "node_modules/",
        "dist/",
        "!important.log",
      ]);
    });

    it("should handle Unicode characters", async () => {
      const filePath = join(testDir, ".clineignore");
      const content = "測試檔案.log\n日本語*.txt\n!重要.log";

      await writeFile(filePath, content, "utf-8");

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual(["測試檔案.log", "日本語*.txt", "!重要.log"]);
    });

    it("should handle special gitignore patterns", async () => {
      const filePath = join(testDir, ".clineignore");
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

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual([
        "**/test-fixtures/**",
        "**/*.snap",
        "*.{js,ts}",
        "[Tt]emp/",
        "file?.txt",
        "/root-only",
        "trailing/",
      ]);
    });
  });

  describe("getDefaultPatterns", () => {
    it("should return comprehensive default patterns", () => {
      const patterns = ClineIgnore.getDefaultPatterns();

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
      const patterns = ClineIgnore.getDefaultPatterns();

      expect(patterns).toContain("secret.json");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("*.crt");
    });

    it("should include performance optimization patterns", () => {
      const patterns = ClineIgnore.getDefaultPatterns();

      expect(patterns).toContain("**/test-fixtures/**");
      expect(patterns).toContain("**/*.snap");
      expect(patterns).toContain("coverage/");
      expect(patterns).toContain(".cache/");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("should create ClineIgnore with default patterns", () => {
      const clineIgnore = ClineIgnore.createWithDefaultPatterns({
        baseDir: testDir,
      });

      const patterns = clineIgnore.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.log");
    });

    it("should use default parameters when none provided", () => {
      const clineIgnore = ClineIgnore.createWithDefaultPatterns();

      expect(clineIgnore.getRelativeDirPath()).toBe(".");
      expect(clineIgnore.getRelativeFilePath()).toBe(".clineignore");
    });

    it("should allow custom parameters", () => {
      const clineIgnore = ClineIgnore.createWithDefaultPatterns({
        baseDir: testDir,
        relativeDirPath: "config",
        relativeFilePath: "custom.clineignore",
      });

      expect(clineIgnore.getRelativeDirPath()).toBe("config");
      expect(clineIgnore.getRelativeFilePath()).toBe("custom.clineignore");
    });
  });

  describe("getSupportedIgnoreFileNames", () => {
    it("should return supported file names", () => {
      const supportedNames = ClineIgnore.getSupportedIgnoreFileNames();

      expect(supportedNames).toEqual([".clineignore"]);
    });
  });

  describe("Integration with RulesyncIgnore", () => {
    it("should maintain consistency in round-trip conversion", () => {
      const originalPatterns = ["*.log", "node_modules/", "!important.log"];

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();
      const convertedBack = ClineIgnore.fromRulesyncIgnore({
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

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns: originalPatterns,
        fileContent: originalPatterns.join("\n"),
      });

      const rulesyncIgnore = clineIgnore.toRulesyncIgnore();
      const convertedBack = ClineIgnore.fromRulesyncIgnore({
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

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(clineIgnore.getPatterns()).toHaveLength(1000);
      expect(clineIgnore.getPatterns()[0]).toBe("file0.tmp");
      expect(clineIgnore.getPatterns()[999]).toBe("file999.tmp");
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

      const clineIgnore = new ClineIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".clineignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(clineIgnore.getPatterns()).toEqual(patterns);
    });

    it("should handle patterns with only whitespace lines", async () => {
      const filePath = join(testDir, ".clineignore");
      const content = "   \n\t\n\n   \t   \n*.log\n   \n";

      await writeFile(filePath, content, "utf-8");

      const clineIgnore = await ClineIgnore.fromFilePath({ filePath });

      expect(clineIgnore.getPatterns()).toEqual(["*.log"]);
    });
  });
});
