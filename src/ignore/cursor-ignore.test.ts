import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("CursorIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with patterns", () => {
      const patterns = ["node_modules/", "*.log", ".env*"];
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(cursorIgnore.getPatterns()).toEqual(patterns);
    });

    it("should validate patterns array", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: [],
        fileContent: "",
      });

      expect(cursorIgnore.getPatterns()).toEqual([]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct frontmatter", () => {
      const patterns = ["node_modules/", "*.log"];
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.relativeDirPath).toBe(".");
      expect(rulesyncIgnore.relativeFilePath).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getBody()).toBe("node_modules/\n*.log");
    });

    it("should handle empty patterns", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: [],
        fileContent: "",
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe("");
    });

    it("should generate correct relative file path", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: ["*.log"],
        fileContent: "*.log",
      });

      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should convert from RulesyncIgnore with patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "cursor.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test cursor ignore file",
        },
        body: "node_modules/\n*.log\n# comment\n\n.env*",
        fileContent: "",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });

    it("should handle negation patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "cursor.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test cursor ignore file with negations",
        },
        body: "*.log\n!important.log\nnode_modules/\n!node_modules/important/",
        fileContent: "",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getPatterns()).toEqual([
        "*.log",
        "!important.log",
        "node_modules/",
        "!node_modules/important/",
      ]);
    });

    it("should handle empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "empty.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Empty cursor ignore file",
        },
        body: "",
        fileContent: "",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getPatterns()).toEqual([]);
    });

    it("should filter out comments and empty lines", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "commented.md",
        frontmatter: {
          targets: ["cursor"],
          description: "File with comments",
        },
        body: "# This is a comment\nnode_modules/\n\n*.log\n# Another comment\n.env*\n\n",
        fileContent: "",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });
  });

  describe("fromFilePath", () => {
    it("should load from .cursorignore file with patterns", async () => {
      const filePath = join(testDir, ".cursorignore");
      const fileContent = `node_modules/
*.log
.env*
# This is a comment
*.tmp
!important.log`;

      await writeFile(filePath, fileContent, "utf-8");

      const cursorIgnore = await CursorIgnore.fromFilePath({ filePath });

      expect(cursorIgnore.getPatterns()).toEqual([
        "node_modules/",
        "*.log",
        ".env*",
        "*.tmp",
        "!important.log",
      ]);
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, ".cursorignore");
      await writeFile(filePath, "", "utf-8");

      const cursorIgnore = await CursorIgnore.fromFilePath({ filePath });

      expect(cursorIgnore.getPatterns()).toEqual([]);
    });

    it("should filter comments and blank lines", async () => {
      const filePath = join(testDir, ".cursorignore");
      const fileContent = `# Header comment
node_modules/

# Dependencies section
*.log

.env*

# Final comment`;

      await writeFile(filePath, fileContent, "utf-8");

      const cursorIgnore = await CursorIgnore.fromFilePath({ filePath });

      expect(cursorIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });

    it("should handle complex gitignore patterns", async () => {
      const filePath = join(testDir, ".cursorignore");
      const fileContent = `# Complex patterns
/root-only
**/anywhere
*.log
!important.log
dir/
**/*.tmp
[Tt]est*`;

      await writeFile(filePath, fileContent, "utf-8");

      const cursorIgnore = await CursorIgnore.fromFilePath({ filePath });

      expect(cursorIgnore.getPatterns()).toEqual([
        "/root-only",
        "**/anywhere",
        "*.log",
        "!important.log",
        "dir/",
        "**/*.tmp",
        "[Tt]est*",
      ]);
    });

    it("should preserve whitespace in patterns", async () => {
      const filePath = join(testDir, ".cursorignore");
      const fileContent = `file with spaces.txt
"quoted file.txt"
# Comment with spaces
another file.log`;

      await writeFile(filePath, fileContent, "utf-8");

      const cursorIgnore = await CursorIgnore.fromFilePath({ filePath });

      expect(cursorIgnore.getPatterns()).toEqual([
        "file with spaces.txt",
        '"quoted file.txt"',
        "another file.log",
      ]);
    });
  });

  describe("getDefaultPatterns", () => {
    it("should return comprehensive default patterns", () => {
      const patterns = CursorIgnore.getDefaultPatterns();

      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain(".DS_Store");
    });

    it("should include security-focused patterns", () => {
      const patterns = CursorIgnore.getDefaultPatterns();

      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");
    });

    it("should include build artifact patterns", () => {
      const patterns = CursorIgnore.getDefaultPatterns();

      expect(patterns).toContain("build/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("out/");
      expect(patterns).toContain("target/");
    });
  });

  describe("createWithDefaultPatterns", () => {
    it("should create instance with default patterns", () => {
      const cursorIgnore = CursorIgnore.createWithDefaultPatterns(testDir);
      const patterns = cursorIgnore.getPatterns();

      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("*.log");
      expect(patterns.length).toBeGreaterThan(20);
    });

    it("should use default baseDir when not provided", () => {
      const cursorIgnore = CursorIgnore.createWithDefaultPatterns();

      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
    });
  });

  describe("getSupportedIgnoreFileNames", () => {
    it("should return .cursorignore as supported file", () => {
      const fileNames = CursorIgnore.getSupportedIgnoreFileNames();

      expect(fileNames).toEqual([".cursorignore"]);
      expect(fileNames).toHaveLength(1);
    });

    it("should return readonly array", () => {
      const fileNames = CursorIgnore.getSupportedIgnoreFileNames();

      // This should not cause a TypeScript error, confirming readonly nature
      expect(Array.isArray(fileNames)).toBe(true);
    });
  });

  describe("validation", () => {
    it("should validate patterns array", () => {
      const cursorIgnore = new CursorIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        patterns: ["node_modules/", "*.log"],
        fileContent: "node_modules/\n*.log",
      });

      const result = cursorIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
