import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { JunieRulesProcessor } from "./junie-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./junie-rule.js", () => ({
  JunieRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("JunieRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: JunieRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new JunieRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(JunieRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .junie/guidelines.md file", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".junie", "guidelines.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".junie", "guidelines.md"));
    });

    it("should return empty array if .junie/guidelines.md does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
