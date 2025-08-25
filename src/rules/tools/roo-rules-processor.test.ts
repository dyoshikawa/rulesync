import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RooRulesProcessor } from "./roo-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./roo-rule.js", () => ({
  RooRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("RooRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: RooRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new RooRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(RooRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .roorules file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".roorules");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".roorules"));
    });

    it("should find .roo/rules/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockRuleFiles = [
        join(testDir, ".roo", "rules", "rule1.md"),
        join(testDir, ".roo", "rules", "rule2.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        if (path === join(testDir, ".roo", "rules")) return true;
        return false;
      });
      vi.mocked(findFiles).mockImplementation(async (dirPath: string) => {
        if (dirPath === join(testDir, ".roo", "rules")) return mockRuleFiles;
        return [];
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockRuleFiles));
    });

    it("should find .roo/memories/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMemoryFiles = [
        join(testDir, ".roo", "memories", "memory1.md"),
        join(testDir, ".roo", "memories", "memory2.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        if (path === join(testDir, ".roo", "memories")) return true;
        return false;
      });
      vi.mocked(findFiles).mockImplementation(async (dirPath: string) => {
        if (dirPath === join(testDir, ".roo", "memories")) return mockMemoryFiles;
        return [];
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockMemoryFiles));
    });

    it("should find all supported files when they exist", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockRuleFiles = [join(testDir, ".roo", "rules", "rule1.md")];
      const mockMemoryFiles = [join(testDir, ".roo", "memories", "memory1.md")];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return (
          path === join(testDir, ".roorules") ||
          path === join(testDir, ".roo", "rules") ||
          path === join(testDir, ".roo", "memories")
        );
      });
      vi.mocked(findFiles).mockImplementation(async (dirPath: string) => {
        if (dirPath === join(testDir, ".roo", "rules")) return mockRuleFiles;
        if (dirPath === join(testDir, ".roo", "memories")) return mockMemoryFiles;
        return [];
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".roorules"));
      expect(paths).toEqual(expect.arrayContaining(mockRuleFiles));
      expect(paths).toEqual(expect.arrayContaining(mockMemoryFiles));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
