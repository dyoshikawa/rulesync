import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { GrokcliMcp } from "./grokcli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("GrokcliMcp", () => {
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
    it("writes MCP servers to .grok/config.toml", () => {
      const paths = GrokcliMcp.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".grok");
      expect(paths.relativeFilePath).toBe("config.toml");
    });

    it("uses the same relative path in global mode (resolved by outputRoot)", () => {
      const paths = GrokcliMcp.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".grok");
      expect(paths.relativeFilePath).toBe("config.toml");
    });
  });

  describe("fromRulesyncMcp", () => {
    it("emits a [mcp_servers.<name>] table for a stdio server with args and env", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "filesystem-mcp"],
              env: { TOKEN_NAME: "value" },
            },
          },
        }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const servers = grokcliMcp.getToml().mcp_servers;
      const filesystem = isRecord(servers) ? servers.filesystem : undefined;

      expect(filesystem).toEqual({
        command: "npx",
        args: ["-y", "filesystem-mcp"],
        env: { TOKEN_NAME: "value" },
      });
    });

    it("maps disabled: true to enabled: false", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { off: { command: "node", args: ["x.js"], disabled: true } },
        }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const servers = grokcliMcp.getToml().mcp_servers;
      const off = isRecord(servers) ? servers.off : undefined;

      expect(isRecord(off) && off.enabled).toBe(false);
      expect(isRecord(off) && "disabled" in off).toBe(false);
    });

    it("omits an empty env table for a server with no env vars (no dangling [mcp_servers.X.env])", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { plain: { command: "node", args: ["s.js"], env: {} } },
        }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const servers = grokcliMcp.getToml().mcp_servers;
      const plain = isRecord(servers) ? servers.plain : undefined;

      expect(isRecord(plain) && "env" in plain).toBe(false);
      expect(grokcliMcp.getFileContent()).not.toContain("[mcp_servers.plain.env]");
    });

    it("emits url for a remote server", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { url: "https://mcp.example.com/mcp" } },
        }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const servers = grokcliMcp.getToml().mcp_servers;
      const remote = isRecord(servers) ? servers.remote : undefined;

      expect(isRecord(remote) && remote.url).toBe("https://mcp.example.com/mcp");
    });

    it("preserves unrelated config.toml settings when adding mcp_servers", async () => {
      // Pre-existing config with unrelated tables that Rulesync does not own.
      const existingToml = `[ui]
theme = "dark"

[model]
name = "grok-4"
`;
      await ensureDir(join(testDir, ".grok"));
      await writeFileContent(join(testDir, ".grok/config.toml"), existingToml);

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { a: { command: "a" } } }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const toml = grokcliMcp.getToml();

      // The unrelated tables survive the round-trip untouched...
      expect(toml.ui).toEqual({ theme: "dark" });
      expect(toml.model).toEqual({ name: "grok-4" });
      // ...while the new mcp_servers table is added alongside them.
      const servers = isRecord(toml.mcp_servers) ? toml.mcp_servers : undefined;
      expect(servers?.a).toEqual({ command: "a" });
    });
  });

  describe("toRulesyncMcp", () => {
    it("round-trips enabled: false back to disabled: true", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { off: { command: "node", disabled: true } },
        }),
      });

      const grokcliMcp = await GrokcliMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const back = grokcliMcp.toRulesyncMcp();
      const servers = JSON.parse(back.getFileContent()).mcpServers;

      expect(servers.off.disabled).toBe(true);
      expect("enabled" in servers.off).toBe(false);
    });
  });

  describe("isDeletable", () => {
    it("never deletes config.toml since it holds other Grok settings", async () => {
      const grokcliMcp = await GrokcliMcp.fromFile({ outputRoot: testDir, validate: false });
      expect(grokcliMcp.isDeletable()).toBe(false);
    });
  });
});
