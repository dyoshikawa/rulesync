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
      servers: {
        "codex-wrapper": {
          command: "codex_server",
          args: ["--port", "8000"],
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
          transport: "stdio",
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
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
      servers: {
        "codex-sse": {
          url: "http://localhost:8000/mcp",
          transport: "sse",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
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
      servers: {
        "codex-http": {
          url: "http://localhost:8000/api/mcp",
          transport: "http",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
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
      servers: {
        "local-codex": {
          command: "python",
          args: ["-m", "codex_mcp_server"],
          cwd: "/path/to/project",
          workingDirectory: "/path/to/project",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            PROJECT_ROOT: "/path/to/project",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
          transport: "stdio",
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
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
      servers: {
        "codex-local": {
          command: "codex_server",
          env: {
            OPENAI_API_KEY: "sk-local-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
          transport: "stdio",
        },
        "codex-remote": {
          url: "https://api.example.com/codex-mcp",
          transport: "sse",
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
    });
  });

  it("should handle servers with timeout", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-timeout": {
          command: "codex_server",
          timeout: 30000,
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      servers: {
        "codex-timeout": {
          command: "codex_server",
          timeout: 30000,
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o-mini",
          },
          transport: "stdio",
        },
      },
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
    });
  });

  it("should handle empty servers", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {},
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed).toEqual({
      servers: {},
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
    });
  });

  it("should handle servers with headers for HTTP transport", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-http-auth": {
          url: "https://api.example.com/mcp",
          transport: "http",
          headers: {
            Authorization: "Bearer token123",
            "X-API-Version": "v1",
          },
          env: {
            OPENAI_API_KEY: "sk-test-key",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.servers["codex-http-auth"]).toEqual({
      url: "https://api.example.com/mcp",
      transport: "http",
      headers: {
        Authorization: "Bearer token123",
        "X-API-Version": "v1",
      },
      env: {
        OPENAI_API_KEY: "sk-test-key",
        CODEX_DEFAULT_MODEL: "gpt-4o-mini",
      },
    });
  });

  it("should not add default model if already specified", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-custom-model": {
          command: "codex_server",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_DEFAULT_MODEL: "gpt-4o",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.servers["codex-custom-model"].env.CODEX_DEFAULT_MODEL).toBe("gpt-4o");
  });

  it("should add default model when env exists but model is missing", () => {
    const config: RulesyncMcpConfig = {
      mcpServers: {
        "codex-no-model": {
          command: "codex_server",
          env: {
            OPENAI_API_KEY: "sk-test-key",
            CODEX_APPROVAL_MODE: "suggest",
          },
        },
      },
    };

    const result = generateCodexMcp(config);
    const parsed = JSON.parse(result);

    expect(parsed.servers["codex-no-model"].env).toEqual({
      OPENAI_API_KEY: "sk-test-key",
      CODEX_APPROVAL_MODE: "suggest",
      CODEX_DEFAULT_MODEL: "gpt-4o-mini",
    });
  });
});
