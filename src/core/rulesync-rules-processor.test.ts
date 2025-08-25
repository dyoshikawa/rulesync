import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesyncRule } from "../rules/rulesync-rule.js";
import { RulesyncRulesProcessor } from "../rules/rulesync-rules-processor.js";
import { setupTestDirectory } from "../test-utils/index.js";
import { fileExists } from "../utils/file.js";

vi.mock("../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock("../rules/rulesync-rule.js", () => ({
  RulesyncRule: vi.fn(),
}));

describe("RulesyncRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: RulesyncRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    // Mock process.cwd to return our test directory
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    processor = new RulesyncRulesProcessor();
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should set rulesDir to .rulesync in current working directory", () => {
      expect(processor["rulesDir"]).toBe(join(testDir, ".rulesync"));
    });
  });

  describe("build", () => {
    it("should create a new RulesyncRulesProcessor instance", () => {
      const instance = RulesyncRulesProcessor.build();
      expect(instance).toBeInstanceOf(RulesyncRulesProcessor);
    });
  });

  describe("generate", () => {
    it("should create directory and write rule file", async () => {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const mockRule = {
        getFilePath: vi.fn().mockReturnValue(join(testDir, ".rulesync", "test.md")),
        getFileContent: vi.fn().mockReturnValue("# Test Rule\nContent"),
      } as unknown as RulesyncRule;

      await processor.generate(mockRule);

      expect(mkdir).toHaveBeenCalledWith(join(testDir, ".rulesync"), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        join(testDir, ".rulesync", "test.md"),
        "# Test Rule\nContent",
        "utf-8",
      );
    });
  });

  describe("validate", () => {
    it("should return success when .rulesync directory exists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const result = await processor.validate();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return error when .rulesync directory does not exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        filePath: join(testDir, ".rulesync"),
        error: new Error(".rulesync directory does not exist"),
      });
    });

    it("should check if .rulesync directory exists using fileExists", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      await processor.validate();

      expect(fileExists).toHaveBeenCalledWith(join(testDir, ".rulesync"));
    });
  });
});
