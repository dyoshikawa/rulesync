import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("RooMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const rooMcp = new RooMcp({
        outputRoot: "/custom/path",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getOutputRoot()).toBe("/custom/path");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with validation enabled", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with validation disabled", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file with default parameters", async () => {
      const rooDir = join(testDir, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent, null, 2));

      const rooMcp = await RooMcp.fromFile({
        outputRoot: testDir,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getOutputRoot()).toBe(testDir);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from existing file with validation disabled", async () => {
      const rooDir = join(testDir, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["-m", "server.main"],
          },
        },
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent, null, 2));

      const rooMcp = await RooMcp.fromFile({
        outputRoot: testDir,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getOutputRoot()).toBe(testDir);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        RooMcp.fromFile({
          outputRoot: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should create instance with custom outputRoot parameter", async () => {
      const customOutputRoot = join(testDir, "custom");
      const rooDir = join(customOutputRoot, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {},
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent));

      const rooMcp = await RooMcp.fromFile({
        outputRoot: customOutputRoot,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp with default parameters", () => {
      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getOutputRoot()).toBe(testDir);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with custom outputRoot", () => {
      const mcpContent = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["-m", "server.main"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        outputRoot: "/custom/base",
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getOutputRoot()).toBe("/custom/base");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with validation enabled", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with validation disabled", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
        validate: false,
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should handle empty mcpServers object", () => {
      const mcpContent = {
        mcpServers: {},
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should convert http type to streamable-http", () => {
      const mcpContent = {
        mcpServers: {
          "http-server": {
            type: "http",
            url: "http://localhost:8080",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      const result = JSON.parse(rooMcp.getFileContent());
      expect(result.mcpServers["http-server"].type).toBe("streamable-http");
      expect(result.mcpServers["http-server"].url).toBe("http://localhost:8080");
    });

    it("should convert http transport to streamable-http", () => {
      const mcpContent = {
        mcpServers: {
          "http-server": {
            transport: "http",
            url: "http://localhost:8080",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      const result = JSON.parse(rooMcp.getFileContent());
      expect(result.mcpServers["http-server"].transport).toBe("streamable-http");
    });

    it("should not convert stdio or sse types", () => {
      const mcpContent = {
        mcpServers: {
          "stdio-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
          "sse-server": {
            type: "sse",
            url: "http://localhost:8080/sse",
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      const result = JSON.parse(rooMcp.getFileContent());
      expect(result.mcpServers["stdio-server"].type).toBe("stdio");
      expect(result.mcpServers["sse-server"].type).toBe("sse");
    });
  });

  describe("fromRulesyncMcp oauth", () => {
    const generate = (mcpServers: Record<string, unknown>) => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers }),
      });
      return JSON.parse(RooMcp.fromRulesyncMcp({ rulesyncMcp }).getFileContent()).mcpServers;
    };

    it("should map callbackPort to a loopback redirectUri on an http server", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", scope: "read", callbackPort: 8080 },
        },
      });

      expect(servers.remote.oauth).toEqual({
        clientId: "abc",
        scope: "read",
        redirectUri: "http://127.0.0.1:8080/callback",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should keep an explicit redirectUri and resource", () => {
      const servers = generate({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: {
            clientId: "abc",
            callbackPort: 8080,
            redirectUri: "http://localhost:9000/callback",
            resource: false,
          },
        },
      });

      expect(servers.remote.oauth).toEqual({
        clientId: "abc",
        redirectUri: "http://localhost:9000/callback",
        resource: false,
      });
    });

    it("should drop oauth keys Zoo Code does not read, with a warning", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", authServerMetadataUrl: "https://auth.example.com/meta" },
        },
      });

      expect(servers.remote.oauth).toEqual({ clientId: "abc" });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("oauth.authServerMetadataUrl"));
    });

    it("should drop a redirectUri or resource that is not a URL, with a warning", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", redirectUri: "not a url", resource: "my-api" },
        },
      });

      expect(servers.remote.oauth).toEqual({ clientId: "abc" });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("oauth.redirectUri"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("oauth.resource"));
    });

    it('should keep resource "auto" and a URL resource', () => {
      const servers = generate({
        auto: {
          type: "http",
          url: "https://a.example.com/mcp",
          oauth: { clientId: "a", resource: "auto" },
        },
        url: {
          type: "http",
          url: "https://b.example.com/mcp",
          oauth: { clientId: "b", resource: "https://b.example.com" },
        },
      });

      expect(servers.auto.oauth).toEqual({ clientId: "a", resource: "auto" });
      expect(servers.url.oauth).toEqual({ clientId: "b", resource: "https://b.example.com" });
    });

    it("should join a canonical scopes list into scope unless scope is set", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        joined: {
          type: "http",
          url: "https://a.example.com/mcp",
          oauth: { clientId: "a", scopes: ["read", "write"] },
        },
        explicit: {
          type: "http",
          url: "https://b.example.com/mcp",
          oauth: { clientId: "b", scope: "admin", scopes: ["read"] },
        },
      });

      expect(servers.joined.oauth).toEqual({ clientId: "a", scope: "read write" });
      expect(servers.explicit.oauth).toEqual({ clientId: "b", scope: "admin" });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should drop the oauth block when clientId is missing", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { callbackPort: 8080 },
        },
      });

      expect(servers.remote).not.toHaveProperty("oauth");
      expect(servers.remote.type).toBe("streamable-http");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("oauth.clientId"));
    });

    it("should drop oauth from stdio, sse and untyped url servers", () => {
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
      const servers = generate({
        local: { command: "node", args: ["server.js"], oauth: { clientId: "abc" } },
        events: { type: "sse", url: "https://example.com/sse", oauth: { clientId: "abc" } },
        transportOnly: {
          transport: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc" },
        },
      });

      expect(servers.local).not.toHaveProperty("oauth");
      expect(servers.events).not.toHaveProperty("oauth");
      expect(servers.transportOnly).not.toHaveProperty("oauth");
      expect(warnSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe("toRulesyncMcp oauth", () => {
    const importServers = (mcpServers: Record<string, unknown>) => {
      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers }),
      });
      return JSON.parse(rooMcp.toRulesyncMcp().getFileContent()).mcpServers;
    };

    it("should map a loopback /callback redirectUri back to callbackPort", () => {
      const servers = importServers({
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", redirectUri: "http://127.0.0.1:8080/callback" },
        },
      });

      expect(servers.remote.oauth).toEqual({ clientId: "abc", callbackPort: 8080 });
    });

    it("should keep any other redirectUri as written", () => {
      const servers = importServers({
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", redirectUri: "http://127.0.0.1:8080/auth", resource: "auto" },
        },
      });

      expect(servers.remote.oauth).toEqual({
        clientId: "abc",
        redirectUri: "http://127.0.0.1:8080/auth",
        resource: "auto",
      });
    });

    it("should keep a localhost redirectUri as written", () => {
      const servers = importServers({
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          oauth: { clientId: "abc", redirectUri: "http://localhost:8080/callback" },
        },
      });

      expect(servers.remote.oauth).toEqual({
        clientId: "abc",
        redirectUri: "http://localhost:8080/callback",
      });
    });

    it("should round-trip callbackPort through generate and import", () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              oauth: { clientId: "abc", callbackPort: 8080 },
            },
          },
        }),
      });
      const rooMcp = RooMcp.fromRulesyncMcp({ rulesyncMcp });
      const reimported = JSON.parse(rooMcp.toRulesyncMcp().getFileContent());

      expect(reimported.mcpServers.remote).toEqual({
        type: "http",
        url: "https://example.com/mcp",
        oauth: { clientId: "abc", callbackPort: 8080 },
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp", () => {
      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      const rooMcp = new RooMcp({
        outputRoot: "/test/path",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getOutputRoot()).toBe("/test/path");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...mcpContent,
      });
    });

    it("should preserve content when converting to RulesyncMcp", () => {
      const complexMcpContent = {
        mcpServers: {
          "server-1": {
            command: "node",
            args: ["server1.js"],
            env: {
              NODE_ENV: "production",
            },
          },
          "server-2": {
            command: "python",
            args: ["-m", "server2.main"],
            cwd: "/path/to/server2",
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexMcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...complexMcpContent,
      });
    });

    it("should convert streamable-http type to http", () => {
      const rooMcpContent = {
        mcpServers: {
          "http-server": {
            type: "streamable-http",
            url: "http://localhost:8080",
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(rooMcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      const result = JSON.parse(rulesyncMcp.getFileContent());
      expect(result.mcpServers["http-server"].type).toBe("http");
      expect(result.mcpServers["http-server"].url).toBe("http://localhost:8080");
    });

    it("should convert streamable-http transport to http", () => {
      const rooMcpContent = {
        mcpServers: {
          "http-server": {
            transport: "streamable-http",
            url: "http://localhost:8080",
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(rooMcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      const result = JSON.parse(rulesyncMcp.getFileContent());
      expect(result.mcpServers["http-server"].transport).toBe("http");
    });

    it("should not convert stdio or sse types when importing", () => {
      const rooMcpContent = {
        mcpServers: {
          "stdio-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
          "sse-server": {
            type: "sse",
            url: "http://localhost:8080/sse",
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(rooMcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      const result = JSON.parse(rulesyncMcp.getFileContent());
      expect(result.mcpServers["stdio-server"].type).toBe("stdio");
      expect(result.mcpServers["sse-server"].type).toBe("sse");
    });

    it("should round-trip http type correctly", () => {
      const originalContent = {
        mcpServers: {
          "http-server": {
            type: "http",
            url: "http://localhost:8080",
          },
          "stdio-server": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(originalContent),
      });

      // Convert to Roo format
      const rooMcp = RooMcp.fromRulesyncMcp({ rulesyncMcp });
      const rooResult = JSON.parse(rooMcp.getFileContent());
      expect(rooResult.mcpServers["http-server"].type).toBe("streamable-http");

      // Convert back to Rulesync format
      const backToRulesync = rooMcp.toRulesyncMcp();
      const finalResult = JSON.parse(backToRulesync.getFileContent());
      expect(finalResult.mcpServers["http-server"].type).toBe("http");
      expect(finalResult.mcpServers["stdio-server"].type).toBe("stdio");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });

    it("should return success with minimal valid JSON", () => {
      const minimalContent = JSON.stringify({ mcpServers: {} });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: minimalContent,
        validate: false,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });

    it("should return success with complex configuration", () => {
      const complexContent = JSON.stringify({
        mcpServers: {
          "server-1": {
            command: "node",
            args: ["server1.js"],
            env: { NODE_ENV: "production" },
          },
          "server-2": {
            command: "python",
            args: ["-m", "server2.main"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: complexContent,
        validate: false,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });
  });

  describe("inherited methods from ToolMcp", () => {
    it("should have access to getJson method", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const json = rooMcp.getJson();
      expect(json).toEqual(mcpContent);
    });

    it("should have access to base directory methods", () => {
      const rooMcp = new RooMcp({
        outputRoot: "/test/base",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(rooMcp.getOutputRoot()).toBe("/test/base");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should have access to file content methods", () => {
      const content = JSON.stringify({ mcpServers: {} });
      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      expect(rooMcp.getFileContent()).toBe(content);
    });
  });
});
