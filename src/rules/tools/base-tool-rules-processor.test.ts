import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    mkdir: vi.fn(),
  };
});

vi.mock("../rulesync-rule.js", () => ({
  RulesyncRule: {
    fromFilePath: vi.fn(),
  },
}));

// Create a concrete test implementation of the abstract class
class TestRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }) {
    return new TestRulesProcessor(params);
  }

  protected getRuleClass() {
    return {
      fromRulesyncRule: vi.fn(),
      fromFilePath: vi.fn(),
    } as any;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    return [join(this.baseDir, "test-rule.md")];
  }
}

describe("BaseToolRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: TestRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = TestRulesProcessor.build({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with baseDir", () => {
    expect(processor).toBeInstanceOf(BaseToolRulesProcessor);
  });

  describe("generateAllFromRulesyncRuleFiles", () => {
    it("should throw error if .rulesync directory does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");
      vi.mocked(fileExists).mockResolvedValue(false);

      await expect(processor.generateAllFromRulesyncRuleFiles()).rejects.toThrow(
        ".rulesync directory does not exist",
      );
    });

    it("should process rulesync files when directory exists", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");
      const { RulesyncRule } = await import("../rulesync-rule.js");

      const mockRuleFiles = [join(testDir, ".rulesync", "rule1.md")];
      const mockRulesyncRule = {
        writeFile: vi.fn(),
      };
      const mockToolRule = {
        writeFile: vi.fn(),
      };

      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(findFiles).mockResolvedValue(mockRuleFiles);
      vi.mocked(RulesyncRule.fromFilePath).mockResolvedValue(mockRulesyncRule as any);

      const RuleClass = processor['getRuleClass']();
      vi.mocked(RuleClass.fromRulesyncRule).mockReturnValue(mockToolRule);

      await processor.generateAllFromRulesyncRuleFiles();

      expect(findFiles).toHaveBeenCalledWith(join(testDir, ".rulesync"), ".md");
      expect(RulesyncRule.fromFilePath).toHaveBeenCalledWith(mockRuleFiles[0]);
      expect(RuleClass.fromRulesyncRule).toHaveBeenCalledWith(mockRulesyncRule);
      expect(mockToolRule.writeFile).toHaveBeenCalled();
    });
  });

  describe("validate", () => {
    it("should return error if no rule files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors[0]?.error.message).toContain("No rule files found");
    });

    it("should validate existing rule files", async () => {
      const { fileExists } = await import("../../utils/file.js");

      const mockRule = {
        validate: vi.fn().mockReturnValue({ success: true }),
      };

      vi.mocked(fileExists).mockResolvedValue(true);

      const RuleClass = processor['getRuleClass']();
      vi.mocked(RuleClass.fromFilePath).mockResolvedValue(mockRule);

      const result = await processor.validate();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
