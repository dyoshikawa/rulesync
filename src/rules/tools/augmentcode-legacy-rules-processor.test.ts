import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { AugmentcodeLegacyRulesProcessor } from "./augmentcode-legacy-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./augmentcode-legacy-rule.js", () => ({
  AugmentcodeLegacyRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("AugmentcodeLegacyRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: AugmentcodeLegacyRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new AugmentcodeLegacyRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(AugmentcodeLegacyRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .augment-guidelines file", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".augment-guidelines");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".augment-guidelines"));
    });

    it("should return empty array if .augment-guidelines does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
