import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpencodeRule } from "../../../rules/tools/opencode-rule.js";
import { OpencodeRulesProcessor } from "../../../rules/tools/opencode-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file.js";

vi.mock("../../../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

describe("OpencodeRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: OpencodeRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new OpencodeRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("build", () => {
    it("should create a new OpencodeRulesProcessor instance", () => {
      const instance = OpencodeRulesProcessor.build({ baseDir: testDir });
      expect(instance).toBeInstanceOf(OpencodeRulesProcessor);
    });
  });

  describe("getRuleClass", () => {
    it("should return OpencodeRule class", () => {
      const RuleClass = processor["getRuleClass"]();
      expect(RuleClass).toBe(OpencodeRule);
    });
  });

  describe("getRuleFilePaths", () => {
    it("should return empty array when no rule files exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
    });

    it("should include AGENTS.md file when it exists", async () => {
      const agentsFile = join(testDir, "AGENTS.md");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === agentsFile;
      });

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toContain(agentsFile);
    });

    it("should not include AGENTS.md when it does not exist", async () => {
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
