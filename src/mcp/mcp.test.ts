import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { mcpTools } from "./mcp.js";

describe("MCP Tools", () => {
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

  describe("getMcpFile", () => {
    it("should get the MCP configuration file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const mcpConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["--from", "git+https://github.com/oraios/serena", "serena"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const result = await mcpTools.getMcpFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_MCP_RELATIVE_FILE_PATH);
      expect(parsed.content).toContain("serena");
      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.serena).toBeDefined();
    });

    it("should throw error for non-existent MCP file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(mcpTools.getMcpFile.execute()).rejects.toThrow();
    });

    it("should support legacy .mcp.json file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const mcpConfig = {
        mcpServers: {
          context7: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const result = await mcpTools.getMcpFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(".rulesync/.mcp.json");
      expect(parsed.content).toContain("context7");
    });

    it("should handle MCP file with multiple servers", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const mcpConfig = {
        mcpServers: {
          serena: {
            description: "Code analysis tool",
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
          context7: {
            description: "Documentation search",
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
          },
          fetch: {
            description: "Web content fetcher",
            type: "stdio",
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const result = await mcpTools.getMcpFile.execute();
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(Object.keys(contentParsed.mcpServers)).toHaveLength(3);
      expect(contentParsed.mcpServers.serena).toBeDefined();
      expect(contentParsed.mcpServers.context7).toBeDefined();
      expect(contentParsed.mcpServers.fetch).toBeDefined();
    });

    it("should handle MCP file with environment variables", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const mcpConfig = {
        mcpServers: {
          custom: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: {
              API_KEY: "test-key",
              DEBUG: "true",
            },
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const result = await mcpTools.getMcpFile.execute();
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.custom.env.API_KEY).toBe("test-key");
      expect(contentParsed.mcpServers.custom.env.DEBUG).toBe("true");
    });
  });

  describe("putMcpFile", () => {
    it("should create a new MCP file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const mcpConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(mcpConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_MCP_RELATIVE_FILE_PATH);
      expect(parsed.content).toContain("serena");

      // Verify file was created
      const getResult = await mcpTools.getMcpFile.execute();
      const getParsed = JSON.parse(getResult);
      const contentParsed = JSON.parse(getParsed.content);
      expect(contentParsed.mcpServers.serena).toBeDefined();
    });

    it("should update an existing MCP file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Create initial file
      const initialConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(initialConfig, null, 2));

      // Update the file
      const updatedConfig = {
        mcpServers: {
          context7: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
          },
        },
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(updatedConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.context7).toBeDefined();
      expect(contentParsed.mcpServers.serena).toBeUndefined();
    });

    it("should reject invalid JSON content", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      await expect(
        mcpTools.putMcpFile.execute({
          content: "not valid json {{{",
        }),
      ).rejects.toThrow(/Invalid JSON format/i);
    });

    it("should reject oversized MCP files", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const largeContent = JSON.stringify({
        mcpServers: {
          large: {
            type: "stdio",
            command: "test",
            args: ["a".repeat(1024 * 1024 + 1)], // > 1MB
            env: {},
          },
        },
      });

      await expect(
        mcpTools.putMcpFile.execute({
          content: largeContent,
        }),
      ).rejects.toThrow(/exceeds maximum/i);
    });

    it("should create .rulesync directory if it doesn't exist", async () => {
      // Don't create the directory beforehand

      const mcpConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(mcpConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_MCP_RELATIVE_FILE_PATH);
      expect(parsed.content).toContain("serena");
    });

    it("should handle MCP file with complex server configurations", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const complexConfig = {
        mcpServers: {
          serena: {
            description: "Semantic coding tools",
            type: "stdio",
            command: "uvx",
            args: ["--from", "git+https://github.com/oraios/serena", "serena"],
            env: {
              DEBUG: "true",
            },
            disabled: false,
            timeout: 30000,
          },
          context7: {
            description: "Documentation search",
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
          },
        },
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(complexConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.serena.description).toBe("Semantic coding tools");
      expect(contentParsed.mcpServers.serena.timeout).toBe(30000);
      expect(contentParsed.mcpServers.context7).toBeDefined();
    });

    it("should handle MCP file with targets field", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const configWithTargets = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
            targets: ["claudecode", "cursor"],
          },
        },
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(configWithTargets, null, 2),
      });
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.serena.targets).toEqual(["claudecode", "cursor"]);
    });

    it("should handle empty mcpServers object", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      const emptyConfig = {
        mcpServers: {},
      };

      const result = await mcpTools.putMcpFile.execute({
        content: JSON.stringify(emptyConfig, null, 2),
      });
      const parsed = JSON.parse(result);

      const contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers).toEqual({});
    });
  });

  describe("deleteMcpFile", () => {
    it("should delete an existing MCP file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Create a file
      const mcpConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      // Verify it exists
      await expect(mcpTools.getMcpFile.execute()).resolves.toBeDefined();

      // Delete it
      const result = await mcpTools.deleteMcpFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_MCP_RELATIVE_FILE_PATH);

      // Verify it's deleted
      await expect(mcpTools.getMcpFile.execute()).rejects.toThrow();
    });

    it("should succeed when deleting non-existent MCP file (idempotent)", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Deleting a non-existent file should succeed (idempotent operation)
      const result = await mcpTools.deleteMcpFile.execute();
      const parsed = JSON.parse(result);

      expect(parsed.relativePathFromCwd).toBe(RULESYNC_MCP_RELATIVE_FILE_PATH);
    });

    it("should delete both recommended and legacy MCP files", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Create both recommended and legacy files
      const mcpConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      await writeFileContent(join(rulesyncDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));
      await writeFileContent(join(rulesyncDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2));

      // Delete them
      await mcpTools.deleteMcpFile.execute();

      // Verify both are deleted
      await expect(mcpTools.getMcpFile.execute()).rejects.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle full CRUD lifecycle", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Create
      const createConfig = {
        mcpServers: {
          serena: {
            type: "stdio",
            command: "uvx",
            args: ["serena"],
            env: {},
          },
        },
      };

      await mcpTools.putMcpFile.execute({
        content: JSON.stringify(createConfig, null, 2),
      });

      // Read
      let result = await mcpTools.getMcpFile.execute();
      let parsed = JSON.parse(result);
      let contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.serena).toBeDefined();

      // Update
      const updateConfig = {
        mcpServers: {
          context7: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
          },
        },
      };

      await mcpTools.putMcpFile.execute({
        content: JSON.stringify(updateConfig, null, 2),
      });

      result = await mcpTools.getMcpFile.execute();
      parsed = JSON.parse(result);
      contentParsed = JSON.parse(parsed.content);
      expect(contentParsed.mcpServers.context7).toBeDefined();
      expect(contentParsed.mcpServers.serena).toBeUndefined();

      // Delete
      await mcpTools.deleteMcpFile.execute();

      await expect(mcpTools.getMcpFile.execute()).rejects.toThrow();
    });

    it("should handle multiple servers and complex configurations", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);

      // Create a complex configuration
      const complexConfig = {
        mcpServers: {
          serena: {
            description: "Semantic coding tools",
            type: "stdio",
            command: "uvx",
            args: ["--from", "git+https://github.com/oraios/serena", "serena"],
            env: { DEBUG: "true" },
          },
          context7: {
            description: "Documentation search",
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {},
            targets: ["claudecode"],
          },
          fetch: {
            description: "Web content fetcher",
            type: "stdio",
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: {},
          },
        },
      };

      await mcpTools.putMcpFile.execute({
        content: JSON.stringify(complexConfig, null, 2),
      });

      // Read and verify
      const result = await mcpTools.getMcpFile.execute();
      const parsed = JSON.parse(result);
      const contentParsed = JSON.parse(parsed.content);

      expect(Object.keys(contentParsed.mcpServers)).toHaveLength(3);
      expect(contentParsed.mcpServers.serena.description).toBe("Semantic coding tools");
      expect(contentParsed.mcpServers.context7.targets).toEqual(["claudecode"]);
      expect(contentParsed.mcpServers.fetch).toBeDefined();
    });
  });
});
