import { join } from "node:path";
import glob from "fast-glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotRulesProcessor } from "../../../rules/tools/copilot-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file-utils.js";
import { CopilotRule } from "../rules/copilot-rule.js";

vi.mock("../../../utils/file-utils.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

describe("CopilotRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: CopilotRulesProcessor;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();

    processor = new CopilotRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("build", () => {
    it("should create a new CopilotRulesProcessor instance", () => {
      const instance = CopilotRulesProcessor.build({ baseDir: testDir });
      expect(instance).toBeInstanceOf(CopilotRulesProcessor);
    });
  });

  describe("getRuleClass", () => {
    it("should return CopilotRule class", () => {
      const RuleClass = processor["getRuleClass"]();
      expect(RuleClass).toBe(CopilotRule);
    });
  });

  describe("getRuleFilePaths", () => {
    it("should return empty array when no rule files exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);
      vi.mocked(glob).mockResolvedValue([]);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([]);
    });

    it("should include .github/copilot-instructions.md file when it exists", async () => {
      const copilotInstructionsFile = join(testDir, ".github", "copilot-instructions.md");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === copilotInstructionsFile;
      });

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toContain(copilotInstructionsFile);
    });

    it("should include .github/instructions/*.instructions.md files when directory exists", async () => {
      const instructionsDir = join(testDir, ".github", "instructions");
      const instructionFiles = [
        join(instructionsDir, "rule1.instructions.md"),
        join(instructionsDir, "rule2.instructions.md"),
      ];

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === instructionsDir;
      });
      vi.mocked(glob).mockResolvedValue(instructionFiles);

      const paths = await processor["getRuleFilePaths"]();

      expect(glob).toHaveBeenCalledWith("*.instructions.md", {
        cwd: instructionsDir,
        absolute: true,
      });
      expect(paths).toEqual(expect.arrayContaining(instructionFiles));
    });

    it("should include both copilot-instructions.md and instructions/*.instructions.md files when both exist", async () => {
      const copilotInstructionsFile = join(testDir, ".github", "copilot-instructions.md");
      const instructionsDir = join(testDir, ".github", "instructions");
      const instructionFiles = [
        join(instructionsDir, "rule1.instructions.md"),
        join(instructionsDir, "rule2.instructions.md"),
      ];

      vi.mocked(fileExists).mockResolvedValue(true);
      vi.mocked(glob).mockResolvedValue(instructionFiles);

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toContain(copilotInstructionsFile);
      expect(paths).toEqual(expect.arrayContaining(instructionFiles));
      expect(paths).toHaveLength(3); // 1 copilot-instructions.md + 2 instruction files
    });

    it("should not include instructions/*.instructions.md files when directory does not exist", async () => {
      const copilotInstructionsFile = join(testDir, ".github", "copilot-instructions.md");
      const _instructionsDir = join(testDir, ".github", "instructions");

      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path === copilotInstructionsFile; // Only copilot-instructions.md exists
      });

      const paths = await processor["getRuleFilePaths"]();

      expect(paths).toEqual([copilotInstructionsFile]);
      expect(glob).not.toHaveBeenCalled();
    });
  });

  describe("validate", () => {
    it("should inherit validation from BaseToolRulesProcessor", async () => {
      // This test ensures the processor properly extends BaseToolRulesProcessor
      // and inherits its validation behavior
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error.message).toContain("No rule files found");
    });
  });
});
