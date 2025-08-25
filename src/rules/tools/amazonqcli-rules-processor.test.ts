import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { AmazonqcliRulesProcessor } from "./amazonqcli-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./amazonqcli-rule.js", () => ({
  AmazonqcliRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("AmazonqcliRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: AmazonqcliRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new AmazonqcliRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(AmazonqcliRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .amazonq/rules/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMdFiles = [
        join(testDir, ".amazonq", "rules", "rules.md"),
        join(testDir, ".amazonq", "rules", "guidelines.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".amazonq", "rules");
      });
      vi.mocked(findFiles).mockResolvedValue(mockMdFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockMdFiles));
    });

    it("should return empty array if .amazonq/rules does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
