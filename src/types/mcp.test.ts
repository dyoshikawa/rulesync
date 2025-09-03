import { describe, expect, it } from "vitest";
import {
  McpConfigSchema,
  McpServerBaseSchema,
  McpTransportTypeSchema,
  RulesyncMcpConfigSchema,
  RulesyncMcpServerSchema,
} from "./mcp.js";

describe("MCP types", () => {
  describe("McpTransportTypeSchema", () => {
    it("should validate valid transport types", () => {
      expect(() => McpTransportTypeSchema.parse("stdio")).not.toThrow();
      expect(() => McpTransportTypeSchema.parse("sse")).not.toThrow();
      expect(() => McpTransportTypeSchema.parse("http")).not.toThrow();
    });

    it("should reject invalid transport types", () => {
      expect(() => McpTransportTypeSchema.parse("invalid")).toThrow();
      expect(() => McpTransportTypeSchema.parse("tcp")).toThrow();
      expect(() => McpTransportTypeSchema.parse("")).toThrow();
      expect(() => McpTransportTypeSchema.parse(null)).toThrow();
      expect(() => McpTransportTypeSchema.parse(123)).toThrow();
    });
  });

  describe("McpServerBaseSchema", () => {
    it("should validate minimal server config", () => {
      expect(() => McpServerBaseSchema.parse({})).not.toThrow();

      const minimal = McpServerBaseSchema.parse({});
      expect(minimal).toEqual({});
    });

    it("should validate server config with command", () => {
      const config = {
        command: "node",
        args: ["server.js", "--port", "3000"],
      };

      expect(() => McpServerBaseSchema.parse(config)).not.toThrow();

      const parsed = McpServerBaseSchema.parse(config);
      expect(parsed.command).toBe("node");
      expect(parsed.args).toEqual(["server.js", "--port", "3000"]);
    });

    it("should validate server config with array command", () => {
      const config = {
        command: ["node", "server.js"],
        args: ["--port", "3000"],
      };

      expect(() => McpServerBaseSchema.parse(config)).not.toThrow();
    });

    it("should validate server config with URL", () => {
      const config = {
        type: "http" as const,
        url: "https://api.example.com/mcp",
        httpUrl: "https://api.example.com",
      };

      expect(() => McpServerBaseSchema.parse(config)).not.toThrow();

      const parsed = McpServerBaseSchema.parse(config);
      expect(parsed.type).toBe("http");
      expect(parsed.url).toBe("https://api.example.com/mcp");
      expect(parsed.httpUrl).toBe("https://api.example.com");
    });

    it("should validate server config with environment variables", () => {
      const config = {
        command: "python",
        args: ["server.py"],
        env: {
          API_KEY: "secret-key",
          DEBUG: "true",
        },
      };

      expect(() => McpServerBaseSchema.parse(config)).not.toThrow();

      const parsed = McpServerBaseSchema.parse(config);
      expect(parsed.env).toEqual({
        API_KEY: "secret-key",
        DEBUG: "true",
      });
    });

    it("should validate server config with all optional fields", () => {
      const config = {
        type: "stdio" as const,
        command: "node",
        args: ["server.js"],
        url: "https://example.com",
        httpUrl: "https://example.com/http",
        env: { NODE_ENV: "production" },
        disabled: false,
        networkTimeout: 5000,
        timeout: 3000,
        trust: true,
        cwd: "/app",
        transport: "stdio" as const,
        alwaysAllow: ["tool1", "tool2"],
        tools: ["calculator", "weather"],
        kiroAutoApprove: ["safe-action"],
        kiroAutoBlock: ["dangerous-action"],
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      };

      expect(() => McpServerBaseSchema.parse(config)).not.toThrow();

      const parsed = McpServerBaseSchema.parse(config);
      expect(parsed.type).toBe("stdio");
      expect(parsed.disabled).toBe(false);
      expect(parsed.networkTimeout).toBe(5000);
      expect(parsed.trust).toBe(true);
      expect(parsed.alwaysAllow).toEqual(["tool1", "tool2"]);
      expect(parsed.kiroAutoApprove).toEqual(["safe-action"]);
      expect(parsed.headers).toEqual({
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      });
    });

    it("should reject invalid field types", () => {
      expect(() => McpServerBaseSchema.parse({ type: "invalid" })).toThrow();
      expect(() => McpServerBaseSchema.parse({ command: 123 })).toThrow();
      expect(() => McpServerBaseSchema.parse({ args: "not-array" })).toThrow();
      expect(() => McpServerBaseSchema.parse({ disabled: "not-boolean" })).toThrow();
      expect(() => McpServerBaseSchema.parse({ networkTimeout: "not-number" })).toThrow();
      expect(() => McpServerBaseSchema.parse({ env: "not-object" })).toThrow();
      expect(() => McpServerBaseSchema.parse({ alwaysAllow: "not-array" })).toThrow();
    });
  });

  describe("RulesyncMcpServerSchema", () => {
    it("should extend McpServerBaseSchema with targets", () => {
      const config = {
        command: "node",
        args: ["server.js"],
        targets: ["cursor", "claudecode"],
      };

      expect(() => RulesyncMcpServerSchema.parse(config)).not.toThrow();

      const parsed = RulesyncMcpServerSchema.parse(config);
      expect(parsed.command).toBe("node");
      expect(parsed.targets).toEqual(["cursor", "claudecode"]);
    });

    it("should validate targets with wildcard", () => {
      const config = {
        command: "python",
        args: ["server.py"],
        targets: ["*"],
      };

      expect(() => RulesyncMcpServerSchema.parse(config)).not.toThrow();
    });

    it("should work without targets field", () => {
      const config = {
        command: "node",
        args: ["server.js"],
      };

      expect(() => RulesyncMcpServerSchema.parse(config)).not.toThrow();

      const parsed = RulesyncMcpServerSchema.parse(config);
      expect(parsed.targets).toBeUndefined();
    });

    it("should inherit all base schema validations", () => {
      const config = {
        type: "http" as const,
        url: "https://api.example.com",
        targets: ["cursor"],
        disabled: true,
        trust: false,
      };

      expect(() => RulesyncMcpServerSchema.parse(config)).not.toThrow();

      const parsed = RulesyncMcpServerSchema.parse(config);
      expect(parsed.type).toBe("http");
      expect(parsed.disabled).toBe(true);
      expect(parsed.targets).toEqual(["cursor"]);
    });
  });

  describe("McpConfigSchema", () => {
    it("should validate MCP configuration with servers", () => {
      const config = {
        mcpServers: {
          "weather-server": {
            command: "python",
            args: ["weather.py"],
          },
          calculator: {
            command: "node",
            args: ["calc.js"],
            disabled: false,
          },
        },
      };

      expect(() => McpConfigSchema.parse(config)).not.toThrow();

      const parsed = McpConfigSchema.parse(config);
      expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
      expect(parsed.mcpServers["weather-server"]?.command).toBe("python");
    });

    it("should validate empty server configuration", () => {
      const config = {
        mcpServers: {},
      };

      expect(() => McpConfigSchema.parse(config)).not.toThrow();
    });

    it("should reject invalid structure", () => {
      expect(() => McpConfigSchema.parse({})).toThrow(); // Missing mcpServers
      expect(() => McpConfigSchema.parse({ mcpServers: "not-object" })).toThrow();
      expect(() =>
        McpConfigSchema.parse({
          mcpServers: {
            "invalid-server": "not-object",
          },
        }),
      ).toThrow();
    });
  });

  describe("RulesyncMcpConfigSchema", () => {
    it("should validate rulesync MCP configuration", () => {
      const config = {
        mcpServers: {
          "weather-server": {
            command: "python",
            args: ["weather.py"],
            targets: ["cursor", "claudecode"],
          },
          "global-server": {
            command: "node",
            args: ["global.js"],
            targets: ["*"],
          },
        },
      };

      expect(() => RulesyncMcpConfigSchema.parse(config)).not.toThrow();

      const parsed = RulesyncMcpConfigSchema.parse(config);
      expect(parsed.mcpServers["weather-server"]?.targets).toEqual(["cursor", "claudecode"]);
      expect(parsed.mcpServers["global-server"]?.targets).toEqual(["*"]);
    });

    it("should work with servers without targets", () => {
      const config = {
        mcpServers: {
          "simple-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      expect(() => RulesyncMcpConfigSchema.parse(config)).not.toThrow();
    });

    it("should validate complex server configurations", () => {
      const config = {
        mcpServers: {
          "complex-server": {
            type: "http" as const,
            httpUrl: "https://api.example.com",
            targets: ["cursor"],
            env: {
              API_KEY: "secret",
            },
            headers: {
              Authorization: "Bearer token",
            },
            disabled: false,
            trust: true,
            alwaysAllow: ["read"],
            tools: ["weather", "calendar"],
          },
        },
      };

      expect(() => RulesyncMcpConfigSchema.parse(config)).not.toThrow();
    });
  });

  describe("type inference", () => {
    it("should infer correct types", () => {
      const transportType = McpTransportTypeSchema.parse("stdio");
      const _typeTest1: "stdio" | "sse" | "http" = transportType;

      const serverConfig = McpServerBaseSchema.parse({
        command: "node",
        args: ["server.js"],
      });
      const _typeTest2: string | string[] | undefined = serverConfig.command;
      const _typeTest3: string[] | undefined = serverConfig.args;

      const mcpConfig = McpConfigSchema.parse({
        mcpServers: {
          test: { command: "test" },
        },
      });
      const _typeTest4: Record<string, any> = mcpConfig.mcpServers;

      expect(_typeTest1).toBeDefined();
      expect(_typeTest2).toBeDefined();
      expect(_typeTest3).toBeDefined();
      expect(_typeTest4).toBeDefined();
    });
  });
});
