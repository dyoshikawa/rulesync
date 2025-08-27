import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { McpServerBase } from "../types/mcp.js";
import { OpencodeMcp } from "./opencode-mcp.js";

interface TestMcpServer extends McpServerBase {
  name: string;
}

describe("OpencodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let opencodeMcp: OpencodeMcp;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    opencodeMcp = new OpencodeMcp({
      baseDir: testDir,
      relativeDirPath: ".",
      relativeFilePath: "opencode.json",
      fileContent: "",
      validate: false,
    });
    opencodeMcp.mcpServers = [];
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("basic configuration", () => {
    it("should have correct tool name", () => {
      expect(opencodeMcp.toolName).toBe("OpenCode");
    });

    it("should use correct filename", () => {
      expect(opencodeMcp.getFileName()).toBe("opencode.json");
    });

    it("should generate empty configuration with schema when no servers", async () => {
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config).toEqual({
        $schema: "https://opencode.ai/config.json",
        mcp: {},
      });
    });
  });

  describe("local server configuration", () => {
    it("should configure basic local STDIO server", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "filesystem",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp).toEqual({
        filesystem: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          enabled: true,
        },
      });
    });

    it("should configure local server with environment variables", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "github",
          command: "python",
          args: ["-m", "github_mcp_server"],
          env: {
            GITHUB_TOKEN: "${env:GITHUB_TOKEN}",
            API_KEY: "${env:GITHUB_API_KEY}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp.github).toEqual({
        type: "local",
        command: ["python", "-m", "github_mcp_server"],
        enabled: true,
        environment: {
          GITHUB_TOKEN: "${GITHUB_TOKEN}",
          API_KEY: "${GITHUB_API_KEY}",
        },
      });
    });

    it("should configure local server with working directory", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "custom-server",
          command: "node",
          args: ["server.js"],
          cwd: "/path/to/server",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["custom-server"]).toEqual({
        type: "local",
        command: ["node", "server.js"],
        enabled: true,
        cwd: "/path/to/server",
      });
    });

    it("should handle command without arguments", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "simple-server",
          command: "my-mcp-server",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["simple-server"]).toEqual({
        type: "local",
        command: ["my-mcp-server"],
        enabled: true,
      });
    });
  });

  describe("remote server configuration", () => {
    it("should configure basic remote server", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "external-api",
          url: "https://api.example.com/mcp",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["external-api"]).toEqual({
        type: "remote",
        url: "https://api.example.com/mcp",
        enabled: true,
      });
    });

    it("should configure remote server with authentication headers", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "api-server",
          url: "https://api.company.com/mcp",
          env: {
            API_TOKEN: "${env:COMPANY_API_TOKEN}",
            CUSTOM_VAR: "${env:CUSTOM_SETTING}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["api-server"]).toEqual({
        type: "remote",
        url: "https://api.company.com/mcp",
        enabled: true,
        headers: {
          Authorization: "Bearer ${COMPANY_API_TOKEN}",
          "X-CUSTOM-VAR": "${CUSTOM_SETTING}",
        },
      });
    });

    it("should handle multiple authentication variables", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "multi-auth",
          url: "https://secure.example.com/mcp",
          env: {
            ACCESS_TOKEN: "${env:ACCESS_TOKEN}",
            API_KEY: "${env:SECRET_KEY}",
            USER_ID: "${env:USER_ID}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["multi-auth"].headers).toEqual({
        Authorization: "Bearer ${ACCESS_TOKEN}",
        "X-API-KEY": "${SECRET_KEY}",
        "X-USER-ID": "${USER_ID}",
      });
    });
  });

  describe("mixed server configurations", () => {
    it("should configure multiple servers of different types", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "local-fs",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
        {
          name: "remote-api",
          url: "https://api.example.com/mcp",
          env: {
            API_TOKEN: "${env:API_TOKEN}",
          },
        },
        {
          name: "python-tools",
          command: "python",
          args: ["-m", "my_tools"],
          env: {
            DATABASE_URL: "${env:DATABASE_URL}",
          },
          cwd: "/workspace/tools",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp).toEqual({
        "local-fs": {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          enabled: true,
        },
        "remote-api": {
          type: "remote",
          url: "https://api.example.com/mcp",
          enabled: true,
          headers: {
            Authorization: "Bearer ${API_TOKEN}",
          },
        },
        "python-tools": {
          type: "local",
          command: ["python", "-m", "my_tools"],
          enabled: true,
          environment: {
            DATABASE_URL: "${DATABASE_URL}",
          },
          cwd: "/workspace/tools",
        },
      });
    });
  });

  describe("environment variable formatting", () => {
    it("should convert ${env:VAR} to ${VAR} format", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "test-server",
          command: "node",
          env: {
            API_KEY: "${env:MY_API_KEY}",
            DATABASE_URL: "${env:DB_URL}",
            SIMPLE_VAR: "plain-value",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["test-server"].environment).toEqual({
        API_KEY: "${MY_API_KEY}",
        DATABASE_URL: "${DB_URL}",
        SIMPLE_VAR: "plain-value",
      });
    });

    it("should handle complex environment variable patterns", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "complex-env",
          command: "python",
          env: {
            MIXED_VAR: "prefix-${env:DYNAMIC_PART}-suffix",
            NESTED: "${env:OUTER}_${env:INNER}",
            NORMAL: "static-value",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["complex-env"].environment).toEqual({
        MIXED_VAR: "prefix-${DYNAMIC_PART}-suffix",
        NESTED: "${OUTER}_${INNER}",
        NORMAL: "static-value",
      });
    });
  });

  describe("authentication header generation", () => {
    it("should generate Authorization header for common auth variables", async () => {
      const authVariables = ["TOKEN", "API_KEY", "KEY", "AUTH_TOKEN"];

      for (const varName of authVariables) {
        const servers: TestMcpServer[] = [
          {
            name: "auth-test",
            url: "https://api.example.com/mcp",
            env: {
              [varName]: `\${env:${varName}}`,
            },
          },
        ];

        opencodeMcp.mcpServers = servers;
        const content = await opencodeMcp.generateContent();
        const config = JSON.parse(content);

        expect(config.mcp["auth-test"].headers).toHaveProperty("Authorization");
        expect(config.mcp["auth-test"].headers.Authorization).toBe(`Bearer \${${varName}}`);
      }
    });

    it("should handle non-auth variables as custom headers", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "custom-headers",
          url: "https://api.example.com/mcp",
          env: {
            USER_ID: "${env:USER_ID}",
            CLIENT_VERSION: "${env:CLIENT_VERSION}",
            API_TOKEN: "${env:API_TOKEN}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["custom-headers"].headers).toEqual({
        Authorization: "Bearer ${API_TOKEN}",
        "X-USER-ID": "${USER_ID}",
        "X-CLIENT-VERSION": "${CLIENT_VERSION}",
      });
    });
  });

  describe("Docker server configurations", () => {
    it("should handle Docker-based MCP servers", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "docker-server",
          command: "docker",
          args: [
            "run",
            "-i",
            "--rm",
            "-e",
            "API_KEY",
            "-v",
            "${PWD}:/workspace",
            "my-mcp-server:latest",
          ],
          env: {
            API_KEY: "${env:DOCKER_API_KEY}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["docker-server"]).toEqual({
        type: "local",
        command: [
          "docker",
          "run",
          "-i",
          "--rm",
          "-e",
          "API_KEY",
          "-v",
          "${PWD}:/workspace",
          "my-mcp-server:latest",
        ],
        enabled: true,
        environment: {
          API_KEY: "${DOCKER_API_KEY}",
        },
      });
    });
  });

  describe("validation", () => {
    it("should validate successfully with required properties", () => {
      const result = opencodeMcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation when baseDir is not set", () => {
      const invalidMcp = new OpencodeMcp({
        baseDir: "",
        relativeDirPath: "",
        relativeFilePath: "",
        fileContent: "",
        validate: false,
      });

      const result = invalidMcp.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("relativeDirPath is required");
    });
  });

  describe("real-world configuration examples", () => {
    it("should generate configuration for GitHub server", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "github",
          command: "docker",
          args: [
            "run",
            "-i",
            "--rm",
            "-e",
            "GITHUB_PERSONAL_ACCESS_TOKEN",
            "ghcr.io/github/github-mcp-server",
          ],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp.github).toEqual({
        type: "local",
        command: [
          "docker",
          "run",
          "-i",
          "--rm",
          "-e",
          "GITHUB_PERSONAL_ACCESS_TOKEN",
          "ghcr.io/github/github-mcp-server",
        ],
        enabled: true,
        environment: {
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
        },
      });
    });

    it("should generate configuration for PostgreSQL server", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "postgres",
          command: "python",
          args: ["-m", "company.pg_mcp", "--dsn", "postgres://..."],
          env: {
            PG_SSL_ROOT_CERT: "${env:PG_SSL_ROOT_CERT}",
            PGPASSWORD: "${env:PGPASSWORD}",
          },
          cwd: "/workspace/db-tools",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp.postgres).toEqual({
        type: "local",
        command: ["python", "-m", "company.pg_mcp", "--dsn", "postgres://..."],
        enabled: true,
        environment: {
          PG_SSL_ROOT_CERT: "${PG_SSL_ROOT_CERT}",
          PGPASSWORD: "${PGPASSWORD}",
        },
        cwd: "/workspace/db-tools",
      });
    });

    it("should generate configuration for remote Sentry server", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "sentry-prod",
          url: "https://mcp.sentry.io",
          env: {
            SENTRY_MCP_TOKEN: "${env:SENTRY_MCP_TOKEN}",
            SENTRY_ORG: "${env:SENTRY_ORG}",
          },
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["sentry-prod"]).toEqual({
        type: "remote",
        url: "https://mcp.sentry.io",
        enabled: true,
        headers: {
          Authorization: "Bearer ${SENTRY_MCP_TOKEN}",
          "X-SENTRY-ORG": "${SENTRY_ORG}",
        },
      });
    });
  });

  describe("edge cases", () => {
    it("should handle server with empty args array", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "no-args",
          command: "server",
          args: [],
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["no-args"]).toEqual({
        type: "local",
        command: ["server"],
        enabled: true,
      });
    });

    it("should handle server with empty env object", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "no-env",
          command: "server",
          env: {},
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp["no-env"]).toEqual({
        type: "local",
        command: ["server"],
        enabled: true,
      });
    });

    it("should handle special characters in server names", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "special-chars_server.v2",
          command: "node",
          args: ["server.js"],
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();
      const config = JSON.parse(content);

      expect(config.mcp).toHaveProperty("special-chars_server.v2");
    });
  });

  describe("JSON serialization", () => {
    it("should produce valid JSON", async () => {
      const servers: TestMcpServer[] = [
        {
          name: "test",
          command: "test-server",
        },
      ];

      opencodeMcp.mcpServers = servers;
      const content = await opencodeMcp.generateContent();

      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("should format JSON with proper indentation", async () => {
      opencodeMcp.mcpServers = [];
      const content = await opencodeMcp.generateContent();

      // Check that JSON is formatted with 2-space indentation
      expect(content).toContain('{\n  "$schema"');
      expect(content).toContain('  "mcp": {}');
    });
  });
});
