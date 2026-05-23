import { describe, expect, it } from "vitest";

import { McpServers } from "../../types/mcp.js";
import {
  convertEnvVarRefsFromToolFormat,
  convertEnvVarRefsToToolFormat,
} from "./mcp-env-var-format.js";

const TOOL_PATTERN = /\{tool:([^}:]+)\}/g;

describe("mcp-env-var-format", () => {
  describe("convertEnvVarRefsFromToolFormat", () => {
    it("should convert tool-specific format to canonical ${VAR} in env values", () => {
      const mcpServers: McpServers = {
        server: {
          command: "node",
          env: {
            KEY: "{tool:API_KEY}",
            STATIC: "plain",
          },
        },
      };

      const result = convertEnvVarRefsFromToolFormat({ mcpServers, pattern: TOOL_PATTERN });

      expect(result["server"]?.env?.KEY).toBe("${API_KEY}");
      expect(result["server"]?.env?.STATIC).toBe("plain");
    });

    it("should convert tool-specific format to canonical ${VAR} in headers values", () => {
      const mcpServers: McpServers = {
        server: {
          type: "sse",
          url: "https://example.com",
          headers: {
            Authorization: "Bearer {tool:TOKEN}",
            "X-Static": "value",
          },
        },
      };

      const result = convertEnvVarRefsFromToolFormat({ mcpServers, pattern: TOOL_PATTERN });

      expect(result["server"]?.headers?.Authorization).toBe("Bearer ${TOKEN}");
      expect(result["server"]?.headers?.["X-Static"]).toBe("value");
    });

    it("should handle multiple env var refs in a single value", () => {
      const mcpServers: McpServers = {
        server: {
          command: "node",
          env: { URL: "https://{tool:HOST}:{tool:PORT}/api" },
        },
      };

      const result = convertEnvVarRefsFromToolFormat({ mcpServers, pattern: TOOL_PATTERN });

      expect(result["server"]?.env?.URL).toBe("https://${HOST}:${PORT}/api");
    });

    it("should leave servers without env or headers unchanged", () => {
      const mcpServers: McpServers = {
        server: { command: "node", args: ["index.js"] },
      };

      const result = convertEnvVarRefsFromToolFormat({ mcpServers, pattern: TOOL_PATTERN });

      expect(result["server"]?.env).toBeUndefined();
      expect(result["server"]?.headers).toBeUndefined();
      expect(result["server"]?.command).toBe("node");
    });

    it("should process multiple servers independently", () => {
      const mcpServers: McpServers = {
        a: { command: "a", env: { K: "{tool:A}" } },
        b: { command: "b", env: { K: "{tool:B}" } },
      };

      const result = convertEnvVarRefsFromToolFormat({ mcpServers, pattern: TOOL_PATTERN });

      expect(result["a"]?.env?.K).toBe("${A}");
      expect(result["b"]?.env?.K).toBe("${B}");
    });
  });

  describe("convertEnvVarRefsToToolFormat", () => {
    it("should convert canonical ${VAR} to tool-specific format in env values", () => {
      const mcpServers: McpServers = {
        server: {
          command: "node",
          env: {
            KEY: "${API_KEY}",
            STATIC: "plain",
          },
        },
      };

      const result = convertEnvVarRefsToToolFormat({ mcpServers, replacement: "{tool:$1}" });

      expect(result["server"]?.env?.KEY).toBe("{tool:API_KEY}");
      expect(result["server"]?.env?.STATIC).toBe("plain");
    });

    it("should convert canonical ${VAR} to tool-specific format in headers values", () => {
      const mcpServers: McpServers = {
        server: {
          type: "sse",
          url: "https://example.com",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      };

      const result = convertEnvVarRefsToToolFormat({ mcpServers, replacement: "{tool:$1}" });

      expect(result["server"]?.headers?.Authorization).toBe("Bearer {tool:TOKEN}");
    });

    it("should not double-convert values already in ${env:VAR} format", () => {
      const mcpServers: McpServers = {
        server: {
          command: "node",
          env: {
            ALREADY: "${env:CURSOR_STYLE}",
            CANONICAL: "${NORMAL}",
          },
        },
      };

      const result = convertEnvVarRefsToToolFormat({ mcpServers, replacement: "{tool:$1}" });

      expect(result["server"]?.env?.ALREADY).toBe("${env:CURSOR_STYLE}");
      expect(result["server"]?.env?.CANONICAL).toBe("{tool:NORMAL}");
    });

    it("should leave servers without env or headers unchanged", () => {
      const mcpServers: McpServers = {
        server: { command: "node" },
      };

      const result = convertEnvVarRefsToToolFormat({ mcpServers, replacement: "{tool:$1}" });

      expect(result["server"]?.env).toBeUndefined();
      expect(result["server"]?.headers).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    it("should preserve values through from-tool then to-tool cycle", () => {
      const original: McpServers = {
        server: {
          command: "node",
          env: { KEY: "${VAR}", STATIC: "plain" },
          headers: { Auth: "Bearer ${TOKEN}" },
        },
      };

      const toTool = convertEnvVarRefsToToolFormat({
        mcpServers: original,
        replacement: "{tool:$1}",
      });
      const backToCanonical = convertEnvVarRefsFromToolFormat({
        mcpServers: toTool,
        pattern: TOOL_PATTERN,
      });

      expect(backToCanonical["server"]?.env).toEqual(original["server"]?.env);
      expect(backToCanonical["server"]?.headers).toEqual(original["server"]?.headers);
    });
  });
});
