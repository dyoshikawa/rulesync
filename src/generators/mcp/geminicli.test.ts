import { describe, expect, it } from "vitest";
import type { ToolTarget } from "../../types/tool-targets.js";
import { generateGeminiCliMcpConfiguration } from "./geminicli.js";

describe("generateGeminiCliMcpConfiguration", () => {
  it("should generate Gemini MCP configuration with all servers", () => {
    const mcpServers = {
      "typescript-server": {
        command: "typescript-language-server",
        args: ["--stdio"],
        env: { NODE_ENV: "development" },
      },
      "custom-api": {
        url: "http://localhost:4000/mcp",
        headers: { "API-Key": "secret" },
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);

    expect(result).toHaveLength(1);
    expect(result[0]!.filepath).toBe(".gemini/settings.json");

    const config = JSON.parse(result[0]!.content);
    expect(config.mcpServers).toEqual(mcpServers);
  });

  it("should filter servers by targets", () => {
    const mcpServers = {
      server1: {
        command: "server1",
        targets: ["geminicli", "claudecode"] satisfies ToolTarget[],
      },
      server2: {
        command: "server2",
        targets: ["claudecode"] satisfies ToolTarget[],
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

    const result = generateGeminiCliMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(Object.keys(config.mcpServers)).toHaveLength(3);
    expect(config.mcpServers).toHaveProperty("server1");
    expect(config.mcpServers).toHaveProperty("server3");
    expect(config.mcpServers).toHaveProperty("server4");
    expect(config.mcpServers).not.toHaveProperty("server2");
  });

  it("should exclude targets from output", () => {
    const mcpServers = {
      "language-server": {
        command: "lang-server",
        args: ["--stdio", "--log-level", "info"],
        targets: ["geminicli"] satisfies ToolTarget[],
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["language-server"]).toEqual({
      command: "lang-server",
      args: ["--stdio", "--log-level", "info"],
    });
    expect(config.mcpServers["language-server"]).not.toHaveProperty("targets");
  });

  it("should handle empty servers object", () => {
    const result = generateGeminiCliMcpConfiguration({});
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers).toEqual({});
  });

  it("should support baseDir parameter", () => {
    const mcpServers = {
      "test-server": {
        command: "test",
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers, "/home/user/project");
    expect(result[0]!.filepath).toBe("/home/user/project/.gemini/settings.json");
  });

  it("should handle servers with various configurations", () => {
    const mcpServers = {
      "stdio-basic": {
        command: "basic-server",
      },
      "stdio-advanced": {
        command: "advanced-server",
        args: ["--port", "9999", "--workers", "4"],
        env: {
          RUST_LOG: "debug",
          SERVER_MODE: "production",
          CACHE_SIZE: "1024",
        },
      },
      "http-basic": {
        url: "http://localhost:3000",
      },
      "http-advanced": {
        url: "https://api.service.com/v1/mcp",
        headers: {
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9",
          "X-Client-ID": "gemini-cli",
          Accept: "application/json",
          "X-Request-ID": "uuid-here",
        },
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(Object.keys(config.mcpServers)).toHaveLength(4);

    // Check basic configurations
    expect(config.mcpServers["stdio-basic"]).toEqual({
      command: "basic-server",
    });
    expect(config.mcpServers["http-basic"]).toEqual({
      url: "http://localhost:3000",
    });

    // Check advanced configurations
    expect(config.mcpServers["stdio-advanced"]).toEqual({
      command: "advanced-server",
      args: ["--port", "9999", "--workers", "4"],
      env: {
        RUST_LOG: "debug",
        SERVER_MODE: "production",
        CACHE_SIZE: "1024",
      },
    });
    expect(config.mcpServers["http-advanced"]).toEqual({
      url: "https://api.service.com/v1/mcp",
      headers: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9",
        "X-Client-ID": "gemini-cli",
        Accept: "application/json",
        "X-Request-ID": "uuid-here",
      },
    });
  });

  it("should format JSON with proper indentation", () => {
    const mcpServers = {
      "formatted-server": {
        command: "server",
        args: ["--arg1", "--arg2"],
        env: {
          VAR1: "value1",
          VAR2: "value2",
        },
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);

    // Check that JSON is properly formatted
    expect(result[0]!.content).toContain('  "mcpServers": {');
    expect(result[0]!.content).toContain('    "formatted-server": {');
    expect(result[0]!.content).toContain('      "command": "server"');
    expect(result[0]!.content).toContain('      "args": [');
    expect(result[0]!.content).toContain('        "--arg1",');
    expect(result[0]!.content).toContain('        "--arg2"');
    expect(result[0]!.content).toContain('      "env": {');
    expect(result[0]!.content).toContain('        "VAR1": "value1",');
    expect(result[0]!.content).toContain('        "VAR2": "value2"');
  });

  it("should handle environment variables with special values", () => {
    const mcpServers = {
      "env-test-server": {
        command: "test",
        env: {
          EMPTY_VAR: "",
          PATH_VAR: "/usr/local/bin:/usr/bin:/bin",
          JSON_VAR: '{"key":"value"}',
          MULTILINE_VAR: "line1\nline2\nline3",
          SPECIAL_CHARS: "!@#$%^&*()",
        },
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["env-test-server"].env).toEqual({
      EMPTY_VAR: "",
      PATH_VAR: "/usr/local/bin:/usr/bin:/bin",
      JSON_VAR: '{"key":"value"}',
      MULTILINE_VAR: "line1\nline2\nline3",
      SPECIAL_CHARS: "!@#$%^&*()",
    });
  });

  it("should preserve all server properties except targets", () => {
    const mcpServers = {
      "complete-server": {
        command: "complete",
        args: ["--all", "--options"],
        env: { TEST: "true" },
        url: "http://backup.url", // Should be preserved even if unusual
        headers: { "X-Backup": "true" },
        customField: "customValue", // Unknown fields should be preserved
        targets: ["geminicli"] satisfies ToolTarget[], // This should be removed
      },
    };

    const result = generateGeminiCliMcpConfiguration(mcpServers);
    const config = JSON.parse(result[0]!.content);

    expect(config.mcpServers["complete-server"]).toEqual({
      command: "complete",
      args: ["--all", "--options"],
      env: { TEST: "true" },
      url: "http://backup.url",
      headers: { "X-Backup": "true" },
      customField: "customValue",
    });
    expect(config.mcpServers["complete-server"]).not.toHaveProperty("targets");
  });
});
