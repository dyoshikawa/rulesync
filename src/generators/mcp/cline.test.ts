import { describe, expect, it } from "vitest";
import type { ToolTarget } from "../../types/index.js";
import { generateClineMcpConfiguration } from "./cline.js";

describe("generateClineMcpConfiguration", () => {
  it("should generate Cline MCP configuration with all servers", () => {
    const mcpServers = {
      "typescript-server": {
        command: "typescript-language-server",
        args: ["--stdio"],
        env: { NODE_ENV: "development" },
      },
      "custom-server": {
        url: "http://localhost:3000/mcp",
        headers: { Authorization: "Bearer token" },
      },
    };

    const result = generateClineMcpConfiguration(mcpServers);

    expect(result).toHaveLength(1);
    expect(result[0]!.filepath).toBe(".cline/mcp.json");

    const config = JSON.parse(result[0]!.content);
    expect(config.mcpServers).toEqual(mcpServers);
  });

  it("should filter servers by targets", () => {
    const mcpServers = {
      server1: {
        command: "server1",
        targets: ["cline", "cursor"] satisfies ToolTarget[],
      },
      server2: {
        command: "server2",
        targets: ["cursor"] satisfies ToolTarget[],
      },
      server3: {
        command: "server3",
        targets: ["*"] as ["*"],
      },
      server4: {
        command: "server4",
        // No targets means all tools
      },
    };

    const result = generateClineMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(Object.keys(config.mcpServers)).toHaveLength(3);
    expect(config.mcpServers).toHaveProperty("server1");
    expect(config.mcpServers).toHaveProperty("server3");
    expect(config.mcpServers).toHaveProperty("server4");
    expect(config.mcpServers).not.toHaveProperty("server2");
  });

  it("should exclude targets from output", () => {
    const mcpServers = {
      "api-server": {
        url: "http://api.example.com",
        headers: { "X-API-Key": "secret" },
        targets: ["cline"] satisfies ToolTarget[],
      },
    };

    const result = generateClineMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["api-server"]).toEqual({
      url: "http://api.example.com",
      headers: { "X-API-Key": "secret" },
    });
    expect(config.mcpServers["api-server"]).not.toHaveProperty("targets");
  });

  it("should handle empty servers object", () => {
    const result = generateClineMcpConfiguration({});
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers).toEqual({});
  });

  it("should support baseDir parameter", () => {
    const mcpServers = {
      "test-server": {
        command: "test",
      },
    };

    const result = generateClineMcpConfiguration(mcpServers, "/workspace/project");
    expect(result[0]!.filepath).toBe("/workspace/project/.cline/mcp.json");
  });

  it("should handle mix of stdio and HTTP servers", () => {
    const mcpServers = {
      "stdio-server": {
        command: "stdio-server",
        args: ["--port", "9000"],
        env: { DEBUG: "true" },
      },
      "http-server": {
        url: "https://api.service.com/mcp",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      },
      "minimal-stdio": {
        command: "minimal",
      },
      "minimal-http": {
        url: "http://localhost:8080",
      },
    };

    const result = generateClineMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers).toHaveProperty("stdio-server");
    expect(config.mcpServers).toHaveProperty("http-server");
    expect(config.mcpServers).toHaveProperty("minimal-stdio");
    expect(config.mcpServers).toHaveProperty("minimal-http");

    // Check that all properties are preserved
    expect(config.mcpServers["stdio-server"].command).toBe("stdio-server");
    expect(config.mcpServers["stdio-server"].args).toEqual(["--port", "9000"]);
    expect(config.mcpServers["stdio-server"].env).toEqual({ DEBUG: "true" });
    expect(config.mcpServers["http-server"].url).toBe("https://api.service.com/mcp");
    expect(config.mcpServers["http-server"].headers).toHaveProperty("Authorization");
  });

  it("should format JSON with proper indentation", () => {
    const mcpServers = {
      server: {
        command: "test",
        args: ["arg1", "arg2"],
        env: {
          VAR1: "value1",
          VAR2: "value2",
        },
      },
    };

    const result = generateClineMcpConfiguration(mcpServers);

    // Check that JSON is properly formatted
    expect(result[0]!.content).toContain('  "mcpServers": {');
    expect(result[0]!.content).toContain('    "server": {');
    expect(result[0]!.content).toContain('      "command": "test"');
    expect(result[0]!.content).toContain('      "args": [');
    expect(result[0]!.content).toContain('        "arg1",');
    expect(result[0]!.content).toContain('      "env": {');
  });
});
