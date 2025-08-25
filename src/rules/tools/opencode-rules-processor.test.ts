import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { OpencodeRulesProcessor } from "./opencode-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./opencode-rule.js", () => ({
  OpencodeRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("OpencodeRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: OpencodeRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new OpencodeRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(OpencodeRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find AGENTS.md file", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, "AGENTS.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "AGENTS.md"));
    });

    it("should return empty array if AGENTS.md does not exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
