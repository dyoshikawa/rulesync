import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { WarpRule, type WarpRuleParams } from "./warp-rule.js";

describe("WarpRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create a WarpRule with basic parameters", () => {
      const params: WarpRuleParams = {
        relativeDirPath: ".warp",
        relativeFilePath: "test-rule.md",
        fileContent: "# Test Warp Rule\n\nThis is a test warp rule.",
      };

      const warpRule = new WarpRule(params);

      expect(warpRule).toBeInstanceOf(WarpRule);
      expect(warpRule.getRelativeDirPath()).toBe(".warp");
      expect(warpRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(warpRule.getFileContent()).toBe("# Test Warp Rule\n\nThis is a test warp rule.");
      expect(warpRule.isRoot()).toBe(false);
    });

    it("should create a WarpRule with root parameter set to true", () => {
      const params: WarpRuleParams = {
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        fileContent: "# Root Warp Rule\n\nThis is a root warp rule.",
        root: true,
      };

      const warpRule = new WarpRule(params);

      expect(warpRule.isRoot()).toBe(true);
      expect(warpRule.getRelativeFilePath()).toBe("WARP.md");
    });

    it("should create a WarpRule with root parameter set to false", () => {
      const params: WarpRuleParams = {
        relativeDirPath: ".warp",
        relativeFilePath: "memory.md",
        fileContent: "# Memory Rule\n\nThis is a memory rule.",
        root: false,
      };

      const warpRule = new WarpRule(params);

      expect(warpRule.isRoot()).toBe(false);
    });

    it("should default root to false when not provided", () => {
      const params: WarpRuleParams = {
        relativeDirPath: ".warp",
        relativeFilePath: "test.md",
        fileContent: "# Test\n\nContent",
      };

      const warpRule = new WarpRule(params);

      expect(warpRule.isRoot()).toBe(false);
    });

    it("should create a WarpRule with custom baseDir", () => {
      const params: WarpRuleParams = {
        baseDir: "/custom/path",
        relativeDirPath: ".warp",
        relativeFilePath: "custom.md",
        fileContent: "# Custom Rule",
      };

      const warpRule = new WarpRule(params);

      expect(warpRule.getFilePath()).toBe("/custom/path/.warp/custom.md");
    });

    it("should pass all parameters to parent ToolRule", () => {
      const params: WarpRuleParams = {
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        fileContent: "# Test Content",
        validate: false,
        root: true,
      };

      const warpRule = new WarpRule(params);

      expect(warpRule.getBaseDir()).toBe(testDir);
      expect(warpRule.getRelativeDirPath()).toBe(".warp/memories");
      expect(warpRule.getRelativeFilePath()).toBe("test.md");
      expect(warpRule.getFileContent()).toBe("# Test Content");
      expect(warpRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create WarpRule from root WARP.md file", async () => {
      const warpContent = "# Main Warp File\n\nThis is the main warp configuration.";
      await writeFileContent(join(testDir, "WARP.md"), warpContent);

      const warpRule = await WarpRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "WARP.md",
      });

      expect(warpRule.isRoot()).toBe(true);
      expect(warpRule.getRelativeDirPath()).toBe(".");
      expect(warpRule.getRelativeFilePath()).toBe("WARP.md");
      expect(warpRule.getFileContent()).toBe(warpContent);
      expect(warpRule.getFilePath()).toBe(join(testDir, "WARP.md"));
    });

    it("should create WarpRule from memory file in .warp/memories", async () => {
      const memoryContent = "# Memory File\n\nThis is a memory file.";
      const memoriesDir = join(testDir, ".warp/memories");
      await ensureDir(memoriesDir);
      await writeFileContent(join(memoriesDir, "test-memory.md"), memoryContent);

      const warpRule = await WarpRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-memory.md",
      });

      expect(warpRule.isRoot()).toBe(false);
      expect(warpRule.getRelativeDirPath()).toBe(".warp");
      expect(warpRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(warpRule.getFileContent()).toBe(memoryContent);
      expect(warpRule.getFilePath()).toBe(join(testDir, ".warp/test-memory.md"));
    });

    it("should use default baseDir (process.cwd()) when not provided", async () => {
      const warpContent = "# Default Test";
      await writeFileContent(join(testDir, "WARP.md"), warpContent);

      const warpRule = await WarpRule.fromFile({
        relativeFilePath: "WARP.md",
      });

      expect(warpRule.getBaseDir()).toBe(testDir);
      expect(warpRule.isRoot()).toBe(true);
    });

    it("should handle validation parameter", async () => {
      const warpContent = "# Validation Test";
      await writeFileContent(join(testDir, "WARP.md"), warpContent);

      const warpRule = await WarpRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "WARP.md",
        validate: false,
      });

      expect(warpRule).toBeInstanceOf(WarpRule);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        WarpRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create WarpRule from RulesyncRule for root file", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Test warp rule",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        frontmatter,
        body: "# Test Rule\n\nContent",
      });

      const warpRule = WarpRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(warpRule).toBeInstanceOf(WarpRule);
      expect(warpRule.getBaseDir()).toBe(testDir);
      expect(warpRule.getRelativeDirPath()).toBe(".");
      expect(warpRule.getRelativeFilePath()).toBe("WARP.md");
      expect(warpRule.isRoot()).toBe(true);
    });

    it("should create WarpRule from RulesyncRule for memory file", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Test memory rule",
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".warp/memories",
        relativeFilePath: "memory.md",
        frontmatter,
        body: "# Memory Rule\n\nMemory content",
      });

      const warpRule = WarpRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(warpRule).toBeInstanceOf(WarpRule);
      expect(warpRule.getBaseDir()).toBe(testDir);
      expect(warpRule.getRelativeDirPath()).toBe(".warp/memories");
      expect(warpRule.getRelativeFilePath()).toBe("memory.md");
      expect(warpRule.isRoot()).toBe(false);
    });

    it("should use default baseDir (process.cwd()) when not provided", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Default test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        frontmatter,
        body: "# Default",
      });

      const warpRule = WarpRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(warpRule.getBaseDir()).toBe(testDir);
    });

    it("should handle validation parameter", () => {
      const frontmatter: RulesyncRuleFrontmatter = {
        description: "Validation test",
        root: true,
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        frontmatter,
        body: "# Validation",
      });

      const warpRule = WarpRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(warpRule).toBeInstanceOf(WarpRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert WarpRule to RulesyncRule", () => {
      const warpRule = new WarpRule({
        relativeDirPath: ".warp",
        relativeFilePath: "test.md",
        fileContent: "# Test Rule\n\nTest content",
      });

      const rulesyncRule = warpRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncRule.getBody()).toBe("# Test Rule\n\nTest content");
    });

    it("should convert root WarpRule to RulesyncRule", () => {
      const warpRule = new WarpRule({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        fileContent: "# Root Rule\n\nRoot content",
        root: true,
      });

      const rulesyncRule = warpRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("validate", () => {
    it("should always return success true", () => {
      const warpRule = new WarpRule({
        relativeDirPath: ".warp",
        relativeFilePath: "test.md",
        fileContent: "# Test",
      });

      const result = warpRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true even with empty content", () => {
      const warpRule = new WarpRule({
        relativeDirPath: ".warp",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = warpRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should return success true for root file", () => {
      const warpRule = new WarpRule({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        fileContent: "# Root Content",
        root: true,
      });

      const result = warpRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("file path handling", () => {
    it("should correctly identify WARP.md as root file in fromFile", async () => {
      const content = "# Root File";
      await writeFileContent(join(testDir, "WARP.md"), content);

      const warpRule = await WarpRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "WARP.md",
      });

      expect(warpRule.isRoot()).toBe(true);
      expect(warpRule.getRelativeDirPath()).toBe(".");
    });

    it("should correctly handle non-root files in fromFile", async () => {
      const content = "# Memory File";
      const memoriesDir = join(testDir, ".warp/memories");
      await ensureDir(memoriesDir);
      await writeFileContent(join(memoriesDir, "memory.md"), content);

      const warpRule = await WarpRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(warpRule.isRoot()).toBe(false);
      expect(warpRule.getRelativeDirPath()).toBe(".warp");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for root and nonRoot", () => {
      const paths = WarpRule.getSettablePaths();

      expect(paths.root).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
      });

      expect(paths.nonRoot).toEqual({
        relativeDirPath: ".warp/memories",
      });
    });

    it("should have consistent paths structure", () => {
      const paths = WarpRule.getSettablePaths();

      expect(paths).toHaveProperty("root");
      expect(paths).toHaveProperty("nonRoot");
      expect(paths.root).toHaveProperty("relativeDirPath");
      expect(paths.root).toHaveProperty("relativeFilePath");
      expect(paths.nonRoot).toHaveProperty("relativeDirPath");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting warp", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["warp"],
        },
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting warp", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including warp", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "warp", "copilot"],
        },
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".warp/memories",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(WarpRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("integration with ToolRule", () => {
    it("should inherit all ToolRule functionality", () => {
      const warpRule = new WarpRule({
        baseDir: testDir,
        relativeDirPath: ".warp",
        relativeFilePath: "integration.md",
        fileContent: "# Integration Test",
      });

      // Test inherited methods
      expect(warpRule.getBaseDir()).toBe(testDir);
      expect(warpRule.getRelativeDirPath()).toBe(".warp");
      expect(warpRule.getRelativeFilePath()).toBe("integration.md");
      expect(warpRule.getFileContent()).toBe("# Integration Test");
      expect(warpRule.getFilePath()).toBe(join(testDir, ".warp/integration.md"));
    });
  });
});
