import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

describe("WindsurfIgnore", () => {
  describe("constructor", () => {
    it("should create WindsurfIgnore instance", () => {
      const content = "node_modules/\n*.log\ndist/";
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(ignore.getPatterns()).toEqual(["node_modules/", "*.log", "dist/"]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore using default implementation", () => {
      const content = "# Windsurf ignore\n.vscode/\n*.tmp";
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore).toBeInstanceOf(RulesyncIgnore);
      expect(rulesyncIgnore.getFileContent()).toBe(content);
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create WindsurfIgnore from RulesyncIgnore", () => {
      const content = "build/\n*.log\nnode_modules/";
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: content,
      });

      const ignore = WindsurfIgnore.fromRulesyncIgnore({
        baseDir: "/test",
        rulesyncIgnore,
      });

      expect(ignore).toBeInstanceOf(WindsurfIgnore);
      expect(ignore.getFileContent()).toBe(content);
      expect(ignore.getRelativeFilePath()).toBe(".codeiumignore");
      expect(ignore.getRelativeDirPath()).toBe(".");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".rulesyncignore",
        fileContent: "test",
      });

      const ignore = WindsurfIgnore.fromRulesyncIgnore({
        rulesyncIgnore,
      });

      expect(ignore.getFilePath()).toBe(join(".", ".", ".codeiumignore"));
    });
  });

  describe("ignore patterns", () => {
    it("should handle Windsurf-specific patterns", () => {
      const content = `# Windsurf AI code editor ignore
# Dependencies
node_modules/
.pnpm-store/

# Hidden files (built-in default)
.*
!.gitignore
!.github/

# Build artifacts
dist/
build/
out/

# Cache
.cache/
.parcel-cache/

# Media files
*.mp4
*.png
*.jpg`;

      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toContain("node_modules/");
      expect(patterns).toContain(".pnpm-store/");
      expect(patterns).toContain(".*");
      expect(patterns).toContain("!.gitignore");
      expect(patterns).toContain("!.github/");
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("*.mp4");
      expect(patterns).not.toContain("# Windsurf AI code editor ignore");
      expect(patterns).not.toContain("# Dependencies");
    });

    it("should parse negation patterns", () => {
      const content = `*
!src/
!*.md
!package.json`;

      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toEqual(["*", "!src/", "!*.md", "!package.json"]);
    });

    it("should handle complex glob patterns", () => {
      const content = `**/*.log
src/**/*.test.js
!src/**/*.important.test.js
**/node_modules/**
logs/**/*.{log,txt}`;

      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      const patterns = ignore.getPatterns();
      expect(patterns).toContain("**/*.log");
      expect(patterns).toContain("src/**/*.test.js");
      expect(patterns).toContain("!src/**/*.important.test.js");
      expect(patterns).toContain("**/node_modules/**");
      expect(patterns).toContain("logs/**/*.{log,txt}");
    });
  });

  describe("inheritance", () => {
    it("should inherit validate method from ToolIgnore", () => {
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "test",
        validate: false,
      });

      const result = ignore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should inherit getPatterns method from ToolIgnore", () => {
      const content = "pattern1\npattern2\n# comment\npattern3";
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      expect(typeof ignore.getPatterns).toBe("function");
      expect(ignore.getPatterns()).toEqual(["pattern1", "pattern2", "pattern3"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty ignore file", () => {
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: "",
      });

      expect(ignore.getPatterns()).toEqual([]);
      expect(ignore.validate().success).toBe(true);
    });

    it("should handle only comments", () => {
      const content = "# Only comments\n# Another comment";
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual([]);
    });

    it("should preserve special characters in patterns", () => {
      const content = "**/*[temp]*\n中文目录/\n🚀*.log";
      const ignore = new WindsurfIgnore({
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        fileContent: content,
      });

      expect(ignore.getPatterns()).toEqual(["**/*[temp]*", "中文目录/", "🚀*.log"]);
    });
  });
});
