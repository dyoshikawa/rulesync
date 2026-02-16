import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { GeminiCliMcp } from "./geminicli-mcp.js";
import {
  McpProcessor,
  type McpProcessorToolTarget,
  McpProcessorToolTargetSchema,
} from "./mcp-processor.js";
import { OpencodeMcp } from "./opencode-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

// Mock all MCP classes with their static methods
vi.mock("./claudecode-mcp.js");
vi.mock("./cline-mcp.js");
vi.mock("./codexcli-mcp.js");
vi.mock("./copilot-mcp.js");
vi.mock("./cursor-mcp.js");
vi.mock("./geminicli-mcp.js");
vi.mock("./opencode-mcp.js");
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
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    vi.clearAllMocks();

    // Setup static method mocks
    (ClaudecodeMcp as any).fromFile = vi.fn();
    (ClaudecodeMcp as any).fromRulesyncMcp = vi.fn();
    (ClaudecodeMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (ClineMcp as any).fromFile = vi.fn();
    (ClineMcp as any).fromRulesyncMcp = vi.fn();
    (ClineMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (CodexcliMcp as any).fromFile = vi.fn();
    (CodexcliMcp as any).fromRulesyncMcp = vi.fn();
    (CodexcliMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (CopilotMcp as any).fromFile = vi.fn();
    (CopilotMcp as any).fromRulesyncMcp = vi.fn();
    (CopilotMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (CursorMcp as any).fromFile = vi.fn();
    (CursorMcp as any).fromRulesyncMcp = vi.fn();
    (CursorMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (GeminiCliMcp as any).fromFile = vi.fn();
    (GeminiCliMcp as any).fromRulesyncMcp = vi.fn();
    (GeminiCliMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (OpencodeMcp as any).fromFile = vi.fn();
    (OpencodeMcp as any).fromRulesyncMcp = vi.fn();
    (OpencodeMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (RooMcp as any).fromFile = vi.fn();
    (RooMcp as any).fromRulesyncMcp = vi.fn();
    (RooMcp as any).forDeletion = vi.fn().mockImplementation((params) => ({
      ...params,
      isDeletable: () => true,
      getRelativeFilePath: () => params.relativeFilePath,
    }));
    (RulesyncMcp as any).fromFile = vi.fn();
    // stripMcpServerFields returns the same instance by default (no-op for mocked tests)
    (RulesyncMcp.prototype as any).stripMcpServerFields = vi.fn().mockReturnThis();
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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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
          global: false,
        });
      });

      it("should load ClaudecodeMcp files for claudecode-legacy target", async () => {
        const mockMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".claudecode",
          relativeFilePath: "mcp.json",
          fileContent: JSON.stringify({ servers: {} }),
        });

        vi.mocked(ClaudecodeMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "claudecode-legacy",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(ClaudecodeMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
          global: false,
        });
      });

      it("should load ClaudecodeMcp files in global mode", async () => {
        const mockMcp = new ClaudecodeMcp({
          baseDir: testDir,
          relativeDirPath: ".claude",
          relativeFilePath: ".claude.json",
          fileContent: JSON.stringify({ mcpServers: {} }),
        });

        vi.mocked(ClaudecodeMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(ClaudecodeMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
          global: true,
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
          global: false,
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
          global: false,
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
          global: false,
        });
      });
    });

    describe("geminicli", () => {
      it("should load GeminiCliMcp files", async () => {
        const mockMcp = new GeminiCliMcp({
          baseDir: testDir,
          relativeDirPath: ".gemini",
          relativeFilePath: "settings.json",
          fileContent: JSON.stringify({ mcpServers: {} }),
        });

        vi.mocked(GeminiCliMcp.fromFile).mockReturnValue(Promise.resolve(mockMcp));

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "geminicli",
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(GeminiCliMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
          global: false,
        });
      });

      it("should load GeminiCliMcp files in global mode", async () => {
        const mockMcp = new GeminiCliMcp({
          baseDir: testDir,
          relativeDirPath: ".gemini",
          relativeFilePath: "settings.json",
          fileContent: JSON.stringify({ mcpServers: {} }),
        });

        vi.mocked(GeminiCliMcp.fromFile).mockReturnValue(Promise.resolve(mockMcp));

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "geminicli",
          global: true,
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(GeminiCliMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
          global: true,
        });
      });
    });

    describe("codexcli", () => {
      it("should load CodexcliMcp files in global mode", async () => {
        const mockMcp = {
          getRelativeDirPath: () => ".codex",
          getRelativeFilePath: () => "config.toml",
        } as any;

        vi.mocked(CodexcliMcp.fromFile).mockResolvedValue(mockMcp);

        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "codexcli",
          global: true,
        });

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(1);
        expect(files[0]).toBe(mockMcp);
        expect(CodexcliMcp.fromFile).toHaveBeenCalledWith({
          baseDir: testDir,
          validate: true,
          global: true,
        });
      });

      it("should throw error when used in local mode", async () => {
        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: "codexcli",
          global: false,
        });

        vi.mocked(CodexcliMcp.fromFile).mockRejectedValue(
          new Error("getSettablePaths is not supported for CodexcliMcp"),
        );

        const files = await processor.loadToolFiles();

        expect(files).toHaveLength(0);
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
          global: false,
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
    it("should convert rulesync files to claudecode tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      const mockToolMcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".claudecode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ servers: {} }),
      });

      vi.mocked(ClaudecodeMcp.fromRulesyncMcp).mockResolvedValue(mockToolMcp);

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
        global: false,
      });
    });

    it("should convert rulesync files to claudecode tool files in global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mockToolMcp = new ClaudecodeMcp({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      vi.mocked(ClaudecodeMcp.fromRulesyncMcp).mockResolvedValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(ClaudecodeMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });
    });

    it("should convert rulesync files to cline tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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
        global: false,
      });
    });

    it("should convert rulesync files to copilot tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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
        global: false,
      });
    });

    it("should convert rulesync files to cursor tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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
        global: false,
      });
    });

    it("should convert rulesync files to geminicli tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mockToolMcp = new GeminiCliMcp({
        baseDir: testDir,
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      vi.mocked(GeminiCliMcp.fromRulesyncMcp).mockReturnValue(Promise.resolve(mockToolMcp));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(GeminiCliMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
        global: false,
      });
    });

    it("should convert rulesync files to geminicli tool files in global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mockToolMcp = new GeminiCliMcp({
        baseDir: testDir,
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      vi.mocked(GeminiCliMcp.fromRulesyncMcp).mockReturnValue(Promise.resolve(mockToolMcp));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        global: true,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(GeminiCliMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });
    });

    it("should convert rulesync files to codexcli tool files in global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mockToolMcp = {
        getRelativeDirPath: () => ".codex",
        getRelativeFilePath: () => "config.toml",
      } as any;

      vi.mocked(CodexcliMcp.fromRulesyncMcp).mockResolvedValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
        global: true,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBe(mockToolMcp);
      expect(CodexcliMcp.fromRulesyncMcp).toHaveBeenCalledWith({
        baseDir: testDir,
        rulesyncMcp,
        global: true,
      });
    });

    it("should convert rulesync files to roo tool files", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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
        global: false,
      });
    });

    it("should throw error when no RulesyncMcp found", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      await expect(processor.convertRulesyncFilesToToolFiles([])).rejects.toThrow(
        `No ${RULESYNC_MCP_RELATIVE_FILE_PATH} found.`,
      );
    });

    it("should throw error for unsupported tool target", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
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

    it("should strip enabledTools and disabledTools for tools that do not support them", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      vi.mocked(ClaudecodeMcp.fromRulesyncMcp).mockResolvedValue({} as any);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(rulesyncMcp.stripMcpServerFields).toHaveBeenCalledWith([
        "enabledTools",
        "disabledTools",
      ]);
    });

    it("should not strip enabledTools and disabledTools for codexcli", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      vi.mocked(CodexcliMcp.fromRulesyncMcp).mockResolvedValue({} as any);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
        global: true,
      });

      await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(rulesyncMcp.stripMcpServerFields).toHaveBeenCalledWith([]);
    });

    it("should not strip enabledTools and disabledTools for opencode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const mockToolMcp = {} as any;
      vi.mocked(OpencodeMcp.fromRulesyncMcp).mockResolvedValue(mockToolMcp);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);

      expect(rulesyncMcp.stripMcpServerFields).toHaveBeenCalledWith([]);
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
      expect(targets).toContain("claudecode");
      expect(targets).toContain("claudecode-legacy");
      expect(targets).toContain("cline");
      expect(targets).toContain("copilot");
      expect(targets).toContain("cursor");
      expect(targets).toContain("roo");
      expect(targets).not.toContain("codexcli"); // codexcli is global-only
    });
  });

  describe("McpProcessorToolTargetSchema", () => {
    it("should validate valid tool targets", () => {
      expect(() => McpProcessorToolTargetSchema.parse("copilot")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("cursor")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("claudecode-legacy")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("cline")).not.toThrow();
      expect(() => McpProcessorToolTargetSchema.parse("codexcli")).not.toThrow();
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

  describe("loadToolFiles with forDeletion: true", () => {
    it("should return deletable files only", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe("mcp.json");
      expect(vi.mocked(CopilotMcp).forDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          baseDir: testDir,
        }),
      );
    });

    it("should work for all supported tool targets", async () => {
      const targets: McpProcessorToolTarget[] = [
        "claudecode",
        "claudecode-legacy",
        "cline",
        "copilot",
        "cursor",
        "roo",
      ];
      for (const target of targets) {
        const processor = new McpProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

        // Should return files since forDeletion creates instances for deletion
        expect(filesToDelete).toHaveLength(1);
      }
    });

    it("should handle errors gracefully", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      // Override the toolTarget property to simulate an unsupported target
      (processor as any).toolTarget = "unsupported";

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // Should return empty array when error occurs
      expect(filesToDelete).toEqual([]);
    });

    it("should filter out non-deletable files in global mode", async () => {
      // Mock forDeletion to return non-deletable instance
      (vi.mocked(ClaudecodeMcp).forDeletion as ReturnType<typeof vi.fn>).mockImplementation(
        (params: { relativeFilePath: string }) => ({
          ...params,
          isDeletable: () => false,
          getRelativeFilePath: () => params.relativeFilePath,
        }),
      );

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // loadToolFiles with forDeletion: true should filter out non-deletable files
      expect(filesToDelete).toHaveLength(0);
    });

    it("should not filter out deletable files in local mode", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
        global: false,
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // Should return files in local mode
      expect(filesToDelete).toHaveLength(1);
      expect(filesToDelete[0]?.getRelativeFilePath()).toBe(".mcp.json");
    });
  });
});
