import { join } from "node:path";
import glob from "fast-glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseToolRulesProcessor } from "../../rules/tools/base-tool-rules-processor.js";
import { BaseToolRule } from "../../rules/tools/base-tool-rule.js";
import { RulesyncRule } from "../../rules/rulesync-rule.js";
import { setupTestDirectory } from "../../test-utils/index.js";
import { fileExists } from "../../utils/file.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    mkdir: vi.fn(),
  };
});

vi.mock("../../rules/rulesync-rule.js", () => ({
  RulesyncRule: {
    fromFilePath: vi.fn(),
  },
}));

// Concrete implementation for testing
class TestToolRule extends BaseToolRule {
  static fromRulesyncRule = vi.fn();
  static fromFilePath = vi.fn();
  
  validate(): { success: boolean; error?: Error } {
    return { success: true };
  }
  
  toRulesyncRule(): RulesyncRule {
    return {} as RulesyncRule;
  }
  
  writeFile = vi.fn();
}

class TestToolRulesProcessor extends BaseToolRulesProcessor<TestToolRule> {
  protected getRulesyncDirectory(): string {
    return join(this.baseDir, ".rulesync");
  }

  protected getRuleClass(): typeof TestToolRule {
    return TestToolRule;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    return [join(this.baseDir, ".test-rules"), join(this.baseDir, "config", "test.md")];
  }
}

describe("BaseToolRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: TestToolRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new TestToolRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should set baseDir correctly", () => {
      expect(processor).toBeDefined();
      expect(processor["baseDir"]).toBe(testDir);
    });
  });

  describe("generateAllFromRulesyncRuleFiles", () => {
    it("should create output files and .rulesync directory", async () => {
      const { mkdir } = await import("node:fs/promises");
      const rulesyncDir = join(testDir, ".rulesync");
      const rulesyncFiles = [join(rulesyncDir, "rule1.md"), join(rulesyncDir, "rule2.md")];

      vi.mocked(glob).mockResolvedValue(rulesyncFiles);
      vi.mocked(fileExists).mockResolvedValue(false);

      const mockRulesyncRule = {};
      const mockToolRule = {
        writeFile: vi.fn(),
      };

      vi.mocked(RulesyncRule.fromFilePath).mockResolvedValue(mockRulesyncRule as any);
      vi.mocked(TestToolRule.fromRulesyncRule).mockReturnValue(mockToolRule as any);

      await processor.generateAllFromRulesyncRuleFiles();

      expect(mkdir).toHaveBeenCalledWith(join(testDir, ".rulesync"), { recursive: true });
      expect(glob).toHaveBeenCalledWith("*.md", {
        cwd: rulesyncDir,
        absolute: true,
      });
      expect(RulesyncRule.fromFilePath).toHaveBeenCalledTimes(2);
      expect(TestToolRule.fromRulesyncRule).toHaveBeenCalledTimes(2);
      expect(mockToolRule.writeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("generateAllToRulesyncRuleFiles", () => {
    it("should create .rulesync directory and process tool-specific files", async () => {
      const { mkdir } = await import("node:fs/promises");
      const rulesyncDir = join(testDir, ".rulesync");
      const toolFile1 = join(testDir, ".test-rules");
      const toolFile2 = join(testDir, "config", "test.md");

      vi.mocked(fileExists).mockResolvedValue(true);

      const mockToolRule = {
        toRulesyncRule: vi.fn().mockReturnValue({
          writeFile: vi.fn(),
        }),
      };
      const mockRulesyncRule = mockToolRule.toRulesyncRule();

      vi.mocked(TestToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

      await processor.generateAllToRulesyncRuleFiles();

      expect(mkdir).toHaveBeenCalledWith(rulesyncDir, { recursive: true });
      expect(TestToolRule.fromFilePath).toHaveBeenCalledWith(toolFile1);
      expect(TestToolRule.fromFilePath).toHaveBeenCalledWith(toolFile2);
      expect(mockToolRule.toRulesyncRule).toHaveBeenCalledTimes(2);
      expect(mockRulesyncRule.writeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("validate", () => {
    it("should return success when all tool files are valid", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const mockToolRule = {
        validate: vi.fn().mockReturnValue({ success: true }),
      };

      vi.mocked(TestToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

      const result = await processor.validate();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockToolRule.validate).toHaveBeenCalledTimes(2);
    });

    it("should return error when a tool file does not exist", async () => {
      const toolFile1 = join(testDir, ".test-rules");
      
      vi.mocked(fileExists)
        .mockResolvedValueOnce(false) // First file doesn't exist
        .mockResolvedValueOnce(true); // Second file exists

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        filePath: toolFile1,
        error: new Error(`.test-rules does not exist`),
      });
    });

    it("should collect validation errors from tool files", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const validationError = new Error("Invalid format");
      const mockToolRule = {
        validate: vi.fn().mockReturnValue({
          success: false,
          error: validationError,
        }),
      };

      vi.mocked(TestToolRule.fromFilePath).mockResolvedValue(mockToolRule as any);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2); // Two files, both with errors
      expect(result.errors[0]?.error).toBe(validationError);
      expect(result.errors[1]?.error).toBe(validationError);
    });

    it("should handle errors when reading tool files", async () => {
      const toolFile1 = join(testDir, ".test-rules");
      vi.mocked(fileExists).mockResolvedValue(true);

      const readError = new Error("Failed to read file");
      vi.mocked(TestToolRule.fromFilePath).mockRejectedValue(readError);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2); // Two files, both with read errors
      expect(result.errors[0]).toEqual({
        filePath: toolFile1,
        error: readError,
      });
    });
  });
});