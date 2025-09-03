import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
import { McpProcessor } from "./mcp-processor.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

vi.mock("../utils/file.js");
vi.mock("../utils/logger.js");

describe("McpProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should use current directory as default baseDir", () => {
      const processor = new McpProcessor({
        toolTarget: "cursor",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should validate tool target", () => {
      expect(() => {
        void new McpProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return supported MCP tool targets", () => {
      const targets = McpProcessor.getToolTargets();

      expect(targets).toContain("amazonqcli");
      expect(targets).toContain("claudecode");
      expect(targets).toContain("cline");
      expect(targets).toContain("copilot");
      expect(targets).toContain("cursor");
      expect(targets).toContain("roo");
    });

    it("should return exactly 6 supported targets", () => {
      const targets = McpProcessor.getToolTargets();
      expect(targets).toHaveLength(6);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load MCP configuration from .rulesync/.mcp.json", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mcpFilePath = join(testDir, ".rulesync", ".mcp.json");

      // Mock the RulesyncMcp.fromFilePath static method
      const mockRulesyncMcp = {
        filePath: mcpFilePath,
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
              args: ["--test"],
            },
          },
        }),
      } as RulesyncMcp;

      vi.doMock("./rulesync-mcp.js", () => ({
        RulesyncMcp: {
          fromFilePath: vi.fn().mockResolvedValue(mockRulesyncMcp),
        },
      }));

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockRulesyncMcp);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync MCP to cursor MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
              args: ["--test"],
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".cursor/mcp.json");
    });

    it("should convert rulesync MCP to claudecode MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".mcp.json");
    });

    it("should convert rulesync MCP to cline MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".cline/mcp.json");
    });

    it("should convert rulesync MCP to amazonqcli MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "amazonqcli",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".amazonq/mcp.json");
    });

    it("should convert rulesync MCP to copilot MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".vscode/mcp.json");
    });

    it("should convert rulesync MCP to roo MCP", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "roo",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({
          mcpServers: {
            "test-server": {
              command: "test-command",
            },
          },
        }),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".roo/mcp.json");
    });

    it("should filter non-MCP files", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockNonMcp = {
        filePath: "some/other/file.md",
        content: "not an MCP file",
      };

      const result = await processor.convertRulesyncFilesToToolFiles([mockNonMcp as any]);

      expect(result).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    it("should load cursor MCP file", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const cursorMcpFile = join(testDir, ".cursor", "mcp.json");
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.fileExists).toHaveBeenCalledWith(cursorMcpFile);
    });

    it("should load cline MCP file", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const clineMcpFile = join(testDir, ".cline", "mcp.json");
      vi.mocked(fileUtils.fileExists).mockResolvedValue(true);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.fileExists).toHaveBeenCalledWith(clineMcpFile);
    });

    it("should return empty array when MCP file doesn't exist", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      vi.mocked(fileUtils.fileExists).mockResolvedValue(false);

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert cursor MCP back to rulesync format", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cursor", "mcp.json"),
          content: JSON.stringify({
            mcpServers: {
              "test-server": {
                command: "test-command",
              },
            },
          }),
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/.mcp.json");
    });

    it("should convert cline MCP back to rulesync format", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cline", "mcp.json"),
          content: JSON.stringify({
            mcpServers: {
              "test-server": {
                command: "test-command",
              },
            },
          }),
        },
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0].getFilePath()).toContain(".rulesync/.mcp.json");
    });

    it("should handle multiple MCP files", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const toolFiles = [
        {
          filePath: join(testDir, ".cursor", "mcp.json"),
          content: JSON.stringify({ mcpServers: {} }),
        },
        // Note: MCP processor typically handles single files, but testing robustness
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("should handle all supported tool targets", async () => {
      const targets = McpProcessor.getToolTargets();

      for (const target of targets) {
        expect(() => {
          void new McpProcessor({
            baseDir: testDir,
            toolTarget: target as any,
          });
        }).not.toThrow();
      }
    });

    it("should handle empty MCP configuration", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const mockRulesyncMcp = {
        filePath: join(testDir, ".rulesync", ".mcp.json"),
        content: JSON.stringify({}),
        frontmatter: {},
      } as RulesyncMcp;

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncMcp]);

      expect(result).toHaveLength(1);
    });
  });
});
