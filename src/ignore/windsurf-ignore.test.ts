import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WindsurfIgnore } from "./windsurf-ignore.js";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("WindsurfIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with default patterns", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
      });

      const patterns = windsurfIgnore.getPatterns();
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("dist/");
      // Note: node_modules/ is built-in excluded by Windsurf, not in user patterns
    });

    it("should create instance with custom patterns", () => {
      const customPatterns = ["*.tmp", "build/", ".env.local"];
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        patterns: customPatterns,
      });

      expect(windsurfIgnore.getPatterns()).toEqual(customPatterns);
    });

    it("should validate patterns array", () => {
      expect(() => {
        const _ignored = new WindsurfIgnore({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: ".codeiumignore",
          patterns: null as any,
        });
      }).toThrow("Patterns must be defined");
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct frontmatter", () => {
      const patterns = [".env", "*.log", "dist/"];
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = windsurfIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter()).toEqual({
        targets: ["windsurf"],
        description: "Generated from Windsurf ignore file: .codeiumignore",
      });
      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create instance from RulesyncIgnore", () => {
      const patterns = ["*.tmp", "build/", ".env*"];
      const rulesyncIgnore = new RulesyncIgnore({
        frontmatter: {
          targets: ["windsurf"],
          description: "Test windsurf ignore patterns",
          patterns,
        },
        body: patterns.join("\n"),
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "windsurf.md",
        fileContent: `---
targets:
  - windsurf
description: Test windsurf ignore patterns
patterns:
${patterns.map((pattern) => `  - "${pattern}"`).join("\n")}
---

${patterns.join("\n")}`,
      });

      const windsurfIgnore = WindsurfIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(windsurfIgnore.getPatterns()).toEqual(patterns);
      expect(windsurfIgnore.getRelativeFilePath()).toBe(".codeiumignore");
    });
  });

  describe("fromFilePath", () => {
    it("should create instance from .codeiumignore file", async () => {
      const patterns = [
        "# Build artifacts",
        "dist/",
        "build/",
        "",
        "# Environment files",
        ".env",
        ".env.*",
        "",
        "# Logs",
        "*.log",
        "logs/",
      ];
      const filePath = join(testDir, ".codeiumignore");
      await writeFile(filePath, patterns.join("\n"));

      const windsurfIgnore = await WindsurfIgnore.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        filePath,
      });

      const loadedPatterns = windsurfIgnore.getPatterns();
      // Comments and empty lines should be filtered out
      expect(loadedPatterns).toEqual([
        "dist/",
        "build/",
        ".env",
        ".env.*",
        "*.log",
        "logs/",
      ]);
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, ".codeiumignore");
      await writeFile(filePath, "");

      const windsurfIgnore = await WindsurfIgnore.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        filePath,
      });

      expect(windsurfIgnore.getPatterns()).toEqual([]);
    });

    it("should handle file with only comments and blank lines", async () => {
      const content = [
        "# This is a comment",
        "",
        "# Another comment",
        "   ",
        "# Final comment",
      ];
      const filePath = join(testDir, ".codeiumignore");
      await writeFile(filePath, content.join("\n"));

      const windsurfIgnore = await WindsurfIgnore.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        filePath,
      });

      expect(windsurfIgnore.getPatterns()).toEqual([]);
    });
  });

  describe("getSupportedFileNames", () => {
    it("should return .codeiumignore as supported file", () => {
      const supported = WindsurfIgnore.getSupportedFileNames();
      expect(supported).toEqual([".codeiumignore"]);
    });
  });

  describe("getDefaultPatterns", () => {
    it("should return comprehensive default patterns", () => {
      const patterns = WindsurfIgnore.getDefaultPatterns();
      
      // Check for important security patterns
      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      
      // Check for build artifacts
      expect(patterns).toContain("dist/");
      expect(patterns).toContain("build/");
      expect(patterns).toContain("out/");
      
      // Check for development files
      expect(patterns).toContain("*.log");
      expect(patterns).toContain(".cache/");
      
      // Check for large files
      expect(patterns).toContain("*.mp4");
      expect(patterns).toContain("*.zip");
      expect(patterns).toContain("*.csv");
      
      // Check for infrastructure
      expect(patterns).toContain("*.tfstate");
      expect(patterns).toContain(".terraform/");
    });

    it("should include proper section headers", () => {
      const patterns = WindsurfIgnore.getDefaultPatterns();
      
      expect(patterns).toContain("# ───── Secrets & Credentials ─────");
      expect(patterns).toContain("# ───── Build Artifacts & Dependencies ─────");
      expect(patterns).toContain("# ───── Development Files ─────");
      expect(patterns).toContain("# ───── Large Files & Media ─────");
      expect(patterns).toContain("# ───── Infrastructure & Deployment ─────");
    });
  });

  describe("validate", () => {
    it("should return success for valid instance", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        patterns: [".env", "*.log"],
      });

      const result = windsurfIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid patterns", () => {
      const windsurfIgnore = new WindsurfIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".codeiumignore",
        patterns: null as any,
        validate: false, // Skip validation during construction
      });

      const result = windsurfIgnore.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("Patterns must be defined");
    });
  });

  describe("integration with git ignore patterns", () => {
    it("should include negation patterns for re-inclusion", () => {
      const patterns = WindsurfIgnore.getDefaultPatterns();
      
      // Should have negation patterns for important files
      expect(patterns).toContain("!.env.example");
    });

    it("should follow gitignore syntax conventions", () => {
      const patterns = WindsurfIgnore.getDefaultPatterns();
      
      // Directory patterns should end with /
      const directoryPatterns = patterns.filter(p => p.endsWith("/") && !p.startsWith("#"));
      expect(directoryPatterns.length).toBeGreaterThan(0);
      expect(directoryPatterns).toContain("dist/");
      expect(directoryPatterns).toContain("build/");
      
      // Glob patterns should use proper syntax
      const globPatterns = patterns.filter(p => p.includes("**"));
      expect(globPatterns).toContain("**/apikeys/");
      expect(globPatterns).toContain("**/*_token*");
    });
  });
});