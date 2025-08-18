import { describe, expect, it } from "vitest";
import type { ToolTarget } from "../../types/tool-targets.js";
import { generateOpenCodeMcp, generateOpenCodeMcpConfiguration } from "./opencode.js";

describe("generateOpenCodeMcpConfiguration", () => {
  it("should generate OpenCode MCP configuration with all servers", () => {
    const mcpServers = {
      "fs-server": {
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      },
      "github-server": {
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxx" },
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);

    expect(result).toHaveLength(1);
    expect(result[0]!.filepath).toBe("opencode.json");

    const config = JSON.parse(result[0]!.content);
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.mcp).toHaveProperty("fs-server");
    expect(config.mcp).toHaveProperty("github-server");
  });

  it("should generate local server configuration", () => {
    const mcpServers = {
      "local-server": {
        command: ["python", "-m", "mcp_server"],
        args: ["--debug"],
        env: { DATABASE_URL: "postgres://localhost/test" },
        cwd: "/workspace/project",
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp["local-server"]).toEqual({
      type: "local",
      command: ["python", "-m", "mcp_server"],
      args: ["--debug"],
      environment: { DATABASE_URL: "postgres://localhost/test" },
      cwd: "/workspace/project",
      enabled: true,
    });
  });

  it("should generate remote server configuration", () => {
    const mcpServers = {
      "remote-server": {
        url: "https://api.example.com/mcp",
        headers: {
          Authorization: "Bearer token123",
          "X-Client-Version": "1.0.0",
        },
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp["remote-server"]).toEqual({
      type: "remote",
      url: "https://api.example.com/mcp",
      headers: {
        Authorization: "Bearer token123",
        "X-Client-Version": "1.0.0",
      },
      enabled: true,
    });
  });

  it("should prefer httpUrl over url for remote servers", () => {
    const mcpServers = {
      "mixed-server": {
        url: "https://fallback.example.com",
        httpUrl: "https://primary.example.com/mcp",
        headers: { "X-API-Key": "key123" },
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp["mixed-server"]).toEqual({
      type: "remote",
      url: "https://primary.example.com/mcp",
      headers: { "X-API-Key": "key123" },
      enabled: true,
    });
  });

  it("should handle disabled servers", () => {
    const mcpServers = {
      "disabled-server": {
        command: ["test-server"],
        disabled: true,
      },
      "enabled-server": {
        command: ["test-server"],
        disabled: false,
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp["disabled-server"].enabled).toBe(false);
    expect(config.mcp["enabled-server"].enabled).toBe(true);
  });

  it("should filter servers by targets", () => {
    const mcpServers = {
      server1: {
        command: ["server1"],
        targets: ["opencode", "claudecode"],
      },
      server2: {
        command: ["server2"],
        targets: ["claudecode"],
      },
      server3: {
        command: ["server3"],
        targets: ["*"],
      },
    } satisfies Record<
      string,
      {
        command: string[];
        targets: ToolTarget[] | ["*"];
      }
    >;

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(Object.keys(config.mcp)).toHaveLength(2);
    expect(config.mcp).toHaveProperty("server1");
    expect(config.mcp).toHaveProperty("server3");
    expect(config.mcp).not.toHaveProperty("server2");
  });

  it("should include servers without targets", () => {
    const mcpServers = {
      server1: {
        command: ["server1"],
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp).toHaveProperty("server1");
  });

  it("should exclude targets from output", () => {
    const mcpServers = {
      server1: {
        command: ["test-server"],
        args: ["--stdio"],
        targets: ["opencode"],
      },
    } satisfies Record<
      string,
      {
        command: string[];
        args: string[];
        targets: ToolTarget[] | ["*"];
      }
    >;

    const result = generateOpenCodeMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcp.server1).toEqual({
      type: "local",
      command: ["test-server"],
      args: ["--stdio"],
      enabled: true,
    });
    expect(config.mcp.server1).not.toHaveProperty("targets");
  });

  it("should handle empty servers object", () => {
    const result = generateOpenCodeMcpConfiguration({});
    const config = JSON.parse(result[0]!.content);

    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.mcp).toEqual({});
  });

  it("should support baseDir parameter", () => {
    const mcpServers = {
      "test-server": {
        command: ["test"],
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers, "/custom/path");
    expect(result[0]!.filepath).toBe("/custom/path/opencode.json");
  });

  it("should format JSON with proper indentation", () => {
    const mcpServers = {
      server: {
        command: ["test"],
        args: ["arg1", "arg2"],
        env: { NODE_ENV: "development" },
      },
    };

    const result = generateOpenCodeMcpConfiguration(mcpServers);

    // Check that JSON is properly formatted
    expect(result[0]!.content).toContain('  "$schema": "https://opencode.ai/config.json"');
    expect(result[0]!.content).toContain('  "mcp": {');
    expect(result[0]!.content).toContain('    "server": {');
    expect(result[0]!.content).toContain('      "type": "local"');
  });
});

describe("generateOpenCodeMcp", () => {
  it("should generate OpenCode MCP config for local servers", () => {
    const config = {
      mcpServers: {
        "local-server": {
          command: ["bun", "x", "my-mcp-command"],
          args: ["--debug"],
          env: { MY_ENV_VAR: "value" },
          cwd: "/absolute/path",
        },
      },
    };

    const result = generateOpenCodeMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.mcp).toHaveProperty("local-server");
    expect(parsed.mcp["local-server"]).toEqual({
      type: "local",
      command: ["bun", "x", "my-mcp-command"],
      args: ["--debug"],
      environment: { MY_ENV_VAR: "value" },
      cwd: "/absolute/path",
      enabled: true,
    });
  });

  it("should generate OpenCode MCP config for remote servers", () => {
    const config = {
      mcpServers: {
        "remote-server": {
          url: "https://mcp.example.com/api",
          headers: {
            Authorization: "Bearer ${TOKEN}",
            "X-Custom-Header": "${CUSTOM_VALUE}",
          },
        },
      },
    };

    const result = generateOpenCodeMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.mcp["remote-server"]).toEqual({
      type: "remote",
      url: "https://mcp.example.com/api",
      headers: {
        Authorization: "Bearer ${TOKEN}",
        "X-Custom-Header": "${CUSTOM_VALUE}",
      },
      enabled: true,
    });
  });

  it("should handle mixed local and remote servers", () => {
    const config = {
      mcpServers: {
        "fs-server": {
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
        },
        "postgres-server": {
          command: ["python", "-m", "company.pg_mcp"],
          env: { PG_SSL_ROOT_CERT: "/etc/ssl/certs/ca.pem" },
        },
        "sentry-prod": {
          url: "https://mcp.sentry.io",
          headers: { Authorization: "Bearer ${SENTRY_MCP_TOKEN}" },
        },
      },
    };

    const result = generateOpenCodeMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcp)).toHaveLength(3);
    expect(parsed.mcp["fs-server"].type).toBe("local");
    expect(parsed.mcp["postgres-server"].type).toBe("local");
    expect(parsed.mcp["sentry-prod"].type).toBe("remote");
  });

  it("should filter servers by opencode targets", () => {
    const config = {
      mcpServers: {
        "opencode-only": {
          command: ["opencode-server"],
          targets: ["opencode"] satisfies ToolTarget[],
        },
        "cursor-only": {
          command: ["cursor-server"],
          targets: ["cursor"] satisfies ToolTarget[],
        },
        universal: {
          command: ["universal-server"],
          targets: ["*"] as ["*"],
        },
        "no-targets": {
          command: ["no-targets-server"],
        },
      },
    };

    const result = generateOpenCodeMcp(config);
    const parsed = JSON.parse(result);

    expect(Object.keys(parsed.mcp)).toHaveLength(3);
    expect(parsed.mcp).toHaveProperty("opencode-only");
    expect(parsed.mcp).toHaveProperty("universal");
    expect(parsed.mcp).toHaveProperty("no-targets");
    expect(parsed.mcp).not.toHaveProperty("cursor-only");
  });

  it("should handle empty mcpServers", () => {
    const config = {
      mcpServers: {},
    };

    const result = generateOpenCodeMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.mcp).toEqual({});
  });
});
