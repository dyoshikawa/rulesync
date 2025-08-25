import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { ClaudecodeRulesProcessor } from "./claudecode-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./claudecode-rule.js", () => ({
  ClaudecodeRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("ClaudecodeRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: ClaudecodeRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new ClaudecodeRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(ClaudecodeRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find CLAUDE.md file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, "CLAUDE.md");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "CLAUDE.md"));
    });

    it("should find .claude/memories/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMemoryFiles = [
        join(testDir, ".claude", "memories", "memory1.md"),
        join(testDir, ".claude", "memories", "memory2.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".claude", "memories");
      });
      vi.mocked(findFiles).mockResolvedValue(mockMemoryFiles);

      const paths = await (processor as any).getRuleFilePaths();

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
