import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { CopilotcliMcp } from "./copilotcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CopilotcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", join(testDir, "workspace")],
          },
        },
      });

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getRelativeDirPath()).toBe(".copilot");
      expect(copilotCliMcp.getRelativeFilePath()).toBe("mcp-config.json");
      expect(copilotCliMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const copilotCliMcp = new CopilotcliMcp({
        outputRoot: join(testDir, "custom"),
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      // Use path.join for cross-platform compatibility
      expect(copilotCliMcp.getFilePath()).toContain("custom");
      expect(copilotCliMcp.getFilePath()).toContain(".copilot");
      expect(copilotCliMcp.getFilePath()).toContain("mcp-config.json");
    });

    it("should parse JSON content correctly", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            type: "stdio" as const,
            command: "node",
            args: ["server.js"],
            env: {
              NODE_ENV: "development",
            },
          },
        },
      };
      const validJsonContent = JSON.stringify(jsonData);

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: validJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should handle empty JSON object", () => {
      const emptyJsonContent = JSON.stringify({});

      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: emptyJsonContent,
      });

      expect(copilotCliMcp.getJson()).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      const invalidJsonContent = "{ invalid json }";

      expect(() => {
        const _instance = new CopilotcliMcp({
          relativeDirPath: ".copilot",
          relativeFilePath: "mcp-config.json",
          fileContent: invalidJsonContent,
        });
      }).toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project workspace MCP path for project mode", () => {
      const paths = CopilotcliMcp.getSettablePaths({ global: false });

      expect(paths.relativeDirPath).toBe(".github");
      expect(paths.relativeFilePath).toBe("mcp.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = CopilotcliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".copilot");
      expect(paths.relativeFilePath).toBe("mcp-config.json");
    });

    it("should default to project workspace MCP path when global is not specified", () => {
      const paths = CopilotcliMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".github");
      expect(paths.relativeFilePath).toBe("mcp.json");
    });
  });

  describe("fromFile", () => {
    it("should create instance from the project workspace file with default parameters", async () => {
      const githubDir = join(testDir, ".github");
      await ensureDir(githubDir);

      const jsonData = {
        mcpServers: {
          filesystem: {
            type: "stdio" as const,
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
        },
      };
      await writeFileContent(join(githubDir, "mcp.json"), JSON.stringify(jsonData, null, 2));

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        outputRoot: testDir,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getJson()).toEqual(jsonData);
      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".github/mcp.json"));
    });

    it("should create instance from file with custom outputRoot", async () => {
      const customDir = join(testDir, "custom");
      const githubDir = join(customDir, ".github");
      await ensureDir(githubDir);

      const jsonData = {
        mcpServers: {
          git: {
            type: "stdio" as const,
            command: "node",
            args: ["git-server.js"],
          },
        },
      };
      await writeFileContent(join(githubDir, "mcp.json"), JSON.stringify(jsonData));

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        outputRoot: customDir,
      });

      expect(copilotCliMcp.getFilePath()).toBe(join(customDir, ".github/mcp.json"));
      expect(copilotCliMcp.getJson()).toEqual(jsonData);
    });

    it("should return default empty config if file does not exist", async () => {
      const copilotCliMcp = await CopilotcliMcp.fromFile({
        outputRoot: testDir,
      });

      expect(copilotCliMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should handle global mode", async () => {
      const copilotDir = join(testDir, ".copilot");
      await ensureDir(copilotDir);

      const jsonData = {
        mcpServers: {
          "global-server": {
            type: "stdio" as const,
            command: "npx",
            args: ["global-server"],
          },
        },
      };
      await writeFileContent(
        join(copilotDir, "mcp-config.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const copilotCliMcp = await CopilotcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(copilotCliMcp.getJson()).toEqual(jsonData);
      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert mcpServers key and add type field", async () => {
      const inputMcpServers = {
        "test-server": {
          command: "node",
          args: ["test-server.js"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      // Output should have mcpServers key with type field added
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "test-server": {
            type: "stdio",
            command: "node",
            args: ["test-server.js"],
          },
        },
      });
      expect(copilotCliMcp.getRelativeDirPath()).toBe(".github");
      expect(copilotCliMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should write the global config to .copilot/mcp-config.json in global mode", async () => {
      const inputMcpServers = {
        "global-server": {
          command: "npx",
          args: ["global-mcp-server"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should write the project workspace config to .github/mcp.json in project mode", async () => {
      const inputMcpServers = {
        "project-server": {
          command: "npx",
          args: ["project-mcp-server"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".github/mcp.json"));
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "project-server": {
            type: "stdio",
            command: "npx",
            args: ["project-mcp-server"],
          },
        },
      });
    });

    it("should preserve env field when converting", async () => {
      const inputMcpServers = {
        "custom-server": {
          command: "python",
          args: ["server.py"],
          env: {
            PYTHONPATH: join(testDir, "custom"),
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const targetDir = join(testDir, "target");
      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: targetDir,
        rulesyncMcp,
      });

      expect(copilotCliMcp.getFilePath()).toContain("target");
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "custom-server": {
            type: "stdio",
            command: "python",
            args: ["server.py"],
            env: {
              PYTHONPATH: join(testDir, "custom"),
            },
          },
        },
      });
    });

    it("should handle empty mcpServers object", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should handle global mode", async () => {
      const inputMcpServers = {
        "global-server": {
          command: "npx",
          args: ["global-mcp-server"],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "global-server": {
            type: "stdio",
            command: "npx",
            args: ["global-mcp-server"],
          },
        },
      });
    });

    it("should skip a server that declares no transport instead of failing the run", async () => {
      // The shape a Kilo `{"enabled": false}` toggle imports as. Copilot CLI
      // cannot express a server it does not define, and throwing here would
      // abort every other target of the same `generate`.
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const inputMcpServers = {
        "no-transport-server": {
          disabled: true,
        },
        "real-server": {
          command: "npx",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        logger: mockLogger,
      });

      expect(Object.keys(copilotCliMcp.getJson().mcpServers ?? {})).toEqual(["real-server"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping "no-transport-server"'),
      );
    });

    it("should write a server that states only a url as an http server", async () => {
      // It used to resolve to stdio and be rejected for missing a command,
      // which is not what an entry carrying a url and headers is.
      const inputMcpServers = {
        "url-only": {
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer test-token",
          },
          unknown_field: "value",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(copilotCliMcp.getJson().mcpServers!["url-only"]).toEqual({
        ...inputMcpServers["url-only"],
        type: "http",
      });
    });

    it("should handle command as array and merge remaining elements into args", async () => {
      const inputMcpServers = {
        "array-command-server": {
          command: ["npx", "-y", "@anthropic-ai/mcp-server-filesystem"],
          args: [join(testDir, "workspace")],
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "array-command-server": {
            type: "stdio",
            command: "npx",
            args: ["-y", "@anthropic-ai/mcp-server-filesystem", join(testDir, "workspace")],
          },
        },
      });
    });

    it("should preserve http and sse servers without requiring command", async () => {
      const inputMcpServers = {
        "http-server": {
          type: "http" as const,
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer token",
          },
          tools: ["search"],
        },
        "sse-server": {
          type: "sse" as const,
          url: "http://localhost:4000/sse",
          headers: {
            "X-Test": "true",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: inputMcpServers,
      });
    });

    it("should preserve transport-based remote servers and add type field", async () => {
      const inputMcpServers = {
        "http-server": {
          transport: "http" as const,
          url: "http://localhost:3000/mcp",
          headers: {
            Authorization: "Bearer token",
          },
        },
        "sse-server": {
          transport: "sse" as const,
          url: "http://localhost:4000/sse",
          headers: {
            "X-Test": "true",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: {
          "http-server": {
            type: "http",
            ...inputMcpServers["http-server"],
          },
          "sse-server": {
            type: "sse",
            ...inputMcpServers["sse-server"],
          },
        },
      });
    });

    it("should skip a remote server that has no url or httpUrl", async () => {
      // One entry with nothing to connect to must not take the whole generate
      // run — every other target and feature of it — down with it.
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const inputMcpServers = {
        "remote-server": {
          type: "http" as const,
          headers: {
            Authorization: "Bearer token",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        logger: mockLogger,
      });

      expect(copilotCliMcp.getJson().mcpServers).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping "remote-server"'),
      );
    });

    it("should normalize httpUrl to url and resolve streamable-http to http", async () => {
      // Copilot CLI reads `url`; `httpUrl` is a canonical-only alias, so a
      // server carrying just that used to resolve to stdio and be rejected for
      // having no command.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "httpurl-only": { httpUrl: "https://example.com/mcp" },
            streamable: { type: "streamable-http", url: "https://example.com/s" },
          },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(copilotCliMcp.getJson().mcpServers).toEqual({
        "httpurl-only": { type: "http", url: "https://example.com/mcp" },
        streamable: { type: "http", url: "https://example.com/s" },
      });
    });

    it("should skip a wss:// server that names no transport, in any letter case", async () => {
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            bare: { url: "wss://example.com/mcp" },
            upperCase: { httpUrl: "WSS://example.com/mcp" },
          },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        logger: mockLogger,
      });

      // Written as `http`, the url scheme would sit under a transport Copilot
      // CLI speaks HTTP to.
      expect(copilotCliMcp.getJson().mcpServers).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping "bare"'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping "upperCase"'));
    });

    it("should keep the httpUrl alias out of a stdio server too", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { odd: { type: "stdio", command: "node", httpUrl: "https://example.com" } },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(copilotCliMcp.getJson().mcpServers!.odd).toEqual({
        type: "stdio",
        command: "node",
      });
    });

    it("should skip a WebSocket server, which Copilot CLI has no transport for", async () => {
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { socket: { type: "ws", url: "wss://example.com/mcp" } },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        logger: mockLogger,
      });

      expect(copilotCliMcp.getJson().mcpServers).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('skipping "socket"'));
    });

    it("should skip a local server that has no command", async () => {
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const inputMcpServers = {
        "local-server": {
          type: "local" as const,
          cwd: testDir,
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
        logger: mockLogger,
      });

      expect(copilotCliMcp.getJson().mcpServers).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('skipping "local-server"'),
      );
    });

    it("should preserve existing non-stdio type when converting", async () => {
      const inputMcpServers = {
        "typed-server": {
          type: "http" as const,
          command: "node",
          args: ["server.js"],
          url: "http://localhost:3000/mcp",
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(copilotCliMcp.getJson()).toEqual({
        mcpServers: inputMcpServers,
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert mcpServers key and remove type field", () => {
      const inputMcpServers = {
        filesystem: {
          type: "stdio" as const,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", join(testDir, "tmp")],
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      // Output should have mcpServers key without type field
      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", join(testDir, "tmp")],
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
    });

    it("should preserve server data when converting to RulesyncMcp", () => {
      const inputMcpServers = {
        "complex-server": {
          type: "stdio" as const,
          command: "node",
          args: ["complex-server.js", "--port", "3000"],
          env: {
            NODE_ENV: "production",
            DEBUG: "mcp:*",
          },
        },
        "another-server": {
          type: "stdio" as const,
          command: "python",
          args: ["another-server.py"],
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        outputRoot: join(testDir, "test"),
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getOutputRoot()).toBe(join(testDir, "test"));
      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
            },
          },
          "another-server": {
            command: "python",
            args: ["another-server.py"],
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should handle empty mcpServers object when converting", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {},
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should handle missing mcpServers key", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({}),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {},
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });

    it("should preserve non-stdio type when converting back to RulesyncMcp", () => {
      const inputMcpServers = {
        "http-server": {
          type: "http" as const,
          command: "node",
          args: ["server.js"],
          url: "http://localhost:3000/mcp",
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: inputMcpServers }),
      });

      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          "http-server": {
            type: "http",
            command: "node",
            args: ["server.js"],
            url: "http://localhost:3000/mcp",
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            type: "stdio" as const,
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify(jsonData),
        validate: false,
      });

      const result = copilotCliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("isDeletable", () => {
    it("should return true for project mode", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });

      expect(copilotCliMcp.isDeletable()).toBe(true);
    });

    it("should return false for global mode", () => {
      const copilotCliMcp = new CopilotcliMcp({
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: true,
      });

      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create instance for deletion", () => {
      const copilotCliMcp = CopilotcliMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
      });

      expect(copilotCliMcp).toBeInstanceOf(CopilotcliMcp);
      expect(copilotCliMcp.getFilePath()).toBe(join(testDir, ".copilot/mcp-config.json"));
    });

    it("should create instance for deletion with global mode", () => {
      const copilotCliMcp = CopilotcliMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        global: true,
      });

      // Verify global mode via isDeletable (returns false for global mode)
      expect(copilotCliMcp.isDeletable()).toBe(false);
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const githubDir = join(testDir, ".github");
      await ensureDir(githubDir);

      const originalServers = {
        "workflow-server": {
          type: "stdio" as const,
          command: "node",
          args: ["workflow-server.js", "--config", "config.json"],
          env: {
            NODE_ENV: "test",
          },
        },
      };
      await writeFileContent(
        join(githubDir, "mcp.json"),
        JSON.stringify({ mcpServers: originalServers }, null, 2),
      );

      // Step 1: Load from file
      const originalCopilotcliMcp = await CopilotcliMcp.fromFile({
        outputRoot: testDir,
      });
      expect(originalCopilotcliMcp.getJson()).toEqual({ mcpServers: originalServers });

      // Step 2: Convert to RulesyncMcp (should remove type field)
      const rulesyncMcp = originalCopilotcliMcp.toRulesyncMcp();
      expect(rulesyncMcp.getJson()).toEqual({
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js", "--config", "config.json"],
            env: {
              NODE_ENV: "test",
            },
          },
        },
        $schema: RULESYNC_MCP_SCHEMA_URL,
      });

      // Step 3: Create new CopilotcliMcp from RulesyncMcp (should add type field)
      const newCopilotcliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - type field is restored
      expect(newCopilotcliMcp.getJson()).toEqual({ mcpServers: originalServers });
      // Project mode writes the workspace MCP config to .github/mcp.json.
      expect(newCopilotcliMcp.getFilePath()).toBe(join(testDir, ".github/mcp.json"));
    });

    it('should preserve unknown fields like "tools" and "url" during conversion', async () => {
      const originalServers = {
        "test-server": {
          command: "node",
          args: ["main.js"],
          tools: ["tool1", "tool2"], // Specific to Copilot CLI or other tools
          url: "http://localhost:8080", // Specific to SSE/HTTP servers
          headers: { "X-Test": "Value" },
          unknown_field: "value",
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({ mcpServers: originalServers }, null, 2),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      // Verification: All fields should be preserved, and "type": "stdio" added
      const json = copilotCliMcp.getJson();
      expect(json.mcpServers!["test-server"]).toEqual({
        ...originalServers["test-server"],
        type: "stdio",
      });

      // Round-trip back to RulesyncMcp. `tools` is Copilot CLI's spelling of the
      // canonical allowlist, so it normalizes onto `enabledTools`; regenerating
      // writes `tools` again, so the tool-side file is stable.
      const backToRulesync = copilotCliMcp.toRulesyncMcp();
      const backJson = JSON.parse(backToRulesync.getFileContent());
      const { tools, ...withoutTools } = originalServers["test-server"];
      expect(backJson.mcpServers["test-server"]).toEqual({
        ...withoutTools,
        enabledTools: tools,
      });
    });

    it("should write canonical enabledTools as the documented tools allowlist (issue #2402)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({
          mcpServers: {
            github: { command: "gh-mcp", enabledTools: ["create_issue", "list_issues"] },
          },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      // Copilot CLI ignores an `enabledTools` key and keeps every tool exposed.
      expect(copilotCliMcp.getJson().mcpServers!.github).toEqual({
        type: "stdio",
        command: "gh-mcp",
        tools: ["create_issue", "list_issues"],
      });

      const backJson = JSON.parse(copilotCliMcp.toRulesyncMcp().getFileContent());
      expect(backJson.mcpServers.github.enabledTools).toEqual(["create_issue", "list_issues"]);
      expect(backJson.mcpServers.github.tools).toBeUndefined();
    });

    it("should keep a non-array tools value under tools on import (issue #2402 follow-up)", async () => {
      const copilotCliMcp = new CopilotcliMcp({
        outputRoot: testDir,
        relativeDirPath: ".github",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { github: { type: "stdio", command: "gh-mcp", tools: "*" } },
        }),
      });

      const backJson = JSON.parse(copilotCliMcp.toRulesyncMcp().getFileContent());
      // Canonical `enabledTools` is `string[]`; carrying the documented bare
      // `"*"` there would reject the whole imported MCP file.
      expect(backJson.mcpServers.github.enabledTools).toBeUndefined();
      expect(backJson.mcpServers.github.tools).toBe("*");
    });

    it("should keep enabledTools and drop a colliding native tools", async () => {
      const mockLogger = { warn: vi.fn() } as unknown as Logger;
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
        fileContent: JSON.stringify({
          mcpServers: {
            github: { command: "gh-mcp", tools: ["*"], enabledTools: ["create_issue"] },
          },
        }),
      });

      const copilotCliMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger: mockLogger,
      });

      // The canonical allowlist wins: a stale `tools: ["*"]` (the upstream
      // default) must not silently re-expose every tool.
      expect(copilotCliMcp.getJson().mcpServers!.github).toEqual({
        type: "stdio",
        command: "gh-mcp",
        tools: ["create_issue"],
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("dropping 'tools'"));
    });

    it("should maintain data consistency across transformations", async () => {
      const originalServers = {
        "primary-server": {
          type: "stdio" as const,
          command: "node",
          args: ["primary.js", "--mode", "production"],
          env: {
            NODE_ENV: "production",
            LOG_LEVEL: "info",
          },
        },
        "secondary-server": {
          type: "stdio" as const,
          command: "python",
          args: ["secondary.py", "--workers", "4"],
          env: {
            PYTHONPATH: join(testDir, "app/lib"),
          },
        },
      };

      // Create CopilotcliMcp
      const copilotCliMcp = new CopilotcliMcp({
        outputRoot: testDir,
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
        fileContent: JSON.stringify({ mcpServers: originalServers }),
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = copilotCliMcp.toRulesyncMcp();
      // RulesyncMcp should not have type field
      expect(rulesyncMcp.getJson().mcpServers["primary-server"]).not.toHaveProperty("type");

      // Create new CopilotcliMcp from RulesyncMcp (round-trip)
      const roundTrippedMcp = await CopilotcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      // Verify data integrity - type field is restored and all data preserved
      expect(roundTrippedMcp.getJson()).toEqual({ mcpServers: originalServers });
      // Project mode writes the workspace MCP config to .github/mcp.json.
      expect(roundTrippedMcp.getFilePath()).toBe(join(testDir, ".github/mcp.json"));
    });
  });
});
