import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { AugmentcodeRulesProcessor } from "./augmentcode-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./augmentcode-rule.js", () => ({
  AugmentcodeRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("AugmentcodeRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: AugmentcodeRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new AugmentcodeRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(AugmentcodeRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .augment/rules/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMdFiles = [
        join(testDir, ".augment", "rules", "rules.md"),
        join(testDir, ".augment", "rules", "guidelines.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".augment", "rules");
      });
      vi.mocked(findFiles).mockResolvedValue(mockMdFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockMdFiles));
    });

    it("should return empty array if .augment/rules does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
