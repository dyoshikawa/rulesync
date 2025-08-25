import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AugmentcodeLegacyRule } from "../../../rules/tools/augmentcode-legacy-rule.js";
import { AugmentcodeLegacyRulesProcessor } from "../../../rules/tools/augmentcode-legacy-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file.js";

vi.mock("../../../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

describe("AugmentcodeLegacyRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: AugmentcodeLegacyRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new AugmentcodeLegacyRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("build", () => {
    it("should create a new AugmentcodeLegacyRulesProcessor instance", () => {
      const instance = AugmentcodeLegacyRulesProcessor.build({ baseDir: testDir });
      expect(instance).toBeInstanceOf(AugmentcodeLegacyRulesProcessor);
    });
  });

  describe("getRuleClass", () => {
    it("should return AugmentcodeLegacyRule class", () => {
      const RuleClass = processor["getRuleClass"]();
      expect(RuleClass).toBe(AugmentcodeLegacyRule);
    });
  });

  describe("getRuleFilePaths", () => {
    it("should return empty array when no rule files exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
    });

    it("should include .augment-guidelines file when it exists", async () => {
      const guidelinesFile = join(testDir, ".augment-guidelines");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === guidelinesFile;
      });

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toContain(guidelinesFile);
    });

    it("should not include .augment-guidelines when it does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

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
