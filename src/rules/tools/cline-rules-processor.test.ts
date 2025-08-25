import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { ClineRulesProcessor } from "./cline-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./cline-rule.js", () => ({
  ClineRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("ClineRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: ClineRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new ClineRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(ClineRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .clinerules file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".clinerules");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".clinerules"));
    });

    it("should find .clinerules/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMdFiles = [
        join(testDir, ".clinerules", "rule1.md"),
        join(testDir, ".clinerules", "rule2.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".clinerules");
      });
      vi.mocked(findFiles).mockResolvedValue(mockMdFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockMdFiles));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
