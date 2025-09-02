import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
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
    it("should create CursorIgnore instance", () => {
      const content = "node_modules/\n*.log\ndist/";
      const ignore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: content,
      });

      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.getRelativeFilePath()).toBe(".cursorignore");
      expect(ignore.getPatterns()).toEqual(["node_modules/", "*.log", "dist/"]);
    });

    it("should inherit from ToolIgnore", () => {
      const ignore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "test",
      });

      expect(ignore).toBeInstanceOf(CursorIgnore);
      // Test that it has ToolIgnore methods
      expect(typeof ignore.getPatterns).toBe("function");
      expect(typeof ignore.validate).toBe("function");
      expect(typeof ignore.toRulesyncIgnore).toBe("function");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with same content", () => {
      const content = "# Cursor ignore patterns\nnode_modules/\n*.log\n.env*";
      const ignore = new CursorIgnore({
        baseDir: "/project",
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: content,
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(content);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
    });

    it("should use default base directory", () => {
      const ignore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: "pattern",
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();
      expect(rulesyncIgnore.getFilePath()).toBe(join(".", ".", ".rulesyncignore"));
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create CursorIgnore from RulesyncIgnore", () => {
      const rulesyncContent = "# From rulesync\nnode_modules/\nbuild/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: rulesyncContent,
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: "/test",
        rulesyncIgnore,
      });

      expect(cursorIgnore).toBeInstanceOf(CursorIgnore);
      expect(cursorIgnore.getFileContent()).toBe(rulesyncContent);
      expect(cursorIgnore.getRelativeFilePath()).toBe(".cursorignore");
      expect(cursorIgnore.getRelativeDirPath()).toBe(".");
    });

    it("should use provided baseDir", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "test",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        baseDir: "/custom/base",
        rulesyncIgnore,
      });

      expect(cursorIgnore.getFilePath()).toBe(join("/custom/base", ".", ".cursorignore"));
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "test",
      });

      const cursorIgnore = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(cursorIgnore.getFilePath()).toBe(join(".", ".", ".cursorignore"));
    });
  });

  describe("fromFile", () => {
    it("should read from .cursorignore file", async () => {
      const content = "# Cursor ignore file\nnode_modules/\n*.tmp\ndist/";
      const cursorIgnoreFile = join(testDir, ".cursorignore");
      await writeFileContent(cursorIgnoreFile, content);

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const ignore = await CursorIgnore.fromFile();

        expect(ignore.getFileContent()).toBe(content);
        expect(ignore.getRelativeFilePath()).toBe(".cursorignore");
        expect(ignore.getPatterns()).toEqual(["node_modules/", "*.tmp", "dist/"]);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should throw error when .cursorignore doesn't exist", async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        await expect(CursorIgnore.fromFile()).rejects.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("ignore patterns functionality", () => {
    it("should parse standard ignore patterns", () => {
      const content = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs  
dist/
build/
*.log

# Environment
.env*
!.env.example`;

      const ignore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".pnpm-store/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain(".env*");
      expect(patterns).toContain("!.env.example");
      expect(patterns).not.toContain("# Dependencies");
      expect(patterns).not.toContain("# Build outputs");
    });

    it("should handle complex patterns", () => {
      const content = `**/*.tmp
src/**/*.test.js
!src/**/*.important.test.js
[Tt]emp/
**/cache/**`;

      const ignore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual([
        "**/*.tmp",
        "src/**/*.test.js",
        "!src/**/*.important.test.js",
        "[Tt]emp/",
        "**/cache/**",
      ]);
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain content in round-trip conversion", () => {
      const originalContent = "node_modules/\n*.log\ndist/";

      // Create CursorIgnore
      const cursorIgnore = new CursorIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".cursorignore",
        fileContent: originalContent,
      });

      // Convert to RulesyncIgnore
      const rulesyncIgnore = cursorIgnore.toRulesyncIgnore();

      // Convert back to CursorIgnore
      const backToCursor = CursorIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(backToCursor.getFileContent()).toBe(originalContent);
      expect(backToCursor.getPatterns()).toEqual(cursorIgnore.getPatterns());
    });
  });
});
