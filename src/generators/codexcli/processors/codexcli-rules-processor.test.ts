import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexcliRulesProcessor } from "../../../rules/tools/codexcli-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import { CodexcliRule } from "../rules/codexcli-rule.js";

vi.mock("../../../utils/file-utils.js", () => ({
  fileExists: vi.fn(),
}));

describe("CodexcliRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CodexcliRulesProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();

    processor = new CodexcliRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("build", () => {
    it("should create a new CodexcliRulesProcessor instance", () => {
      const instance = CodexcliRulesProcessor.build({ baseDir: testDir });
      expect(instance).toBeInstanceOf(CodexcliRulesProcessor);
    });
  });

  describe("getRuleClass", () => {
    it("should return CodexcliRule class", () => {
      const RuleClass = processor["getRuleClass"]();
      expect(RuleClass).toBe(CodexcliRule);
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
