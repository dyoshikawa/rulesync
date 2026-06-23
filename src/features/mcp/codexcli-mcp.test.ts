import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("CodexcliMcp", () => {
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

  describe("getSettablePaths", () => {
    it("should return correct paths for local mode", () => {
      const paths = CodexcliMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".codex");
      expect(paths.relativeFilePath).toBe("config.toml");
    });

    it("should return correct paths for global mode", () => {
      const paths = CodexcliMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".codex");
      expect(paths.relativeFilePath).toBe("config.toml");
    });
  });

  describe("constructor", () => {
    it("should create instance with valid TOML content", () => {
      const validTomlContent = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@anthropic-ai/mcp-server-filesystem", "/workspace"]
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: validTomlContent,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getRelativeDirPath()).toBe(".codex");
      expect(codexcliMcp.getRelativeFilePath()).toBe("config.toml");
      expect(codexcliMcp.getFileContent()).toBe(validTomlContent);
    });

    it("should create instance with custom outputRoot", () => {
      const validTomlContent = `[mcpServers]
`;

      const codexcliMcp = new CodexcliMcp({
        outputRoot: "/custom/path",
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: validTomlContent,
      });

      expect(codexcliMcp.getFilePath()).toBe("/custom/path/.codex/config.toml");
    });

    it("should parse TOML content correctly", () => {
      const tomlContent = `[mcpServers."test-server"]
command = "node"
args = ["server.js"]

[mcpServers."test-server".env]
NODE_ENV = "development"
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const json = codexcliMcp.getToml();
      expect(json.mcpServers).toBeDefined();
      expect((json.mcpServers as any)["test-server"]).toEqual({
        command: "node",
        args: ["server.js"],
        env: {
          NODE_ENV: "development",
        },
      });
    });

    it("should handle empty TOML object", () => {
      const emptyTomlContent = "";

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: emptyTomlContent,
      });

      expect(codexcliMcp.getToml()).toEqual({});
    });

    it("should validate content by default", () => {
      const validTomlContent = `[mcpServers]
`;

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: validTomlContent,
        });
      }).not.toThrow();
    });

    it("should skip validation when validate is false", () => {
      const validTomlContent = `[mcpServers]
`;

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: validTomlContent,
          validate: false,
        });
      }).not.toThrow();
    });

    it("should throw error for invalid TOML content", () => {
      const invalidTomlContent = "[invalid toml\nkey = ";

      expect(() => {
        const _instance = new CodexcliMcp({
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: invalidTomlContent,
        });
      }).toThrow();
    });

    it("should preserve existing TOML content structure", () => {
      const tomlWithComments = `# Codex configuration
[general]
theme = "dark"

# MCP Servers
[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlWithComments,
      });

      const json = codexcliMcp.getToml();
      expect((json as any).general).toEqual({ theme: "dark" });
      expect((json.mcpServers as any)?.filesystem).toBeDefined();
    });
  });

  describe("fromFile", () => {
    it("should create instance from file in local mode", async () => {
      const tomlData = `[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "${testDir}"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: false,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect((codexcliMcp.getToml().mcp_servers as any)?.filesystem).toBeDefined();
      expect(codexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should create instance from file in global mode", async () => {
      const tomlData = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "${testDir}"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect((codexcliMcp.getToml().mcpServers as any)?.filesystem).toBeDefined();
      expect(codexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should create instance from file with custom outputRoot", async () => {
      const customDir = join(testDir, "custom");
      await ensureDir(join(customDir, ".codex"));

      const tomlData = `[mcpServers.git]
command = "node"
args = ["git-server.js"]
`;
      await writeFileContent(join(customDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: customDir,
        global: true,
      });

      expect(codexcliMcp.getFilePath()).toBe(join(customDir, ".codex/config.toml"));
      expect((codexcliMcp.getToml().mcpServers as any)?.git).toBeDefined();
    });

    it("should handle validation when validate is true", async () => {
      const tomlData = `[mcpServers."valid-server"]
command = "node"
args = ["server.js"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        validate: true,
        global: true,
      });

      expect((codexcliMcp.getToml().mcpServers as any)?.["valid-server"]).toBeDefined();
    });

    it("should skip validation when validate is false", async () => {
      const tomlData = `[mcpServers]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), tomlData);

      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });

      expect(codexcliMcp.getToml().mcpServers).toBeDefined();
    });

    it("should return empty instance if file does not exist", async () => {
      const codexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getToml()).toEqual({});
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp in local mode with new file", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
      expect(codexcliMcp.getRelativeDirPath()).toBe(".codex");
      expect(codexcliMcp.getRelativeFilePath()).toBe("config.toml");
    });

    it("should create instance from RulesyncMcp in global mode with new file", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp).toBeInstanceOf(CodexcliMcp);
      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
      expect(codexcliMcp.getRelativeDirPath()).toBe(".codex");
      expect(codexcliMcp.getRelativeFilePath()).toBe("config.toml");
    });

    it("should preserve existing TOML content when adding MCP servers", async () => {
      // Create existing config.toml with some content
      const existingToml = `[general]
theme = "dark"
language = "en"

[editor]
fontSize = 14
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), existingToml);

      const jsonData = {
        mcpServers: {
          "new-server": {
            command: "node",
            args: ["new-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = codexcliMcp.getToml();
      expect(json.general).toEqual({ theme: "dark", language: "en" });
      expect(json.editor).toEqual({ fontSize: 14 });
      expect(json.mcp_servers).toEqual(jsonData.mcpServers);
    });

    it("should preserve per-tool approval_mode decisions on regenerate (#1709)", async () => {
      // Codex's CLI writes nested `[mcp_servers.<server>.tools.<tool>]` tables
      // with `approval_mode` when the user approves an MCP tool. rulesync does
      // not model this, so a regenerate must not wipe these saved approvals.
      const existingToml = `[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]

[mcp_servers.playwright.tools.browser_navigate]
approval_mode = "approve"

[mcp_servers.playwright.tools.browser_click]
approval_mode = "approve"
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), existingToml);

      const jsonData = {
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["@playwright/mcp@latest"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const servers = codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>;
      // The rulesync-owned fields are present...
      expect(servers.playwright?.command).toBe("npx");
      expect(servers.playwright?.args).toEqual(["@playwright/mcp@latest"]);
      // ...and the user's saved per-tool approval decisions survive.
      expect(servers.playwright?.tools).toEqual({
        browser_navigate: { approval_mode: "approve" },
        browser_click: { approval_mode: "approve" },
      });
    });

    it("should create instance from RulesyncMcp with custom outputRoot", async () => {
      const jsonData = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["server.py"],
            env: {
              PYTHONPATH: "/custom/path",
            },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: "/custom/base",
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
    });

    it("should handle validation when validate is true", async () => {
      const jsonData = {
        mcpServers: {
          "validated-server": {
            command: "node",
            args: ["validated-server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: true,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
    });

    it("should skip validation when validate is false", async () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: false,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual({});
    });

    it("should handle empty mcpServers object", async () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual({});
    });

    // codex CLI rejects empty `[mcp_servers.X.env]` for remote transports
    // (sse / http / streamable_http) with: "env is not supported for
    // streamable_http". The recursive `removeEmptyEntries` strip handles all
    // three transport types uniformly.
    it.each(["sse", "http", "streamable_http"] as const)(
      "should strip empty env object from remote (%s) server and preserve other fields",
      async (transport) => {
        const jsonData = {
          mcpServers: {
            "aws-knowledge": {
              type: transport,
              url: "https://knowledge-mcp.global.api.aws",
              env: {},
            },
          },
        };
        const rulesyncMcp = new RulesyncMcp({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
          fileContent: JSON.stringify(jsonData),
        });

        const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp,
          global: true,
        });

        const server = (
          codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
        )?.["aws-knowledge"];
        expect(server).toBeDefined();
        expect(server!.env).toBeUndefined();
        // Defensive: assert non-env fields survive the strip.
        expect(server!.type).toBe(transport);
        expect(server!.url).toBe("https://knowledge-mcp.global.api.aws");
      },
    );

    it("should strip empty env object from stdio server and preserve other fields", async () => {
      const jsonData = {
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: {},
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (
        codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
      )?.["local"];
      expect(server).toBeDefined();
      expect(server!.env).toBeUndefined();
      // Defensive: assert non-env fields survive the strip.
      expect(server!.command).toBe("node");
      expect(server!.args).toEqual(["server.js"]);
    });

    it("should preserve populated env table on stdio server", async () => {
      const jsonData = {
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: { NODE_ENV: "production" },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (
        codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
      )?.["local"];
      expect(server).toBeDefined();
      expect(server!.env).toEqual({ NODE_ENV: "production" });
      // Defensive: command/args also survive.
      expect(server!.command).toBe("node");
      expect(server!.args).toEqual(["server.js"]);
    });

    it("should not emit .env] in serialized TOML for server with env: {}", async () => {
      // The actual failure mode is smol-toml emitting a `[mcp_servers.X.env]`
      // header that Codex CLI rejects. This test asserts directly on the
      // serialized TOML string to map to the Codex 0.130+ rejection condition.
      const jsonData = {
        mcpServers: {
          "aws-knowledge": {
            type: "streamable_http",
            url: "https://knowledge-mcp.global.api.aws",
            env: {},
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getFileContent()).not.toContain(".env]");
    });

    it("should preserve array elements verbatim even when they are empty objects", async () => {
      // Arrays are not recursed into by removeEmptyEntries. If an array
      // element is a plain object like `{}`, it survives unmodified so the
      // empty inline table is preserved in TOML output. This boundary is
      // intentional: the current mcp_servers.* schema is a map, not an
      // array, and an empty inline table in TOML (`[{}, "a"]`) differs from
      // a table header (`[mcp_servers.X.env]`) that Codex CLI rejects.
      const jsonData = {
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: [{}, { flag: "--verbose" }],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (
        codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
      )?.["local"];
      expect(server).toBeDefined();
      expect(server!.args).toEqual([{}, { flag: "--verbose" }]);
    });

    it("should strip prototype-pollution keys at server-name level on outbound conversion", async () => {
      // Use JSON string so that `__proto__` becomes an own enumerable
      // property rather than setting the prototype of the object literal.
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: `{
          "mcpServers": {
            "__proto__": { "command": "evil" },
            "constructor": { "command": "evil" },
            "prototype": { "command": "evil" },
            "ok": { "type": "stdio", "command": "node", "args": ["server.js"] }
          }
        }`,
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const servers = codexcliMcp.getToml().mcp_servers as Record<string, unknown>;
      expect(Object.hasOwn(servers, "__proto__")).toBe(false);
      expect(Object.hasOwn(servers, "constructor")).toBe(false);
      expect(Object.hasOwn(servers, "prototype")).toBe(false);
      expect(Object.hasOwn(servers, "ok")).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("should strip prototype-pollution keys at config-key level on outbound conversion", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: `{
          "mcpServers": {
            "local": {
              "type": "stdio",
              "command": "node",
              "args": ["server.js"],
              "__proto__": "x",
              "constructor": "x",
              "prototype": "x"
            }
          }
        }`,
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (
        codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
      )?.["local"];
      expect(server).toBeDefined();
      expect(Object.hasOwn(server!, "__proto__")).toBe(false);
      expect(Object.hasOwn(server!, "constructor")).toBe(false);
      expect(Object.hasOwn(server!, "prototype")).toBe(false);
      expect(server!.command).toBe("node");
    });

    it("should strip prototype-pollution keys in nested env via removeEmptyEntries", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: `{
          "mcpServers": {
            "local": {
              "type": "stdio",
              "command": "node",
              "args": ["server.js"],
              "env": { "__proto__": "x", "NODE_ENV": "production" }
            }
          }
        }`,
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (
        codexcliMcp.getToml().mcp_servers as Record<string, Record<string, unknown>>
      )?.["local"];
      expect(server).toBeDefined();
      const env = server!.env as Record<string, unknown>;
      expect(Object.hasOwn(env, "__proto__")).toBe(false);
      expect(env.NODE_ENV).toBe("production");
    });

    it("should strip prototype-pollution server-name keys on inbound conversion", () => {
      // smol-toml installs `__proto__` as an own enumerable data property
      // (via `Object.defineProperty`), so this round-trip exercises the
      // `PROTOTYPE_POLLUTION_KEYS.has(name)` guard in convertFromCodexFormat.
      const tomlContent = `[mcp_servers."__proto__"]
command = "evil"

[mcp_servers.ok]
command = "node"
args = ["server.js"]
`;

      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();
      const parsed = JSON.parse(rulesyncMcp.getFileContent()) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.hasOwn(parsed.mcpServers, "__proto__")).toBe(false);
      expect(Object.hasOwn(parsed.mcpServers, "ok")).toBe(true);
    });

    it("should convert disabled: true to enabled = false in codex format", async () => {
      const jsonData = {
        mcpServers: {
          "disabled-server": {
            command: "node",
            args: ["server.js"],
            disabled: true,
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["disabled-server"].enabled).toBe(false);
      expect(mcpServers["disabled-server"].disabled).toBeUndefined();
    });

    it("should convert enabledTools to enabled_tools in codex format", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            enabledTools: ["search", "list"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["my-server"].enabled_tools).toEqual(["search", "list"]);
      expect(mcpServers["my-server"].enabledTools).toBeUndefined();
    });

    it("should convert disabledTools to disabled_tools in codex format", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            disabledTools: ["write", "delete"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["my-server"].disabled_tools).toEqual(["write", "delete"]);
      expect(mcpServers["my-server"].disabledTools).toBeUndefined();
    });

    it("should convert both enabledTools and disabledTools in codex format", async () => {
      const jsonData = {
        mcpServers: {
          "my-server": {
            command: "node",
            args: ["server.js"],
            enabledTools: ["search"],
            disabledTools: ["delete"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["my-server"].enabled_tools).toEqual(["search"]);
      expect(mcpServers["my-server"].disabled_tools).toEqual(["delete"]);
    });

    it("should rename source envVars (camelCase) to codex env_vars (snake_case)", async () => {
      // The source schema uses `envVars` (camelCase) for consistency with
      // `enabledTools`/`disabledTools`. The codex generator renames it to
      // `env_vars` (snake_case) to match codex's native config.toml format.
      // Source:
      //   "pal": { ..., "envVars": ["OPENAI_API_KEY", "JIRA_PERSONAL_TOKEN"] }
      // Output:
      //   [mcp_servers.pal]
      //   env_vars = ["OPENAI_API_KEY", "JIRA_PERSONAL_TOKEN"]
      const jsonData = {
        mcpServers: {
          pal: {
            type: "stdio",
            command: "uvx",
            args: ["pal-mcp-server"],
            envVars: ["OPENAI_API_KEY", "JIRA_PERSONAL_TOKEN"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      // Output uses snake_case (codex native).
      expect(mcpServers.pal.env_vars).toEqual(["OPENAI_API_KEY", "JIRA_PERSONAL_TOKEN"]);
      // Source key (camelCase) must NOT appear in codex output.
      expect(mcpServers.pal.envVars).toBeUndefined();
      // Defensive: other fields survive.
      expect(mcpServers.pal.command).toBe("uvx");
      expect(mcpServers.pal.args).toEqual(["pal-mcp-server"]);
    });

    it("should coexist envVars and env on the same server", async () => {
      // `envVars` (list of names inherited from shell) and `env` (literal
      // name→value map) are distinct concepts. Both must serialize correctly
      // on the same server.
      const jsonData = {
        mcpServers: {
          pal: {
            type: "stdio",
            command: "uvx",
            args: ["pal-mcp-server"],
            envVars: ["OPENAI_API_KEY"],
            env: { LOG_LEVEL: "debug" },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (codexcliMcp.getToml().mcp_servers as any).pal;
      expect(server.env_vars).toEqual(["OPENAI_API_KEY"]);
      expect(server.env).toEqual({ LOG_LEVEL: "debug" });
    });

    it("should not leak rulesync-only fields into codex output", async () => {
      const jsonData = {
        mcpServers: {
          pal: {
            type: "stdio",
            command: "uvx",
            args: ["pal-mcp-server"],
            envVars: ["OPENAI_API_KEY"],
            targets: ["codexcli"],
            description: "PAL MCP server",
            exposed: true,
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const server = (codexcliMcp.getToml().mcp_servers as any).pal;
      expect(server.env_vars).toEqual(["OPENAI_API_KEY"]);
      expect(server.targets).toBeUndefined();
      expect(server.description).toBeUndefined();
      expect(server.exposed).toBeUndefined();
    });

    it("should round-trip envVars through codex import", async () => {
      // codex config.toml → toRulesyncMcp() → rulesync representation must
      // expose `envVars` in source schema form (camelCase).
      const tomlContent = `[mcp_servers.pal]
type = "stdio"
command = "uvx"
args = ["pal-mcp-server"]
env_vars = ["OPENAI_API_KEY"]
`;
      const codexcliMcp = new CodexcliMcp({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();
      const json = JSON.parse(rulesyncMcp.getFileContent());

      expect(json.mcpServers.pal.envVars).toEqual(["OPENAI_API_KEY"]);
      expect(json.mcpServers.pal.env_vars).toBeUndefined();
    });

    it("should ignore malformed codex array fields when importing", () => {
      const tomlContent = `[mcp_servers.pal]
type = "stdio"
command = "uvx"
env_vars = [1, 2, 3]
enabled_tools = ["read", 2]
disabled_tools = [false]
`;
      const codexcliMcp = new CodexcliMcp({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();
      const json = JSON.parse(rulesyncMcp.getFileContent());

      expect(json.mcpServers.pal.envVars).toBeUndefined();
      expect(json.mcpServers.pal.enabledTools).toBeUndefined();
      expect(json.mcpServers.pal.disabledTools).toBeUndefined();
      expect(json.mcpServers.pal.command).toBe("uvx");
    });

    it("should convert enabledTools/disabledTools for multiple servers", async () => {
      const jsonData = {
        mcpServers: {
          "server-a": {
            command: "node",
            args: ["a.js"],
            disabledTools: ["write"],
          },
          "server-b": {
            command: "node",
            args: ["b.js"],
            enabledTools: ["read"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["server-a"].disabled_tools).toEqual(["write"]);
      expect(mcpServers["server-b"].enabled_tools).toEqual(["read"]);
    });

    it("should not include tool keys when no enabledTools/disabledTools are specified", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["test-server"].enabled_tools).toBeUndefined();
      expect(mcpServers["test-server"].disabled_tools).toBeUndefined();
    });

    it("should handle complex nested MCP server configuration", async () => {
      const jsonData = {
        mcpServers: {
          "complex-server": {
            command: "node",
            args: ["complex-server.js", "--port", "3000", "--ssl"],
            env: {
              NODE_ENV: "production",
              DEBUG: "mcp:*",
              SSL_CERT: "/path/to/cert",
            },
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(codexcliMcp.getToml().mcp_servers).toEqual(jsonData.mcpServers);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp with default configuration", () => {
      const tomlContent = `[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.json");

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect((json.mcpServers as any)?.filesystem).toBeDefined();
    });

    it("should preserve MCP server data when converting to RulesyncMcp", () => {
      const tomlContent = `[mcp_servers."complex-server"]
command = "node"
args = ["complex-server.js", "--port", "3000"]

[mcp_servers."complex-server".env]
NODE_ENV = "production"
DEBUG = "mcp:*"

[mcp_servers."another-server"]
command = "python"
args = ["another-server.py"]
`;
      const codexcliMcp = new CodexcliMcp({
        outputRoot: "/test/dir",
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getOutputRoot()).toBe("/test/dir");

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers?.["complex-server"]).toEqual({
        command: "node",
        args: ["complex-server.js", "--port", "3000"],
        env: {
          NODE_ENV: "production",
          DEBUG: "mcp:*",
        },
      });
      expect(json.mcpServers?.["another-server"]).toEqual({
        command: "python",
        args: ["another-server.py"],
      });
    });

    it("should only include mcpServers in RulesyncMcp output", () => {
      const tomlContent = `[general]
theme = "dark"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[editor]
fontSize = 14
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers).toBeDefined();
      expect(json.general).toBeUndefined();
      expect(json.editor).toBeUndefined();
    });

    it("should handle empty mcpServers when converting", () => {
      const tomlContent = `[general]
theme = "dark"
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers).toEqual({});
    });

    it("should convert enabled = false to disabled: true in rulesync format", () => {
      const tomlContent = `[mcp_servers."disabled-server"]
command = "node"
args = ["server.js"]
enabled = false
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["disabled-server"].disabled).toBe(true);
      expect(json.mcpServers["disabled-server"].enabled).toBeUndefined();
    });

    it("should convert enabled_tools to enabledTools in rulesync format", () => {
      const tomlContent = `[mcp_servers."my-server"]
command = "node"
args = ["server.js"]
enabled_tools = ["search", "list"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["my-server"].enabledTools).toEqual(["search", "list"]);
      expect(json.mcpServers["my-server"].enabled_tools).toBeUndefined();
    });

    it("should convert disabled_tools to disabledTools in rulesync format", () => {
      const tomlContent = `[mcp_servers."my-server"]
command = "node"
args = ["server.js"]
disabled_tools = ["write", "delete"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["my-server"].disabledTools).toEqual(["write", "delete"]);
      expect(json.mcpServers["my-server"].disabled_tools).toBeUndefined();
    });

    it("should convert both enabled_tools and disabled_tools in rulesync format", () => {
      const tomlContent = `[mcp_servers."my-server"]
command = "node"
args = ["server.js"]
enabled_tools = ["search"]
disabled_tools = ["delete"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["my-server"].enabledTools).toEqual(["search"]);
      expect(json.mcpServers["my-server"].disabledTools).toEqual(["delete"]);
    });

    it("should convert enabled_tools/disabled_tools for multiple servers", () => {
      const tomlContent = `[mcp_servers."server-a"]
command = "node"
args = ["a.js"]
disabled_tools = ["write"]

[mcp_servers."server-b"]
command = "node"
args = ["b.js"]
enabled_tools = ["read"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["server-a"].disabledTools).toEqual(["write"]);
      expect(json.mcpServers["server-b"].enabledTools).toEqual(["read"]);
    });

    it("should not include enabledTools/disabledTools when no tool keys exist", () => {
      const tomlContent = `[mcp_servers."my-server"]
command = "node"
args = ["server.js"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
      });

      const rulesyncMcp = codexcliMcp.toRulesyncMcp();

      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers["my-server"].enabledTools).toBeUndefined();
      expect(json.mcpServers["my-server"].disabledTools).toBeUndefined();
    });
  });

  describe("isDeletable", () => {
    it("should return false (config.toml should not be deleted)", () => {
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: "",
        validate: false,
      });

      expect(codexcliMcp.isDeletable()).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return successful validation result", () => {
      const tomlContent = `[mcpServers."test-server"]
command = "node"
args = ["server.js"]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should always return success (no validation logic implemented)", () => {
      const tomlContent = `[mcpServers]
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for complex MCP configuration", () => {
      const tomlContent = `[mcpServers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]

[mcpServers.filesystem.env]
NODE_ENV = "development"

[mcpServers.git]
command = "node"
args = ["git-server.js"]

[mcpServers.sqlite]
command = "python"
args = ["sqlite-server.py", "--database", "/path/to/db.sqlite"]

[mcpServers.sqlite.env]
PYTHONPATH = "/custom/path"
DEBUG = "true"
`;
      const codexcliMcp = new CodexcliMcp({
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: tomlContent,
        validate: false,
      });

      const result = codexcliMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalTomlData = `[mcp_servers."workflow-server"]
command = "node"
args = ["workflow-server.js", "--config", "config.json"]

[mcp_servers."workflow-server".env]
NODE_ENV = "test"
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Step 1: Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Step 3: Create new CodexcliMcp from RulesyncMcp
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify data integrity for mcp_servers
      const originalJson = originalCodexcliMcp.getToml();
      const newJson = newCodexcliMcp.getToml();
      expect(newJson.mcp_servers).toEqual(originalJson.mcp_servers);
      expect(newCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should maintain MCP server data consistency across transformations", async () => {
      const complexTomlData = `[mcp_servers."primary-server"]
command = "node"
args = ["primary.js", "--mode", "production"]

[mcp_servers."primary-server".env]
NODE_ENV = "production"
LOG_LEVEL = "info"
API_KEY = "secret"

[mcp_servers."secondary-server"]
command = "python"
args = ["secondary.py", "--workers", "4"]

[mcp_servers."secondary-server".env]
PYTHONPATH = "/app/lib"
`;

      // Create CodexcliMcp
      const codexcliMcp = new CodexcliMcp({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: complexTomlData,
      });

      // Convert to RulesyncMcp and back
      const rulesyncMcp = codexcliMcp.toRulesyncMcp();
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify mcpServers data is preserved
      const originalMcpServers = codexcliMcp.getToml().mcp_servers;
      const newMcpServers = newCodexcliMcp.getToml().mcp_servers;
      expect(newMcpServers).toEqual(originalMcpServers);
      expect(newCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
    });

    it("should preserve existing non-MCP TOML content through full workflow", async () => {
      const originalTomlData = `[general]
theme = "dark"
language = "en"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

[editor]
fontSize = 14
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      // Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Create new CodexcliMcp from RulesyncMcp (this should preserve existing content)
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const newJson = newCodexcliMcp.getToml();
      expect((newJson as any).general).toEqual({
        theme: "dark",
        language: "en",
      });
      expect((newJson as any).editor).toEqual({ fontSize: 14 });
      expect((newJson.mcp_servers as any)?.filesystem).toBeDefined();
    });

    it("should round-trip enabled_tools/disabled_tools through rulesync format", async () => {
      const originalTomlData = `[mcp_servers."my-server"]
command = "node"
args = ["server.js"]
enabled_tools = ["search", "read"]
disabled_tools = ["write"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Step 1: Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Verify RulesyncMcp has enabledTools/disabledTools
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["my-server"].enabledTools).toEqual(["search", "read"]);
      expect(rulesyncJson.mcpServers["my-server"].disabledTools).toEqual(["write"]);

      // Step 3: Convert back to CodexcliMcp
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // After round-trip, should be back to codex format
      const mcpServers = newCodexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["my-server"].enabled_tools).toEqual(["search", "read"]);
      expect(mcpServers["my-server"].disabled_tools).toEqual(["write"]);
    });

    it("should round-trip enabled = false through rulesync format", async () => {
      const originalTomlData = `[mcp_servers."disabled-server"]
command = "node"
args = ["server.js"]
enabled = false
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Step 1: Load from file
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: true,
      });

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();

      // Verify RulesyncMcp has disabled: true
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["disabled-server"].disabled).toBe(true);

      // Step 3: Convert back to CodexcliMcp
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // After round-trip, should be back to codex format
      const mcpServers = newCodexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["disabled-server"].enabled).toBe(false);
      expect(mcpServers["disabled-server"].disabled).toBeUndefined();
    });

    it("should round-trip from rulesync format with enabledTools/disabledTools", async () => {
      const rulesyncData = {
        mcpServers: {
          "server-a": {
            command: "node",
            args: ["a.js"],
            enabledTools: ["search", "read"],
            disabledTools: ["write"],
          },
          "server-b": {
            command: "python",
            args: ["b.py"],
            disabled: true,
            disabledTools: ["delete"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncData),
      });

      // Step 1: Convert to CodexcliMcp
      const codexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      // Verify Codex format
      const mcpServers = codexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["server-a"].enabled_tools).toEqual(["search", "read"]);
      expect(mcpServers["server-a"].disabled_tools).toEqual(["write"]);
      expect(mcpServers["server-b"].enabled).toBe(false);
      expect(mcpServers["server-b"].disabled_tools).toEqual(["delete"]);

      // Step 2: Convert back to rulesync
      const backToRulesync = codexcliMcp.toRulesyncMcp();
      const backJson = JSON.parse(backToRulesync.getFileContent());

      expect(backJson.mcpServers["server-a"].enabledTools).toEqual(["search", "read"]);
      expect(backJson.mcpServers["server-a"].disabledTools).toEqual(["write"]);
      expect(backJson.mcpServers["server-b"].disabled).toBe(true);
      expect(backJson.mcpServers["server-b"].disabledTools).toEqual(["delete"]);
    });

    it("should handle complete workflow in local mode: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalTomlData = `[mcp_servers."local-server"]
command = "node"
args = ["local-server.js"]
enabled_tools = ["search"]
`;
      await ensureDir(join(testDir, ".codex"));
      await writeFileContent(join(testDir, ".codex/config.toml"), originalTomlData);

      // Step 1: Load from local file (no global flag)
      const originalCodexcliMcp = await CodexcliMcp.fromFile({
        outputRoot: testDir,
        global: false,
      });

      expect(originalCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));

      // Step 2: Convert to RulesyncMcp
      const rulesyncMcp = originalCodexcliMcp.toRulesyncMcp();
      const rulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
      expect(rulesyncJson.mcpServers["local-server"].enabledTools).toEqual(["search"]);

      // Step 3: Convert back to CodexcliMcp in local mode
      const newCodexcliMcp = await CodexcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: false,
      });

      expect(newCodexcliMcp.getFilePath()).toBe(join(testDir, ".codex/config.toml"));
      const mcpServers = newCodexcliMcp.getToml().mcp_servers as any;
      expect(mcpServers["local-server"].enabled_tools).toEqual(["search"]);
    });
  });
});
