import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { CursorRulesProcessor } from "./cursor-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./cursor-rule.js", () => ({
  CursorRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("CursorRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CursorRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new CursorRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(CursorRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .cursorrules file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".cursorrules");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".cursorrules"));
    });

    it("should find .cursor/rules/*.mdc files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockMdcFiles = [
        join(testDir, ".cursor", "rules", "general.mdc"),
        join(testDir, ".cursor", "rules", "specific.mdc"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".cursor", "rules");
      });
      vi.mocked(findFiles).mockResolvedValue(mockMdcFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockMdcFiles));
    });
  });
});
