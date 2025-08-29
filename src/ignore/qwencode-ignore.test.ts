import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("QwencodeIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create QwencodeIgnore with fileFiltering settings", () => {
      const fileFiltering = {
        respectGitIgnore: true,
        enableRecursiveFileSearch: false,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: JSON.stringify({ fileFiltering }, null, 2),
      });

      expect(qwencodeIgnore.getFileFiltering()).toEqual(fileFiltering);
      expect(qwencodeIgnore.getPatterns()).toEqual([]); // QwenCode doesn't use explicit patterns
    });

    it("should create QwencodeIgnore with default settings", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });

      expect(qwencodeIgnore.getFileFiltering()).toEqual({
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      });
      expect(qwencodeIgnore.getPatterns()).toEqual([]);
    });

    it("should create QwencodeIgnore with empty fileFiltering object", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering: {},
        fileContent: JSON.stringify({ fileFiltering: {} }, null, 2),
      });

      expect(qwencodeIgnore.getFileFiltering()).toEqual({
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      });
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert QwencodeIgnore to RulesyncIgnore with default settings", () => {
      const fileFiltering = {
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: JSON.stringify({ fileFiltering }, null, 2),
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");

      const body = rulesyncIgnore.getBody();
      expect(body).toBe("");
    });

    it("should handle performance optimization settings", () => {
      const fileFiltering = {
        respectGitIgnore: true,
        enableRecursiveFileSearch: false,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: JSON.stringify({ fileFiltering }, null, 2),
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });

    it("should handle Git ignore disabled", () => {
      const fileFiltering = {
        respectGitIgnore: false,
        enableRecursiveFileSearch: true,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: JSON.stringify({ fileFiltering }, null, 2),
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create QwencodeIgnore from RulesyncIgnore", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        body: "# Standard patterns\nnode_modules/\ndist/\n*.env\n# Large files\n**/*.csv\n**/*.mp4",
        fileContent: "Test content",
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        rulesyncIgnore,
      });

      const fileFiltering = qwencodeIgnore.getFileFiltering();
      expect(fileFiltering.respectGitIgnore).toBe(true);
      // Should disable recursive search for performance due to ** patterns and large files
      expect(fileFiltering.enableRecursiveFileSearch).toBe(false);
    });

    it("should handle empty patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "empty.md",
        body: "",
        fileContent: "",
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        rulesyncIgnore,
      });

      const fileFiltering = qwencodeIgnore.getFileFiltering();
      expect(fileFiltering.respectGitIgnore).toBe(true);
      expect(fileFiltering.enableRecursiveFileSearch).toBe(true);
    });

    it("should handle performance-related patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "performance.md",
        body: "# Performance optimization\n**/large-data/**\n**/*.zip\n**/cache/**",
        fileContent: "",
      });

      const qwencodeIgnore = QwencodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        rulesyncIgnore,
      });

      const fileFiltering = qwencodeIgnore.getFileFiltering();
      // Should disable recursive search due to performance-related patterns
      expect(fileFiltering.enableRecursiveFileSearch).toBe(false);
    });
  });

  describe("fromFilePath", () => {
    it("should load QwencodeIgnore from valid settings.json", async () => {
      const fileFiltering = {
        respectGitIgnore: false,
        enableRecursiveFileSearch: true,
      };

      const settings = { fileFiltering };
      const filePath = join(testDir, "settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      const qwencodeIgnore = await QwencodeIgnore.fromFilePath({ filePath });

      expect(qwencodeIgnore.getFileFiltering()).toEqual(fileFiltering);
      expect(qwencodeIgnore.getRelativeFilePath()).toBe("settings.json");
    });

    it("should handle settings.json without fileFiltering", async () => {
      const settings = {
        someOtherConfig: "value",
      };

      const filePath = join(testDir, "settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      const qwencodeIgnore = await QwencodeIgnore.fromFilePath({ filePath });

      // Should use default values
      expect(qwencodeIgnore.getFileFiltering()).toEqual({
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      });
    });

    it("should handle settings.json with partial fileFiltering", async () => {
      const settings = {
        fileFiltering: {
          respectGitIgnore: false,
          // Missing enableRecursiveFileSearch
        },
      };

      const filePath = join(testDir, "settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      const qwencodeIgnore = await QwencodeIgnore.fromFilePath({ filePath });

      expect(qwencodeIgnore.getFileFiltering()).toEqual({
        respectGitIgnore: false,
        enableRecursiveFileSearch: true, // Default value
      });
    });

    it("should throw error for invalid JSON", async () => {
      const filePath = join(testDir, "invalid.json");
      await writeFile(filePath, "{ invalid json }");

      await expect(QwencodeIgnore.fromFilePath({ filePath })).rejects.toThrow(/Invalid JSON/);
    });

    it("should throw error for invalid fileFiltering", async () => {
      const settings = {
        fileFiltering: {
          respectGitIgnore: "not-a-boolean", // Invalid: should be boolean
        },
      };

      const filePath = join(testDir, "invalid-settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      await expect(QwencodeIgnore.fromFilePath({ filePath })).rejects.toThrow(/Invalid settings/);
    });
  });

  describe("generateSettingsJson", () => {
    it("should generate valid settings.json", () => {
      const fileFiltering = {
        respectGitIgnore: false,
        enableRecursiveFileSearch: true,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: "",
      });

      const json = qwencodeIgnore.generateSettingsJson();
      const parsed = JSON.parse(json);

      expect(parsed.fileFiltering).toEqual(fileFiltering);
    });

    it("should generate settings.json with default values", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: "",
      });

      const json = qwencodeIgnore.generateSettingsJson();
      const parsed = JSON.parse(json);

      expect(parsed.fileFiltering).toEqual({
        respectGitIgnore: true,
        enableRecursiveFileSearch: true,
      });
    });
  });

  describe("validation", () => {
    it("should pass validation with valid fileFiltering", () => {
      const fileFiltering = {
        respectGitIgnore: true,
        enableRecursiveFileSearch: false,
      };

      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering,
        fileContent: "",
      });

      const result = qwencodeIgnore.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation with invalid respectGitIgnore type", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        // @ts-expect-error - Testing invalid type
        fileFiltering: { respectGitIgnore: "not-a-boolean" },
        fileContent: "",
        validate: false, // Skip validation in constructor for test
      });

      const result = qwencodeIgnore.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("respectGitIgnore must be a boolean");
    });

    it("should fail validation with invalid enableRecursiveFileSearch type", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        // @ts-expect-error - Testing invalid type
        fileFiltering: { enableRecursiveFileSearch: "not-a-boolean" },
        fileContent: "",
        validate: false, // Skip validation in constructor for test
      });

      const result = qwencodeIgnore.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("enableRecursiveFileSearch must be a boolean");
    });
  });

  describe("createWithDefaultRules", () => {
    it("should create QwencodeIgnore with default file filtering settings", () => {
      const qwencodeIgnore = QwencodeIgnore.createWithDefaultRules({
        baseDir: testDir,
      });

      const fileFiltering = qwencodeIgnore.getFileFiltering();
      expect(fileFiltering.respectGitIgnore).toBe(true);
      expect(fileFiltering.enableRecursiveFileSearch).toBe(true);
    });

    it("should use default parameters if none provided", () => {
      const qwencodeIgnore = QwencodeIgnore.createWithDefaultRules();

      expect(qwencodeIgnore.getRelativeDirPath()).toBe(".qwen");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe("settings.json");
    });

    it("should allow partial parameter override", () => {
      const qwencodeIgnore = QwencodeIgnore.createWithDefaultRules({
        baseDir: testDir,
        relativeDirPath: "custom-dir",
        fileFiltering: {
          respectGitIgnore: false,
          enableRecursiveFileSearch: true,
        },
      });

      expect(qwencodeIgnore.getRelativeDirPath()).toBe("custom-dir");
      expect(qwencodeIgnore.getFileFiltering().respectGitIgnore).toBe(false);
      expect(qwencodeIgnore.getFileFiltering().enableRecursiveFileSearch).toBe(true);
    });
  });

  describe("getSupportedFileNames", () => {
    it("should return supported Qwen Code settings filenames", () => {
      const supportedNames = QwencodeIgnore.getSupportedFileNames();

      expect(supportedNames).toContain("settings.json");
      expect(supportedNames.length).toBe(1);
    });
  });

  describe("generateIgnorePatternsFromSettings", () => {
    it("should generate patterns for Git-enabled configuration", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering: {
          respectGitIgnore: true,
          enableRecursiveFileSearch: true,
        },
        fileContent: "",
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });

    it("should generate patterns for performance-optimized configuration", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering: {
          respectGitIgnore: true,
          enableRecursiveFileSearch: false,
        },
        fileContent: "",
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });

    it("should include common Git ignore patterns", () => {
      const qwencodeIgnore = QwencodeIgnore.createWithDefaultRules({
        baseDir: testDir,
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      // QwencodeIgnore has empty patterns by design
      expect(body).toBe("");
    });
  });

  describe("settings file locations", () => {
    it("should work with different directory structures", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: "subdir/.qwen",
        relativeFilePath: "settings.json",
        fileContent: "",
      });

      expect(qwencodeIgnore.getRelativeDirPath()).toBe("subdir/.qwen");
      expect(qwencodeIgnore.getRelativeFilePath()).toBe("settings.json");
    });
  });

  describe("Git integration behavior", () => {
    it("should handle respectGitIgnore true setting appropriately", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering: {
          respectGitIgnore: true,
          enableRecursiveFileSearch: true,
        },
        fileContent: "",
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });

    it("should handle respectGitIgnore false setting appropriately", () => {
      const qwencodeIgnore = new QwencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileFiltering: {
          respectGitIgnore: false,
          enableRecursiveFileSearch: true,
        },
        fileContent: "",
      });

      const rulesyncIgnore = qwencodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toBe("");
    });
  });
});
