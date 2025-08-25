import { join } from "node:path";
import glob from "fast-glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsmdRulesProcessor } from "../../../rules/tools/agentsmd-rules-processor.js";
import { setupTestDirectory } from "../../../test-utils/index.js";
import { fileExists } from "../../../utils/file.js";

vi.mock("../../../utils/file.js", () => ({
  fileExists: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    mkdir: vi.fn(),
  };
});

vi.mock("../../../rules/tools/agentsmd-rule.js", () => ({
  AgentsmdRule: {
    fromRulesyncRule: vi.fn(),
    fromFilePath: vi.fn(),
  },
}));

vi.mock("../../../rules/rulesync-rule.js", () => ({
  RulesyncRule: {
    fromFilePath: vi.fn(),
  },
}));

describe("AgentsmdRulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let processor: AgentsmdRulesProcessor;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.clearAllMocks();

    processor = new AgentsmdRulesProcessor({ baseDir: testDir });
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should set baseDir correctly", () => {
      expect(processor).toBeDefined();
    });
  });

  describe("generateAllFromRulesyncRuleFiles", () => {
    it("should create AGENTS.md file and .rulesync directory", async () => {
      const { mkdir } = await import("node:fs/promises");
      const rulesyncDir = join(testDir, ".rulesync");
      const rulesyncFiles = [join(rulesyncDir, "rule1.md"), join(rulesyncDir, "rule2.md")];

      vi.mocked(glob).mockResolvedValue(rulesyncFiles);
      vi.mocked(fileExists).mockResolvedValue(false);

      await processor.generateAllFromRulesyncRuleFiles();

      expect(mkdir).toHaveBeenCalledWith(join(testDir, ".rulesync"), { recursive: true });
      expect(glob).toHaveBeenCalledWith("*.md", {
        cwd: rulesyncDir,
        absolute: true,
      });
    });

    it("should process all .rulesync rule files", async () => {
      const rulesyncDir = join(testDir, ".rulesync");
      const rulesyncFiles = [join(rulesyncDir, "rule1.md"), join(rulesyncDir, "rule2.md")];

      vi.mocked(glob).mockResolvedValue(rulesyncFiles);
      vi.mocked(fileExists).mockResolvedValue(false);

      const mockRulesyncRule = {};
      const mockAgentsmdRule = {
        writeFile: vi.fn(),
      };

      const { RulesyncRule } = await import("../../../rules/rulesync-rule.js");
      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");

      vi.mocked(RulesyncRule.fromFilePath).mockResolvedValue(mockRulesyncRule as any);
      vi.mocked(AgentsmdRule.fromRulesyncRule).mockReturnValue(mockAgentsmdRule as any);

      await processor.generateAllFromRulesyncRuleFiles();

      expect(glob).toHaveBeenCalledWith("*.md", {
        cwd: rulesyncDir,
        absolute: true,
      });
      expect(RulesyncRule.fromFilePath).toHaveBeenCalledTimes(2);
      expect(AgentsmdRule.fromRulesyncRule).toHaveBeenCalledTimes(2);
      expect(mockAgentsmdRule.writeFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("generateAllToRulesyncRuleFiles", () => {
    it("should create .rulesync directory and process AGENTS.md if it exists", async () => {
      const { mkdir } = await import("node:fs/promises");
      const agentsMdFile = join(testDir, "AGENTS.md");
      const rulesyncDir = join(testDir, ".rulesync");

      vi.mocked(fileExists).mockResolvedValue(true);

      const mockAgentsmdRule = {
        toRulesyncRule: vi.fn().mockReturnValue({
          writeFile: vi.fn(),
        }),
      };
      const mockRulesyncRule = mockAgentsmdRule.toRulesyncRule();

      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");
      vi.mocked(AgentsmdRule.fromFilePath).mockResolvedValue(mockAgentsmdRule as any);

      await processor.generateAllToRulesyncRuleFiles();

      expect(mkdir).toHaveBeenCalledWith(rulesyncDir, { recursive: true });
      expect(AgentsmdRule.fromFilePath).toHaveBeenCalledWith(agentsMdFile);
      expect(mockAgentsmdRule.toRulesyncRule).toHaveBeenCalled();
      expect(mockRulesyncRule.writeFile).toHaveBeenCalled();
    });

    it("should create .rulesync directory but not process AGENTS.md if it does not exist", async () => {
      const { mkdir } = await import("node:fs/promises");
      const rulesyncDir = join(testDir, ".rulesync");

      vi.mocked(fileExists).mockResolvedValue(false);

      await processor.generateAllToRulesyncRuleFiles();

      expect(mkdir).toHaveBeenCalledWith(rulesyncDir, { recursive: true });
      
      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");
      expect(AgentsmdRule.fromFilePath).not.toHaveBeenCalled();
    });
  });

  describe("validate", () => {
    it("should return error when AGENTS.md does not exist", async () => {
      const agentsMdFile = join(testDir, "AGENTS.md");
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        filePath: agentsMdFile,
        error: new Error("AGENTS.md does not exist"),
      });
    });

    it("should validate AGENTS.md successfully when file exists and is valid", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const mockAgentsmdRule = {
        validate: vi.fn().mockReturnValue({ success: true }),
      };

      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");
      vi.mocked(AgentsmdRule.fromFilePath).mockResolvedValue(mockAgentsmdRule as any);

      const result = await processor.validate();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockAgentsmdRule.validate).toHaveBeenCalled();
    });

    it("should collect validation errors from AGENTS.md", async () => {
      vi.mocked(fileExists).mockResolvedValue(true);

      const validationError = new Error("Invalid AGENTS.md format");
      const mockAgentsmdRule = {
        validate: vi.fn().mockReturnValue({
          success: false,
          error: validationError,
        }),
      };

      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");
      vi.mocked(AgentsmdRule.fromFilePath).mockResolvedValue(mockAgentsmdRule as any);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toBe(validationError);
    });

    it("should handle errors when reading AGENTS.md file", async () => {
      const agentsMdFile = join(testDir, "AGENTS.md");
      vi.mocked(fileExists).mockResolvedValue(true);

      const readError = new Error("Failed to read file");
      const { AgentsmdRule } = await import("../../../rules/tools/agentsmd-rule.js");
      vi.mocked(AgentsmdRule.fromFilePath).mockRejectedValue(readError);

      const result = await processor.validate();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        filePath: agentsMdFile,
        error: readError,
      });
    });
  });
});