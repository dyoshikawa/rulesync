import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { KiroRulesProcessor } from "./kiro-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./kiro-rule.js", () => ({
  KiroRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("KiroRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: KiroRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new KiroRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(KiroRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .kiro/steering/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockSteeringFiles = [
        join(testDir, ".kiro", "steering", "product.md"),
        join(testDir, ".kiro", "steering", "tech.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".kiro", "steering");
      });
      vi.mocked(findFiles).mockResolvedValue(mockSteeringFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockSteeringFiles));
    });

    it("should return empty array if .kiro/steering does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
