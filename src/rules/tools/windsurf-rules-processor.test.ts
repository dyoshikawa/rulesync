import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { WindsurfRulesProcessor } from "./windsurf-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./windsurf-rule.js", () => ({
  WindsurfRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("WindsurfRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: WindsurfRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new WindsurfRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(WindsurfRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .windsurf-rules file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".windsurf-rules");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".windsurf-rules"));
    });

    it("should find .windsurf/rules/*.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockRuleFiles = [
        join(testDir, ".windsurf", "rules", "rule1.md"),
        join(testDir, ".windsurf", "rules", "rule2.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".windsurf", "rules");
      });
      vi.mocked(findFiles).mockResolvedValue(mockRuleFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockRuleFiles));
    });

    it("should find both file types when they exist", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockRuleFiles = [join(testDir, ".windsurf", "rules", "rule1.md")];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return (
          path === join(testDir, ".windsurf-rules") || path === join(testDir, ".windsurf", "rules")
        );
      });
      vi.mocked(findFiles).mockResolvedValue(mockRuleFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".windsurf-rules"));
      expect(paths).toEqual(expect.arrayContaining(mockRuleFiles));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
