import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { QwencodeRulesProcessor } from "./qwencode-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./qwencode-rule.js", () => ({
  QwencodeRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("QwencodeRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: QwencodeRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new QwencodeRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(QwencodeRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find QWEN.md file in root", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, "QWEN.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "QWEN.md"));
    });

    it("should find .qwen/QWEN.md file", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".qwen", "QWEN.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".qwen", "QWEN.md"));
    });

    it("should find both files when they exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, "QWEN.md") || path === join(testDir, ".qwen", "QWEN.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "QWEN.md"));
      expect(paths).toContain(join(testDir, ".qwen", "QWEN.md"));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
