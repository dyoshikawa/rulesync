import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudeCodeIgnore } from "./claudecode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("ClaudeCodeIgnore", () => {
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
      const claudeCodeIgnore = new ClaudeCodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        patterns,
        fileContent: patterns.join("\n"),
      });

      expect(claudeCodeIgnore.getPatterns()).toEqual(patterns);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct frontmatter", () => {
      const patterns = ["node_modules/", "*.log"];
      const claudeCodeIgnore = new ClaudeCodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: ".claudecode.ignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = claudeCodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        description: "Generated from Claude Code ignore file: .claudecode.ignore",
      });
      expect(rulesyncIgnore.getBody()).toBe("node_modules/\n*.log");
    });

    it("should handle empty patterns", () => {
      const claudeCodeIgnore = new ClaudeCodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: ".claudecode.ignore",
        patterns: [],
        fileContent: "",
      });

      const rulesyncIgnore = claudeCodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getBody()).toBe("");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should convert from RulesyncIgnore with patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "Test ignore file",
        },
        body: "node_modules/\n*.log\n# comment\n\n.env*",
        fileContent: "",
      });

      const claudeCodeIgnore = ClaudeCodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        rulesyncIgnore,
      });

      expect(claudeCodeIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });

    it("should handle empty body", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "empty.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "Empty ignore file",
        },
        body: "",
        fileContent: "",
      });

      const claudeCodeIgnore = ClaudeCodeIgnore.fromRulesyncIgnore(rulesyncIgnore);

      expect(claudeCodeIgnore.getPatterns()).toEqual([]);
    });

    it("should filter out comments and empty lines", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "commented.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "File with comments",
        },
        body: "# This is a comment\nnode_modules/\n\n*.log\n# Another comment\n.env*\n\n",
        fileContent: "",
      });

      const claudeCodeIgnore = ClaudeCodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        rulesyncIgnore,
      });

      expect(claudeCodeIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });
  });

  describe("fromFilePath", () => {
    it("should load from file with patterns", async () => {
      const claudeDir = join(testDir, ".claude");
      await mkdir(claudeDir, { recursive: true });

      const filePath = join(claudeDir, ".claudecode.ignore");
      const fileContent = `node_modules/
*.log
.env*
# This is a comment
*.tmp`;

      await writeFile(filePath, fileContent, "utf-8");

      const claudeCodeIgnore = await ClaudeCodeIgnore.fromFilePath({ filePath });

      expect(claudeCodeIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*", "*.tmp"]);
    });

    it("should handle empty file", async () => {
      const claudeDir = join(testDir, ".claude");
      await mkdir(claudeDir, { recursive: true });

      const filePath = join(claudeDir, "empty.ignore");
      await writeFile(filePath, "", "utf-8");

      const claudeCodeIgnore = await ClaudeCodeIgnore.fromFilePath({ filePath });

      expect(claudeCodeIgnore.getPatterns()).toEqual([]);
    });

    it("should filter comments and blank lines", async () => {
      const claudeDir = join(testDir, ".claude");
      await mkdir(claudeDir, { recursive: true });

      const filePath = join(claudeDir, "complex.ignore");
      const fileContent = `# Header comment
node_modules/

# Another comment
*.log

.env*

# Final comment`;

      await writeFile(filePath, fileContent, "utf-8");

      const claudeCodeIgnore = await ClaudeCodeIgnore.fromFilePath({ filePath });

      expect(claudeCodeIgnore.getPatterns()).toEqual(["node_modules/", "*.log", ".env*"]);
    });
  });
});
