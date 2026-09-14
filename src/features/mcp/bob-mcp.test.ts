import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobMcp } from "./bob-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("BobMcp", () => {
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
    it("should return .bob/mcp.json for project scope", () => {
      const paths = BobMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".bob");
      expect(paths.relativeFilePath).toBe("mcp.json");
    });

    it("should return .bob/mcp_settings.json for global scope", () => {
      const paths = BobMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".bob");
      expect(paths.relativeFilePath).toBe("mcp_settings.json");
    });
  });

  describe("constructor", () => {
    it("should parse the JSON content", () => {
      const content = JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } });

      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      expect(bobMcp).toBeInstanceOf(BobMcp);
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
      expect(bobMcp.getFileContent()).toBe(content);
    });

    it("should throw on invalid JSON", () => {
      expect(() => {
        return new BobMcp({
          relativeDirPath: ".bob",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
        });
      }).toThrow(/Failed to parse Bob MCP config/);
    });
  });

  describe("isDeletable", () => {
    it("should be deletable in project scope", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(bobMcp.isDeletable()).toBe(true);
    });

    it("should not be deletable in global scope", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp_settings.json",
        fileContent: "{}",
        global: true,
      });

      expect(bobMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write stdio servers as-is under .bob/mcp.json", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" }, cwd: "/repo" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(bobMcp.getOutputRoot()).toBe(testDir);
      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: {
          git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" }, cwd: "/repo" },
        },
      });
    });

    it("should map sse servers to url and drop the type key", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: { events: { url: "https://example.com/sse", headers: { A: "b" } } },
      });
    });

    it("should map http and streamable-http servers to httpURL", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp" },
        streamable: { transport: "streamable-http", url: "https://example.com/stream" },
        bare: { url: "https://example.com/bare" },
        alias: { httpUrl: "https://example.com/alias" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        mcpServers: {
          http: { httpURL: "https://example.com/mcp" },
          streamable: { httpURL: "https://example.com/stream" },
          bare: { httpURL: "https://example.com/bare" },
          alias: { httpURL: "https://example.com/alias" },
        },
      });
    });

    it("should pass through Bob-specific keys", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", timeout: 60, alwaysAllow: ["status"], disabled: true },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({
        command: "git-mcp",
        timeout: 60,
        alwaysAllow: ["status"],
        disabled: true,
      });
    });

    it("should strip rulesync-only fields such as targets", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", targets: ["bob"] },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent()).mcpServers.git).toEqual({ command: "git-mcp" });
    });

    it("should keep sibling top-level keys of an existing file", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp.json"),
        JSON.stringify({ other: { keep: true }, mcpServers: { old: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(bobMcp.getFileContent())).toEqual({
        other: { keep: true },
        mcpServers: { git: { command: "git-mcp" } },
      });
    });

    it("should throw when the existing file is not valid JSON", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "mcp.json"), "{ nope");
      const rulesyncMcp = buildRulesyncMcp({});

      await expect(BobMcp.fromRulesyncMcp({ rulesyncMcp })).rejects.toThrow(
        /Failed to parse Bob MCP config/,
      );
    });

    it("should write .bob/mcp_settings.json in global scope", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: "git-mcp" } });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp, global: true });

      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp_settings.json");
      expect(bobMcp.isDeletable()).toBe(false);
    });

    it("should honor a custom outputRoot", async () => {
      const rulesyncMcp = buildRulesyncMcp({});

      const bobMcp = await BobMcp.fromRulesyncMcp({ outputRoot: "/custom/base", rulesyncMcp });

      expect(bobMcp.getFilePath()).toBe(join("/custom/base", ".bob", "mcp.json"));
    });
  });

  describe("fromFile", () => {
    it("should read .bob/mcp.json", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp.json"),
        JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } }),
      );

      const bobMcp = await BobMcp.fromFile({});

      expect(bobMcp.getRelativeDirPath()).toBe(".bob");
      expect(bobMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const bobMcp = await BobMcp.fromFile({});

      expect(bobMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should read ~/.bob/mcp_settings.json in global scope", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(
        join(testDir, ".bob", "mcp_settings.json"),
        JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } }),
      );

      const bobMcp = await BobMcp.fromFile({ global: true });

      expect(bobMcp.getRelativeFilePath()).toBe("mcp_settings.json");
      expect(bobMcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
    });

    it("should throw when the file is not valid JSON", async () => {
      await ensureDir(join(testDir, ".bob"));
      await writeFileContent(join(testDir, ".bob", "mcp.json"), "{ nope");

      await expect(BobMcp.fromFile({})).rejects.toThrow(/Failed to parse Bob MCP config/);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep stdio servers and emit the rulesync schema", () => {
      const bobMcp = new BobMcp({
        outputRoot: testDir,
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { git: { command: "git-mcp", args: ["x"] } } }),
      });

      const rulesyncMcp = bobMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: { git: { command: "git-mcp", args: ["x"] } },
      });
    });

    it("should map httpURL to url with type http", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { remote: { httpURL: "https://example.com/mcp", headers: { A: "b" } } },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        remote: { url: "https://example.com/mcp", headers: { A: "b" }, type: "http" },
      });
    });

    it("should mark a plain url as sse", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { events: { url: "https://example.com/sse" } },
        }),
      });

      expect(bobMcp.toRulesyncMcp().getMcpServers()).toEqual({
        events: { url: "https://example.com/sse", type: "sse" },
      });
    });

    it("should drop sibling top-level keys and tolerate a missing server map", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ other: true }),
      });

      expect(JSON.parse(bobMcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {},
      });
    });

    it("should round-trip http and sse servers", async () => {
      const original = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp" },
        sse: { type: "sse", url: "https://example.com/sse" },
        stdio: { command: "git-mcp" },
      });

      const bobMcp = await BobMcp.fromRulesyncMcp({ rulesyncMcp: original });
      const restored = bobMcp.toRulesyncMcp();

      expect(restored.getMcpServers()).toEqual({
        http: { url: "https://example.com/mcp", type: "http" },
        sse: { url: "https://example.com/sse", type: "sse" },
        stdio: { command: "git-mcp" },
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const bobMcp = new BobMcp({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(bobMcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create an instance with empty content", () => {
      const bobMcp = BobMcp.forDeletion({
        relativeDirPath: ".bob",
        relativeFilePath: "mcp.json",
      });

      expect(bobMcp.getFileContent()).toBe("{}");
      expect(bobMcp.getJson()).toEqual({});
    });
  });
});
