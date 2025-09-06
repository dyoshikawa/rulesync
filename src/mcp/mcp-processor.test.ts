import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { AmazonqcliMcp } from "./amazonqcli-mcp.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import {
  McpProcessor,
  type McpProcessorToolTarget,
  McpProcessorToolTargetSchema,
  mcpProcessorToolTargets,
} from "./mcp-processor.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

// Mock all MCP classes with their static methods
vi.mock("./amazonqcli-mcp.js");
vi.mock("./claudecode-mcp.js");
vi.mock("./cline-mcp.js");
vi.mock("./copilot-mcp.js");
vi.mock("./cursor-mcp.js");
vi.mock("./roo-mcp.js");
vi.mock("./rulesync-mcp.js");
vi.mock("./tool-mcp.js");

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("McpProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.clearAllMocks();

    // Setup static method mocks
    (AmazonqcliMcp as any).fromFile = vi.fn();
    (AmazonqcliMcp as any).fromRulesyncMcp = vi.fn();
    (ClaudecodeMcp as any).fromFile = vi.fn();
    (ClaudecodeMcp as any).fromRulesyncMcp = vi.fn();
    (ClineMcp as any).fromFile = vi.fn();
    (ClineMcp as any).fromRulesyncMcp = vi.fn();
    (CopilotMcp as any).fromFile = vi.fn();
    (CopilotMcp as any).fromRulesyncMcp = vi.fn();
    (CursorMcp as any).fromFile = vi.fn();
    (CursorMcp as any).fromRulesyncMcp = vi.fn();
    (RooMcp as any).fromFile = vi.fn();
    (RooMcp as any).fromRulesyncMcp = vi.fn();
    (RulesyncMcp as any).fromFile = vi.fn();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should create instance with default baseDir", () => {
      const processor = new McpProcessor({
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should throw error with invalid tool target", () => {
      expect(() => {
        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as McpProcessorToolTarget,
        });
        return processor;
      }).toThrow();
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load rulesync MCP files successfully", async () => {
      const mockRulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(RulesyncMcp.fromFile).mockResolvedValue(mockRulesyncMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const files = await processor.loadRulesyncFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBe(mockRulesyncMcp);
      expect(RulesyncMcp.fromFile).toHaveBeenCalledWith({});
    });

    it("should return empty array when no MCP files found", async () => {
      vi.mocked(RulesyncMcp.fromFile).mockRejectedValue(new Error("File not found"));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const files = await processor.loadRulesyncFiles();

      expect(files).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    describe("amazonqcli", () => {
      it("should load AmazonqcliMcp files", async () => {
        const mockMcp = new AmazonqcliMcp({
          baseDir: testDir,
          relativeDirPath: ".amazonqcli",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(AmazonqcliMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "amazonqcli",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(AmazonqcliMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    describe("claudecode", () => {
      it("should load ClaudecodeMcp files", async () => {
        const mockMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".claudecode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(ClaudecodeMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(ClaudecodeMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    describe("cline", () => {
      it("should load ClineMcp files", async () => {
        const mockMcp = new ClineMcp({
          baseDir: testDir,
          relativeDirPath: ".cline",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(ClineMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "cline",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(ClineMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    describe("copilot", () => {
      it("should load CopilotMcp files", async () => {
        const mockMcp = new CopilotMcp({
          baseDir: testDir,
          relativeDirPath: ".github",
          relativeFilePath: "copilot-mcp.yml",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(CopilotMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "copilot",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(CopilotMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    describe("cursor", () => {
      it("should load CursorMcp files", async () => {
        const mockMcp = new CursorMcp({
          baseDir: testDir,
          relativeDirPath: ".cursor",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(CursorMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "cursor",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(CursorMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    describe("roo", () => {
      it("should load RooMcp files", async () => {
        const mockMcp = new RooMcp({
          baseDir: testDir,
          relativeDirPath: ".roo",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(RooMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "roo",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(RooMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
        });
      });
    });

    it("should return empty array when no tool files found", async () => {
      vi.mocked(CopilotMcp.fromFile).mockRejectedValue(new Error("File not found"));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const files = await processor.loadToolFiles();

      expect(files).toHaveLength(0);
    });

    it("should return empty array when unsupported tool target in catch block", async () => {
      // Create a processor with a valid toolTarget
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      // Override the toolTarget property to simulate an unsupported target
      // This will trigger the default case and throw an error that's caught
      (processor as any).toolTarget = "unsupported";

      // The method should not reject, but should return empty array as it catches errors
      const files = await processor.loadToolFiles();
      expect(files).toEqual([]);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync files to amazonqcli tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new AmazonqcliMcp({
        baseDir: testDir,
        relativeDirPath: ".amazonqcli",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(AmazonqcliMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "amazonqcli",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(AmazonqcliMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should convert rulesync files to claudecode tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".claudecode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(ClaudecodeMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(ClaudecodeMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should convert rulesync files to cline tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new ClineMcp({
        baseDir: testDir,
        relativeDirPath: ".cline",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(ClineMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(ClineMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should convert rulesync files to copilot tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new CopilotMcp({
        baseDir: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-mcp.yml",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(CopilotMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(CopilotMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should convert rulesync files to cursor tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new CursorMcp({
        baseDir: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(CursorMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(CursorMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should convert rulesync files to roo tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new RooMcp({
        baseDir: testDir,
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(RooMcp.fromRulesyncMcp).mockReturnValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(RooMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
      });
    });

    it("should throw error when no RulesyncMcp found", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      await expect(processor.convertRulesyncFilesToToolFiles([])).rejects.toThrow(
        "No .rulesync/.mcp.json found.",
      );
    });

    it("should throw error for unsupported tool target", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      // Override the toolTarget property to simulate an unsupported target
      (processor as any).toolTarget = "unsupported";

      await expect(processor.convertRulesyncFilesToToolFiles([rulesyncMcp])).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should return empty array when no tool files provided", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([]);

      expect(rulesyncFiles).toHaveLength(0);
    });

    // Note: Tests for filtering ToolMcp instances are complex due to instanceof mocking
    // across different vi.mock modules. The core functionality is tested through integration tests.
  });

  describe("getToolTargets", () => {
    it("should return supported tool targets", () => {
      const targets = McpProcessor.getToolTargets();

      expect(targets).toEqual(mcpProcessorToolTargets);
      expect(targets).toContain("amazonqcli");
      expect(targets).toContain("claudecode");
      expect(targets).toContain("cline");
      expect(targets).toContain("copilot");
      expect(targets).toContain("cursor");
      expect(targets).toContain("roo");
    });
  });

  describe("McpProcessorToolTargetSchema", () => {
    it("should validate valid tool targets", () => {
      expect(() => McpProcessorToolTargetSchema.parse("copilot")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("cursor")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("amazonqcli")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("cline")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("roo")).not.toThrow();
    });

    it("should reject invalid tool targets", () => {
      expect(() => McpProcessorToolTargetSchema.parse("invalid")).toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("")).toThrow();
      expect(() => McpProcessorToolTargetSchema.parse(123)).toThrow();
      expect(() => McpProcessorToolTargetSchema.parse(null)).toThrow();
      expect(() => McpProcessorToolTargetSchema.parse(undefined)).toThrow();
    });
  });

  describe("mcpProcessorToolTargets constant", () => {
    it("should contain all expected tool targets", () => {
      expect(mcpProcessorToolTargets).toHaveLength(6);
      expect(mcpProcessorToolTargets).toEqual([
        "amazonqcli",
        "claudecode",
        "cline",
        "copilot",
        "cursor",
        "roo",
      ]);
    });
  });
});
