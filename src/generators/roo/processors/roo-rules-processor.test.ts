import { join } from "node:path";
import glob from "fast-glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RooRulesProcessor } from "../../../rules/tools/roo-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import { RooRule } from "../rules/roo-rule.js";

vi.mock("../../../utils/file-utils.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

describe("RooRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: RooRulesProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();

    processor = new RooRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("build", () => {
    it("should create a new RooRulesProcessor instance", () => {
      const instance = RooRulesProcessor.build({ baseDir: testDir });
      expect(instance).toBeInstanceOf(RooRulesProcessor);
    });
  });

  describe("getRuleClass", () => {
    it("should return RooRule class", () => {
      const RuleClass = processor["getRuleClass"]();
      expect(RuleClass).toBe(RooRule);
    });
  });

  describe("getRuleFilePaths", () => {
    it("should return empty array when no rule files exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);
      vi.mocked(glob).mockResolvedValue([]);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
    });

    it("should include .roo/rules/*.mdc files when directory exists", async () => {
      const rooRulesDir = join(testDir, ".roo", "rules");
      const mdcFiles = [join(rooRulesDir, "rule1.mdc"), join(rooRulesDir, "rule2.mdc")];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === rooRulesDir;
      });
      vi.mocked(glob).mockResolvedValue(mdcFiles);

      const paths = await processor["getRuleFilePaths"]();

      expect(glob).toHaveBeenCalledWith("*.mdc", {
        cwd: rooRulesDir,
        absolute: true,
      });
      expect(paths).toEqual(mdcFiles);
    });

    it("should not include files when .roo/rules directory does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
      expect(glob).not.toHaveBeenCalled();
    });

    it("should handle empty .roo/rules directory", async () => {
      const rooRulesDir = join(testDir, ".roo", "rules");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === rooRulesDir;
      });
      vi.mocked(glob).mockResolvedValue([]);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
    });
  });

  describe("validate", () => {
    it("should inherit validation from BaseToolRulesProcessor", async () => {
      // This test ensures the processor properly extends BaseToolRulesProcessor
      // and inherits its validation behavior
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error.message).toContain("No rule files found");
    });
  });
});
