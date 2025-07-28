import { describe, expect, it } from "vitest";
import type { RulesyncMcpConfig } from "../../types/mcp.js";
import { generateJunieMcp, generateJunieMcpConfiguration } from "./junie.js";

describe("generateJunieMcp", () => {
  it("should generate Junie MCP config for stdio transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "test-key" },
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "test-server": {
          name: "test-server",
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "test-key" },
          transport: "stdio",
        },
      },
    });
  });

  it("should generate Junie MCP config for HTTP transport with httpUrl", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "http-server": {
          httpUrl: "http://localhost:3000",
          env: { API_KEY: "test-key" },
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "http-server": {
          name: "http-server",
          httpUrl: "http://localhost:3000",
          env: { API_KEY: "test-key" },
        },
      },
    });
  });

  it("should generate Junie MCP config for SSE transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "sse-server": {
          url: "http://localhost:3000",
          transport: "sse",
          timeout: 30000,
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "sse-server": {
          name: "sse-server",
          url: "http://localhost:3000",
          transport: "sse",
          timeout: 30000,
        },
      },
    });
  });

  it("should map streamable-http transport to http", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "streamable-server": {
          httpUrl: "http://localhost:3000",
          transport: "streamable-http" as any, // Type assertion for test
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "streamable-server": {
          name: "streamable-server",
          httpUrl: "http://localhost:3000",
          transport: "http",
        },
      },
    });
  });

  it("should map cwd to workingDirectory", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "python-server": {
          command: "python",
          args: ["-m", "my_server"],
          cwd: "/path/to/project",
          env: { PROJECT_ROOT: "/path/to/project" },
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "python-server": {
          name: "python-server",
          command: "python",
          args: ["-m", "my_server"],
          workingDirectory: "/path/to/project",
          env: { PROJECT_ROOT: "/path/to/project" },
          transport: "stdio",
        },
      },
    });
  });

  it("should include trust setting", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "trusted-server": {
          command: "node",
          args: ["server.js"],
          trust: true,
        },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "trusted-server": {
          name: "trusted-server",
          command: "node",
          args: ["server.js"],
          trust: true,
          transport: "stdio",
        },
      },
    });
  });

  it("should respect targets configuration", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        server1: { command: "node", args: ["s1.js"], targets: ["cursor"] as const },
        server2: { command: "node", args: ["s2.js"], targets: ["junie"] as const },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcpServers)).toHaveLength(1);
    expect(parsed.mcpServers).toHaveProperty("server2");
  });

  it("should include all servers when targets are not specified", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        server1: { command: "node", args: ["s1.js"] },
        server2: { command: "python", args: ["s2.py"] },
      },
    };

    const result = generateJunieMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
    expect(parsed.mcpServers).toHaveProperty("server1");
    expect(parsed.mcpServers).toHaveProperty("server2");
  });
});

describe("generateJunieMcpConfiguration", () => {
  it("should generate configuration files with correct filepath", () => {
    const servers = {
      "test-server": {
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "test-key" },
      },
    };

    const result = generateJunieMcpConfiguration(servers);

    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toBe(".junie/mcp-config.json");

    const parsed = JSON.parse(result[0]?.content || "{}");
    expect(parsed.mcpServers).toHaveProperty("test-server");
  });

  it("should generate configuration files with baseDir", () => {
    const servers = {
      "test-server": {
        command: "node",
        args: ["server.js"],
      },
    };

    const result = generateJunieMcpConfiguration(servers, "/custom/base");

    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toBe("/custom/base/.junie/mcp-config.json");
  });

  it("should preserve server configuration and add name", () => {
    const servers = {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
        env: { LOG_LEVEL: "info" },
        timeout: 15000,
        cwd: "/project/root",
      },
    };

    const result = generateJunieMcpConfiguration(servers);
    const parsed = JSON.parse(result[0]?.content || "{}");

    expect(parsed.mcpServers.filesystem).toEqual({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
      env: { LOG_LEVEL: "info" },
      timeout: 15000,
      workingDirectory: "/project/root",
      transport: "stdio",
    });
  });

  it("should filter servers by targets", () => {
    const servers: Record<string, any> = {
      server1: { command: "node", args: ["s1.js"], targets: ["cursor"] },
      server2: { command: "node", args: ["s2.js"], targets: ["junie"] },
      server3: { command: "node", args: ["s3.js"] }, // No targets specified
    };

    const result = generateJunieMcpConfiguration(servers);
    const parsed = JSON.parse(result[0]?.content || "{}");

    // Should include server2 (targets junie) and server3 (no targets = all tools)
    expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
    expect(parsed.mcpServers).toHaveProperty("server2");
    expect(parsed.mcpServers).toHaveProperty("server3");
    expect(parsed.mcpServers).not.toHaveProperty("server1");
  });
});
