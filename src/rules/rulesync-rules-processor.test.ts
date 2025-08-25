import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncRulesProcessor } from "./rulesync-rules-processor.js";

vi.mock("../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  };
});

vi.mock("./rulesync-rule.js", () => ({
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

    // Mock process.cwd to return testDir
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    processor = RulesyncRulesProcessor.build();
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should be created via build method", () => {
    expect(processor).toBeInstanceOf(RulesyncRulesProcessor);
  });

  describe("generate", () => {
    it("should create .rulesync directory and write rule file", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");

      const mockRule = {
        getFilePath: vi.fn().mockReturnValue(join(testDir, ".rulesync", "rules.md")),
        getFileContent: vi.fn().mockReturnValue("# Test Rule Content"),
      };

      await processor.generate(mockRule as any);

      expect(mkdir).toHaveBeenCalledWith(join(testDir, ".rulesync"), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        join(testDir, ".rulesync", "rules.md"),
        "# Test Rule Content",
        "utf-8",
      );
    });
  });

  describe("validate", () => {
    it("should return error if .rulesync directory does not exist", async () => {
      const { fileExists } = await import("../utils/file.js");
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error.message).toBe(".rulesync directory does not exist");
    });

    it("should return success if .rulesync directory exists", async () => {
      const { fileExists } = await import("../utils/file.js");
      vi.mocked(fileExists).mockResolvedValue(true);

      const result = await processor.validate();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
