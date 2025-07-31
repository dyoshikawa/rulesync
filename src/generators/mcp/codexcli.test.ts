import { describe, expect, it } from "vitest";
import type { RulesyncMcpConfig } from "../../types/mcp.js";
import { generateCodexMcp } from "./codexcli.js";

describe("generateCodexMcp", () => {
  it("should generate Codex CLI MCP config for stdio transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-wrapper": {
          command: "codex_server",
          args: ["--port", "8000"],
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "codex-wrapper": {
          command: "codex_server",
          args: ["--port", "8000"],
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
        },
      },
    });
  });

  it("should generate Codex CLI MCP config for SSE transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-sse": {
          url: "http://localhost:8000/mcp",
          transport: "sse",
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "codex-sse": {
          url: "http://localhost:8000/mcp",
          transport: "sse",
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    });
  });

  it("should generate Codex CLI MCP config for HTTP transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-http": {
          httpUrl: "http://localhost:8000/api/mcp",
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "codex-http": {
          url: "http://localhost:8000/api/mcp",
          transport: "http",
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    });
  });

  it("should handle servers with working directory", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "local-codex": {
          command: "python",
          args: ["-m", "codex_mcp_server"],
          cwd: "/path/to/project",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            PROJECT_ROOT: "/path/to/project",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "local-codex": {
          command: "python",
          args: ["-m", "codex_mcp_server"],
          workingDirectory: "/path/to/project",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            PROJECT_ROOT: "/path/to/project",
          },
        },
      },
    });
  });

  it("should handle multiple servers", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-local": {
          command: "codex_server",
          env: { OPENAI_API_KEY: "sk-local-key" },
        },
        "codex-remote": {
          url: "https://api.example.com/codex-mcp",
          transport: "sse",
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {
        "codex-local": {
          command: "codex_server",
          env: { OPENAI_API_KEY: "sk-local-key" },
        },
        "codex-remote": {
          url: "https://api.example.com/codex-mcp",
          transport: "sse",
        },
      },
    });
  });

  it("should handle empty servers", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {},
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      mcpServers: {},
    });
  });
});
