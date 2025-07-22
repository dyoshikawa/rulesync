import { describe, expect, it } from "vitest";
import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { generateAugmentcodeMcp, generateAugmentcodeMcpConfiguration } from "./augmentcode.js";

describe("AugmentCode MCP Generator", () => {
  describe("generateAugmentcodeMcp", () => {
    it("should generate empty configuration when no servers are present", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {},
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [],
      });
    });

    it("should generate STDIO server configuration", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "sqlite-server": {
            targets: ["augmentcode"],
            command: "uvx",
            args: ["mcp-server-sqlite", "--db-path", "./data.db"],
            env: {
              LOG_LEVEL: "info",
            },
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "sqlite-server",
            command: "uvx",
            args: ["mcp-server-sqlite", "--db-path", "./data.db"],
            env: {
              LOG_LEVEL: "info",
            },
          },
        ],
      });
    });

    it("should generate SSE server configuration", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "remote-server": {
            targets: ["augmentcode"],
            url: "https://api.example.com/mcp",
            transport: "sse",
            env: {
              Authorization: "Bearer token123",
              "X-Client": "augment-code",
            },
            timeout: 60000,
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "remote-server",
            url: "https://api.example.com/mcp",
            transport: "sse",
            headers: {
              Authorization: "Bearer token123",
              "X-Client": "augment-code",
            },
            timeout: 60000,
          },
        ],
      });
    });

    it("should generate HTTP server configuration", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "http-server": {
            targets: ["augmentcode"],
            httpUrl: "http://localhost:4000/mcp",
            transport: "http",
            env: {
              "X-API-Key": "secret",
            },
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "http-server",
            url: "http://localhost:4000/mcp",
            transport: "http",
            headers: {
              "X-API-Key": "secret",
            },
          },
        ],
      });
    });

    it("should handle disabled servers", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "disabled-server": {
            targets: ["augmentcode"],
            command: "echo",
            disabled: true,
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "disabled-server",
            command: "echo",
            enabled: false,
          },
        ],
      });
    });

    it("should handle networkTimeout by converting to retries", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "timeout-server": {
            targets: ["augmentcode"],
            command: "slow-server",
            networkTimeout: 120000, // 2 minutes
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "timeout-server",
            command: "slow-server",
            retries: 4, // 120000 / 30000 = 4
          },
        ],
      });
    });

    it("should skip servers not targeting augmentcode", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "augmentcode-server": {
            targets: ["augmentcode"],
            command: "server1",
          },
          "other-server": {
            targets: ["cursor"],
            command: "server2",
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "augmentcode-server",
            command: "server1",
          },
        ],
      });
    });

    it("should include servers with wildcard targets", () => {
      const config: RulesyncMcpConfig = {
        mcpServers: {
          "wildcard-server": {
            targets: ["*"],
            command: "universal-server",
          },
        },
      };

      const result = generateAugmentcodeMcp(config);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        mcpServers: [
          {
            name: "wildcard-server",
            command: "universal-server",
          },
        ],
      });
    });
  });

  describe("generateAugmentcodeMcpConfiguration", () => {
    it("should generate project-scoped configuration", () => {
      const mcpServers: Record<string, RulesyncMcpServer> = {
        "project-server": {
          targets: ["augmentcode"],
          command: "uvx",
          args: ["mcp-server-sqlite", "--db-path", "./project.db"],
        },
      };

      const results = generateAugmentcodeMcpConfiguration(mcpServers, "");

      expect(results).toHaveLength(1);
      expect(results[0]?.filepath).toBe(".mcp.json");

      const parsed = JSON.parse(results[0]?.content || "");
      expect(parsed).toEqual({
        mcpServers: {
          "project-server": {
            command: "uvx",
            args: ["mcp-server-sqlite", "--db-path", "./project.db"],
          },
        },
      });
    });

    it("should generate configuration with baseDir", () => {
      const mcpServers: Record<string, RulesyncMcpServer> = {
        server: {
          targets: ["augmentcode"],
          command: "echo",
        },
      };

      const results = generateAugmentcodeMcpConfiguration(mcpServers, "/project/subdir");

      expect(results).toHaveLength(1);
      expect(results[0]?.filepath).toBe("/project/subdir/.mcp.json");
    });

    it("should filter out non-augmentcode servers", () => {
      const mcpServers: Record<string, RulesyncMcpServer> = {
        "augmentcode-server": {
          targets: ["augmentcode"],
          command: "server1",
        },
        "cursor-server": {
          targets: ["cursor"],
          command: "server2",
        },
      };

      const results = generateAugmentcodeMcpConfiguration(mcpServers, "");

      expect(results).toHaveLength(1);

      const parsed = JSON.parse(results[0]?.content || "");
      expect(parsed.mcpServers).toHaveProperty("augmentcode-server");
      expect(parsed.mcpServers).not.toHaveProperty("cursor-server");
    });

    it("should handle remote servers with proper header mapping", () => {
      const mcpServers: Record<string, RulesyncMcpServer> = {
        "remote-server": {
          targets: ["augmentcode"],
          url: "https://api.example.com/mcp",
          transport: "sse",
          env: {
            Authorization: "Bearer token",
          },
        },
      };

      const results = generateAugmentcodeMcpConfiguration(mcpServers, "");

      expect(results).toHaveLength(1);

      const parsed = JSON.parse(results[0]?.content || "");
      expect(parsed).toEqual({
        mcpServers: {
          "remote-server": {
            url: "https://api.example.com/mcp",
            transport: "sse",
            headers: {
              Authorization: "Bearer token",
            },
          },
        },
      });
    });

    it("should exclude targets field from output", () => {
      const mcpServers: Record<string, RulesyncMcpServer> = {
        "test-server": {
          targets: ["augmentcode"],
          command: "test",
        },
      };

      const results = generateAugmentcodeMcpConfiguration(mcpServers, "");

      expect(results).toHaveLength(1);

      const parsed = JSON.parse(results[0]?.content || "");
      expect(parsed.mcpServers["test-server"]).not.toHaveProperty("targets");
      expect(parsed.mcpServers["test-server"]).toHaveProperty("command", "test");
    });
  });
});
