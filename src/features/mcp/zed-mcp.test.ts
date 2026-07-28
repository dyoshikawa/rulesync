import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ZedMcp } from "./zed-mcp.js";

const expectedZedGlobalDir =
  process.platform === "win32" ? join("AppData", "Roaming", "Zed") : join(".config", "zed");

describe("ZedMcp", () => {
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
    it("should return .zed/settings.json for project mode", () => {
      const paths = ZedMcp.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".zed");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return the platform's global Zed dir for global mode", () => {
      const paths = ZedMcp.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(expectedZedGlobalDir);
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should always return false because settings.json is shared/user-managed", () => {
      const mcp = new ZedMcp({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ context_servers: {} }),
      });
      expect(mcp.isDeletable()).toBe(false);

      const forDeletion = ZedMcp.forDeletion({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
      });
      expect(forDeletion.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should initialize empty context_servers if file does not exist", async () => {
      const mcp = await ZedMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getJson()).toEqual({ context_servers: {} });
    });

    it("should preserve unrelated keys (e.g. private_files) from existing settings.json", async () => {
      const existing = {
        private_files: ["**/.env"],
        context_servers: {
          local: { command: "node", args: ["server.js"] },
        },
      };
      await ensureDir(join(testDir, ".zed"));
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify(existing, null, 2),
      );

      const mcp = await ZedMcp.fromFile({ outputRoot: testDir });
      const json = mcp.getJson() as Record<string, unknown>;
      expect(json.private_files).toEqual(["**/.env"]);
      expect(json.context_servers).toEqual({
        local: { command: "node", args: ["server.js"] },
      });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write servers under the context_servers key", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            local: { command: "node", args: ["server.js"], env: { FOO: "${BAR}" } },
          },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as Record<string, unknown>;
      expect(json.context_servers).toEqual({
        local: { command: "node", args: ["server.js"], env: { FOO: "${BAR}" } },
      });
      expect(json.mcpServers).toBeUndefined();
    });

    it("should preserve existing private_files when writing MCP servers", async () => {
      const existing = { private_files: ["**/.env", "secrets.txt"] };
      await ensureDir(join(testDir, ".zed"));
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify(existing, null, 2),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { url: "https://mcp.example.com/mcp" } },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as Record<string, unknown>;
      expect(json.private_files).toEqual(["**/.env", "secrets.txt"]);
      expect(json.context_servers).toEqual({
        remote: { url: "https://mcp.example.com/mcp" },
      });
    });

    it("should strip codex-only envVars from output", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            pal: { command: "uvx", args: ["pal-mcp-server"], envVars: ["OPENAI_API_KEY"] },
          },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, Record<string, unknown>> };
      expect(json.context_servers.pal?.envVars).toBeUndefined();
      expect(json.context_servers.pal?.command).toBe("uvx");
    });

    it("should write to ~/.config/zed/settings.json in global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { local: { command: "node" } } }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });
      expect(mcp.getFilePath()).toBe(join(testDir, expectedZedGlobalDir, "settings.json"));
    });

    it("should write a disabled server as enabled: false, not as a disabled key Zed ignores", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { off: { command: "node", disabled: true } },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.off).toEqual({ command: "node", enabled: false });
    });

    it("should normalize httpUrl to the url Zed reads", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: { httpUrl: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
          },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.remote).toEqual({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      });
    });

    it("should flatten an array command into Zed's string command plus args", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { local: { command: ["npx", "-y"], args: ["pkg"] } },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.local).toEqual({ command: "npx", args: ["-y", "pkg"] });
    });

    it("should drop canonical-only fields Zed does not read", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            local: {
              type: "stdio",
              command: "node",
              trust: true,
              cwd: "/tmp",
              networkTimeout: 5,
              alwaysAllow: ["read"],
              kiroAutoApprove: ["read"],
            },
          },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.local).toEqual({ command: "node" });
    });

    it("should pass through fields rulesync does not model, like a remote oauth block", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: { url: "https://example.com/mcp", oauth: { scopes: ["mcp"] } },
          },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.remote).toEqual({
        url: "https://example.com/mcp",
        oauth: { scopes: ["mcp"] },
      });
    });

    it("should write a transport-less server as Zed's extension-provided variant", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          zed: {
            mcpServers: {
              "extension-server": { settings: { database: "main" }, disabled: true },
            },
          },
          mcpServers: {},
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: rulesyncMcp.forTarget({ toolTarget: "zed" }),
      });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers["extension-server"]).toEqual({
        settings: { database: "main" },
        enabled: false,
      });
    });

    it.each([
      ["sse", { type: "sse", url: "https://example.com/sse" }],
      ["ws", { type: "ws", url: "wss://example.com" }],
      ["url-less remote", { type: "http" }],
      ["command-less local", { type: "stdio" }],
    ])("should skip a server Zed cannot start: %s", async (_label, server) => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { broken: server, kept: { command: "node" } },
        }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const json = mcp.getJson() as { context_servers: Record<string, unknown> };
      expect(json.context_servers.broken).toBeUndefined();
      expect(json.context_servers.kept).toEqual({ command: "node" });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should map context_servers back to mcpServers", () => {
      const mcp = new ZedMcp({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          private_files: ["**/.env"],
          context_servers: { local: { command: "node", args: ["server.js"] } },
        }),
      });

      const rulesyncMcp = mcp.toRulesyncMcp();
      const exported = JSON.parse(rulesyncMcp.getFileContent());
      expect(exported).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: { local: { command: "node", args: ["server.js"] } },
      });
      // private_files must not leak into the rulesync MCP output.
      expect(exported.private_files).toBeUndefined();
      expect(exported.context_servers).toBeUndefined();
    });

    it("should import enabled: false back as the canonical disabled: true", () => {
      const mcp = new ZedMcp({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          context_servers: { off: { command: "node", enabled: false } },
        }),
      });

      const exported = JSON.parse(mcp.toRulesyncMcp().getFileContent());
      expect(exported.mcpServers.off).toEqual({ command: "node", disabled: true });
    });

    it("should import an extension-provided server into the zed-only block", () => {
      const mcp = new ZedMcp({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          context_servers: {
            "extension-server": { settings: { database: "main" } },
            local: { command: "node" },
          },
        }),
      });

      const exported = JSON.parse(mcp.toRulesyncMcp().getFileContent());
      expect(exported.mcpServers).toEqual({ local: { command: "node" } });
      expect(exported.zed).toEqual({
        mcpServers: { "extension-server": { settings: { database: "main" } } },
      });
    });

    it("should produce empty mcpServers when no context_servers are present", () => {
      const mcp = new ZedMcp({
        relativeDirPath: ".zed",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ private_files: ["**/.env"] }),
      });

      const exported = JSON.parse(mcp.toRulesyncMcp().getFileContent());
      expect(exported.mcpServers).toEqual({});
    });
  });

  describe("integration", () => {
    it("should round-trip while preserving private_files on disk", async () => {
      const existing = { private_files: ["**/.env"] };
      await ensureDir(join(testDir, ".zed"));
      await writeFileContent(
        join(testDir, ".zed", "settings.json"),
        JSON.stringify(existing, null, 2),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { local: { command: "node" } } }),
      });

      const mcp = await ZedMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      await writeFileContent(mcp.getFilePath(), mcp.getFileContent());

      const onDisk = JSON.parse(await readFileContent(join(testDir, ".zed", "settings.json")));
      expect(onDisk.private_files).toEqual(["**/.env"]);
      expect(onDisk.context_servers).toEqual({ local: { command: "node" } });
    });
  });
});
