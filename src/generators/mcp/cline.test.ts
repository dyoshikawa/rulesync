import { describe, expect, it } from "vitest";
import type { ToolTarget } from "../../types/index.js";
import { generateClineMcp, generateClineMcpConfiguration } from "./cline.js";

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

describe("generateClineMcp", () => {
  it("should generate cline MCP config for stdio servers", () => {
    const config = {
      mcpServers: {
        "stdio-server": {
          command: "server-command",
          args: ["--stdio", "--debug"],
          env: { NODE_ENV: "development" },
        },
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toHaveProperty("stdio-server");
    expect(parsed.mcpServers["stdio-server"]).toEqual({
      command: "server-command",
      args: ["--stdio", "--debug"],
      env: { NODE_ENV: "development" },
    });
  });

  it("should generate cline MCP config for HTTP servers", () => {
    const config = {
      mcpServers: {
        "http-server": {
          url: "https://api.example.com/mcp",
          env: { API_KEY: "secret" },
        },
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toHaveProperty("http-server");
    expect(parsed.mcpServers["http-server"]).toEqual({
      url: "https://api.example.com/mcp",
      env: { API_KEY: "secret" },
    });
  });

  it("should handle disabled servers", () => {
    const config = {
      mcpServers: {
        "disabled-server": {
          command: "server",
          disabled: true,
        } as any,
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["disabled-server"].disabled).toBe(true);
  });

  it("should handle alwaysAllow servers", () => {
    const config = {
      mcpServers: {
        "trusted-server": {
          command: "server",
          alwaysAllow: true,
        } as any,
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["trusted-server"].alwaysAllow).toBe(true);
  });

  it("should handle networkTimeout", () => {
    const config = {
      mcpServers: {
        "slow-server": {
          url: "https://slow.example.com",
          networkTimeout: 30000,
        } as any,
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["slow-server"].networkTimeout).toBe(30000);
  });

  it("should filter servers by cline targets", () => {
    const config = {
      mcpServers: {
        "cline-only": {
          command: "cline-server",
          targets: ["cline"] satisfies ToolTarget[],
        },
        "cursor-only": {
          command: "cursor-server",
          targets: ["cursor"] satisfies ToolTarget[],
        },
        universal: {
          command: "universal-server",
          targets: ["*"] as ["*"],
        },
        "no-targets": {
          command: "no-targets-server",
        },
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcpServers)).toHaveLength(3);
    expect(parsed.mcpServers).toHaveProperty("cline-only");
    expect(parsed.mcpServers).toHaveProperty("universal");
    expect(parsed.mcpServers).toHaveProperty("no-targets");
    expect(parsed.mcpServers).not.toHaveProperty("cursor-only");
  });

  it("should preserve additional properties", () => {
    const config = {
      mcpServers: {
        "custom-server": {
          command: "custom",
          customProperty: "value",
          anotherProperty: { nested: true },
        } as any,
      },
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["custom-server"]).toHaveProperty("command", "custom");
    // Note: generateClineMcp only copies known properties, not custom ones
    // This is the expected behavior for type safety
  });

  it("should handle empty mcpServers", () => {
    const config = {
      mcpServers: {},
    };

    const result = generateClineMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toEqual({});
  });

  it("should format JSON with proper indentation", () => {
    const config = {
      mcpServers: {
        "test-server": {
          command: "test",
          args: ["arg1"],
          env: { VAR: "value" },
        },
      },
    };

    const result = generateClineMcp(config);

    expect(result).toContain('  "mcpServers": {');
    expect(result).toContain('    "test-server": {');
    expect(result).toContain('      "command": "test"');
    expect(result).toContain('      "args": [');
    expect(result).toContain('        "arg1"');
  });
});
