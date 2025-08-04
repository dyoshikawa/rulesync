import { describe, expect, it } from "vitest";
import type { ToolTarget } from "../../types/tool-targets.js";
import { generateWindsurfMcp, generateWindsurfMcpConfiguration } from "./windsurf.js";

describe("generateWindsurfMcpConfiguration", () => {
  it("should generate Windsurf MCP configuration with all servers", () => {
    const mcpServers = {
      "typescript-server": {
        command: "typescript-language-server",
        args: ["--stdio"],
        env: { NODE_ENV: "development" },
      },
      "eslint-server": {
        command: "eslint-server",
        args: ["--stdio"],
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers);

    expect(result).toHaveLength(1);
    expect(result[0]!.filepath).toBe("mcp_config.json");

    const config = JSON.parse(result[0]!.content);
    expect(config.mcpServers).toEqual(mcpServers);
  });

  it("should filter servers by targets", () => {
    const mcpServers = {
      server1: {
        command: "server1",
        targets: ["windsurf", "claudecode"],
      },
      server2: {
        command: "server2",
        targets: ["claudecode"],
      },
      server3: {
        command: "server3",
        targets: ["*"],
      },
    } satisfies Record<
      string,
      {
        command: string;
        targets: ToolTarget[] | ["*"];
      }
    >;

    const result = generateWindsurfMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(Object.keys(config.mcpServers)).toHaveLength(2);
    expect(config.mcpServers).toHaveProperty("server1");
    expect(config.mcpServers).toHaveProperty("server3");
    expect(config.mcpServers).not.toHaveProperty("server2");
  });

  it("should include servers without targets", () => {
    const mcpServers = {
      server1: {
        command: "server1",
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers).toHaveProperty("server1");
  });

  it("should exclude targets from output", () => {
    const mcpServers = {
      server1: {
        command: "server1",
        args: ["--stdio"],
        targets: ["windsurf"],
      },
    } satisfies Record<
      string,
      {
        command: string;
        args: string[];
        targets: ToolTarget[] | ["*"];
      }
    >;

    const result = generateWindsurfMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers.server1).toEqual({
      command: "server1",
      args: ["--stdio"],
    });
    expect(config.mcpServers.server1).not.toHaveProperty("targets");
  });

  it("should handle empty servers object", () => {
    const result = generateWindsurfMcpConfiguration({});
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers).toEqual({});
  });

  it("should support baseDir parameter", () => {
    const mcpServers = {
      "test-server": {
        command: "test",
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers, "/custom/path");
    expect(result[0]!.filepath).toBe("/custom/path/mcp_config.json");
  });

  it("should format JSON with proper indentation", () => {
    const mcpServers = {
      server: {
        command: "test",
        args: ["arg1", "arg2"],
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers);

    // Check that JSON is properly formatted
    expect(result[0]!.content).toContain('  "mcpServers": {');
    expect(result[0]!.content).toContain('    "server": {');
    expect(result[0]!.content).toContain('      "command": "test"');
  });

  it("should handle httpUrl by converting to serverUrl", () => {
    const mcpServers = {
      "http-server": {
        httpUrl: "https://api.example.com/mcp",
        env: { API_KEY: "secret" },
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["http-server"]).toEqual({
      serverUrl: "https://api.example.com/mcp",
      env: { API_KEY: "secret" },
    });
    expect(config.mcpServers["http-server"]).not.toHaveProperty("httpUrl");
  });

  it("should handle url by converting to serverUrl", () => {
    const mcpServers = {
      "sse-server": {
        url: "https://sse.example.com/mcp",
        env: { API_KEY: "secret" },
      },
    };

    const result = generateWindsurfMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["sse-server"]).toEqual({
      serverUrl: "https://sse.example.com/mcp",
      env: { API_KEY: "secret" },
    });
    expect(config.mcpServers["sse-server"]).not.toHaveProperty("url");
  });
});

describe("generateWindsurfMcp", () => {
  it("should generate windsurf MCP config for stdio servers", () => {
    const config = {
      mcpServers: {
        "stdio-server": {
          command: "server-command",
          args: ["--stdio", "--debug"],
          env: { NODE_ENV: "development" },
        },
      },
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toHaveProperty("stdio-server");
    expect(parsed.mcpServers["stdio-server"]).toEqual({
      command: "server-command",
      args: ["--stdio", "--debug"],
      env: { NODE_ENV: "development" },
    });
  });

  it("should handle URL servers with httpUrl", () => {
    const config = {
      mcpServers: {
        "http-server": {
          httpUrl: "https://api.example.com/mcp",
          env: { API_KEY: "secret" },
        } as any,
      },
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toHaveProperty("http-server");
    expect(parsed.mcpServers["http-server"]).toEqual({
      serverUrl: "https://api.example.com/mcp",
      env: { API_KEY: "secret" },
    });
  });

  it("should handle SSE servers", () => {
    const config = {
      mcpServers: {
        "sse-server": {
          url: "https://sse.example.com/mcp",
        } as any,
      },
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["sse-server"]).toEqual({
      serverUrl: "https://sse.example.com/mcp",
    });
  });

  it("should handle cwd property", () => {
    const config = {
      mcpServers: {
        "local-server": {
          command: "local-server",
          cwd: "/workspace/project",
        },
      },
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["local-server"].cwd).toBe("/workspace/project");
  });

  it("should filter servers by windsurf targets", () => {
    const config = {
      mcpServers: {
        "windsurf-only": {
          command: "windsurf-server",
          targets: ["windsurf"] satisfies ToolTarget[],
        },
        "cline-only": {
          command: "cline-server",
          targets: ["cline"] satisfies ToolTarget[],
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

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcpServers)).toHaveLength(3);
    expect(parsed.mcpServers).toHaveProperty("windsurf-only");
    expect(parsed.mcpServers).toHaveProperty("universal");
    expect(parsed.mcpServers).toHaveProperty("no-targets");
    expect(parsed.mcpServers).not.toHaveProperty("cline-only");
  });

  it("should handle empty mcpServers", () => {
    const config = {
      mcpServers: {},
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers).toEqual({});
  });

  it("should prefer httpUrl over url when both present", () => {
    const config = {
      mcpServers: {
        "mixed-server": {
          url: "https://fallback.example.com",
          httpUrl: "https://primary.example.com/mcp",
        } as any,
      },
    };

    const result = generateWindsurfMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcpServers["mixed-server"].serverUrl).toBe("https://primary.example.com/mcp");
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

    const result = generateWindsurfMcp(config);

    expect(result).toContain('  "mcpServers": {');
    expect(result).toContain('    "test-server": {');
    expect(result).toContain('      "command": "test"');
    expect(result).toContain('      "args": [');
    expect(result).toContain('        "arg1"');
  });
});
