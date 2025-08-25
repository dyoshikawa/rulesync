import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { GeminicliRulesProcessor } from "./geminicli-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./geminicli-rule.js", () => ({
  GeminicliRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("GeminicliRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: GeminicliRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new GeminicliRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(GeminicliRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find GEMINI.md file in root", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, "GEMINI.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "GEMINI.md"));
    });

    it("should find .gemini/GEMINI.md file", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".gemini", "GEMINI.md");
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".gemini", "GEMINI.md"));
    });

    it("should find both files when they exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return (
          path === join(testDir, "GEMINI.md") || path === join(testDir, ".gemini", "GEMINI.md")
        );
      });

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, "GEMINI.md"));
      expect(paths).toContain(join(testDir, ".gemini", "GEMINI.md"));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
