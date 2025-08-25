import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { CopilotRulesProcessor } from "./copilot-rules-processor.js";

vi.mock("../../utils/file.js", () => ({
  fileExists: vi.fn(),
  findFiles: vi.fn(),
}));

vi.mock("./copilot-rule.js", () => ({
  CopilotRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("CopilotRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CopilotRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new CopilotRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should be created with constructor", () => {
    expect(processor).toBeInstanceOf(CopilotRulesProcessor);
  });

  describe("getRuleFilePaths", () => {
    it("should find .github/copilot-instructions.md file", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".github", "copilot-instructions.md");
      });
      vi.mocked(findFiles).mockResolvedValue([]);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toContain(join(testDir, ".github", "copilot-instructions.md"));
    });

    it("should find .github/instructions/*.instructions.md files", async () => {
      const { fileExists, findFiles } = await import("../../utils/file.js");

      const mockInstructionFiles = [
        join(testDir, ".github", "instructions", "general.instructions.md"),
        join(testDir, ".github", "instructions", "specific.instructions.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === join(testDir, ".github", "instructions");
      });
      vi.mocked(findFiles).mockResolvedValue(mockInstructionFiles);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual(expect.arrayContaining(mockInstructionFiles));
    });

    it("should return empty array if no files exist", async () => {
      const { fileExists } = await import("../../utils/file.js");

      vi.mocked(fileExists).mockResolvedValue(false);

      const paths = await (processor as any).getRuleFilePaths();

      expect(paths).toEqual([]);
    });
  });
});
