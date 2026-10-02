import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QwencodeMcp } from "./qwencode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("QwencodeMcp", () => {
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
      const paths = QwencodeMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".qwen");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = QwencodeMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(".qwen");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should always return false because settings.json may contain other settings", () => {
      const localMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });

      expect(localMcp.isDeletable()).toBe(false);

      const globalMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: true,
      });

      expect(globalMcp.isDeletable()).toBe(false);
    });

    it("should return false when created via forDeletion", () => {
      const qwencodeMcp = QwencodeMcp.forDeletion({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        global: true,
      });

      expect(qwencodeMcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write mcpServers with stdio and httpUrl servers", async () => {
      const jsonData = {
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
          },
          remote: {
            type: "http",
            httpUrl: "https://example.com/mcp",
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = qwencodeMcp.getJson() as any;
      expect(json.mcpServers.filesystem.command).toBe("npx");
      expect(json.mcpServers.filesystem.args).toEqual([
        "-y",
        "@modelcontextprotocol/server-filesystem",
        testDir,
      ]);
      expect(json.mcpServers.remote.httpUrl).toBe("https://example.com/mcp");
      expect(qwencodeMcp.getRelativeDirPath()).toBe(".qwen");
      expect(qwencodeMcp.getRelativeFilePath()).toBe("settings.json");
    });

    it("should map enabledTools->includeTools and disabledTools->excludeTools", async () => {
      const jsonData = {
        mcpServers: {
          server: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            enabledTools: ["read", "list"],
            disabledTools: ["write"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const server = (qwencodeMcp.getJson() as any).mcpServers.server;
      expect(server.includeTools).toEqual(["read", "list"]);
      expect(server.excludeTools).toEqual(["write"]);
      expect(server.enabledTools).toBeUndefined();
      expect(server.disabledTools).toBeUndefined();
    });

    it("should preserve non-mcpServers top-level keys", async () => {
      const existingConfig = {
        mcpServers: {},
        theme: "dark",
        version: "1.0.0",
      };
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen/settings.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            server: { type: "stdio", command: "node", args: ["s.js"] },
          },
        }),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const json = qwencodeMcp.getJson() as any;
      expect(json.theme).toBe("dark");
      expect(json.version).toBe("1.0.0");
      expect(json.mcpServers.server.command).toBe("node");
    });

    it("should write qwencode.allowed/excluded into the mcp object, keeping its other keys", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen/settings.json"),
        JSON.stringify({
          mcpServers: {},
          mcp: { serverCommand: "run-mcp", allowed: ["old"], excluded: ["keep-me"] },
        }),
      );
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {},
          qwencode: { allowed: ["my-trusted-server", "*-internal"] },
        }),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect((qwencodeMcp.getJson() as any).mcp).toEqual({
        serverCommand: "run-mcp",
        allowed: ["my-trusted-server", "*-internal"],
        excluded: ["keep-me"],
      });
    });

    it("should leave an existing mcp object alone when no list is authored", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen/settings.json"),
        JSON.stringify({ mcpServers: {}, mcp: { excluded: ["experimental-server"] } }),
      );
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect((qwencodeMcp.getJson() as any).mcp).toEqual({ excluded: ["experimental-server"] });
    });

    it("should create instance in global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(qwencodeMcp.getRelativeDirPath()).toBe(".qwen");
      expect(qwencodeMcp.getRelativeFilePath()).toBe("settings.json");
    });
  });

  describe("fromFile", () => {
    const writeSettings = async (mcpServers: Record<string, unknown>) => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "settings.json"),
        JSON.stringify({ mcpServers }, null, 2),
      );
    };
    const writeProjectMcpJson = async (mcpServers: Record<string, unknown>) => {
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify({ mcpServers }, null, 2));
    };

    it("should import servers from the project .mcp.json when settings.json is absent", async () => {
      await writeProjectMcpJson({
        claude: { type: "stdio", command: "node", args: ["claude.js"] },
      });

      const qwencodeMcp = await QwencodeMcp.fromFile({ outputRoot: testDir });

      expect(qwencodeMcp.getJson().mcpServers).toEqual({
        claude: { type: "stdio", command: "node", args: ["claude.js"] },
      });
      expect(qwencodeMcp.getRelativeDirPath()).toBe(".qwen");
      expect(qwencodeMcp.getRelativeFilePath()).toBe("settings.json");
    });

    it("should merge .mcp.json servers beneath settings.json, letting settings win on a name clash", async () => {
      await writeSettings({
        shared: { command: "settings-cmd" },
        settingsOnly: { command: "settings-only" },
      });
      await writeProjectMcpJson({
        shared: { type: "stdio", command: "mcp-json-cmd" },
        mcpJsonOnly: { type: "http", url: "https://example.com/mcp" },
      });

      const qwencodeMcp = await QwencodeMcp.fromFile({ outputRoot: testDir });

      expect(qwencodeMcp.getJson().mcpServers).toEqual({
        shared: { command: "settings-cmd" },
        settingsOnly: { command: "settings-only" },
        mcpJsonOnly: { type: "http", url: "https://example.com/mcp" },
      });
    });

    it("should map includeTools/excludeTools declared in .mcp.json on import", async () => {
      await writeProjectMcpJson({
        filtered: { command: "node", includeTools: ["read"], excludeTools: ["write"] },
      });

      const qwencodeMcp = await QwencodeMcp.fromFile({ outputRoot: testDir });
      const exported = JSON.parse(qwencodeMcp.toRulesyncMcp().getFileContent());

      expect(exported.mcpServers.filtered).toEqual({
        command: "node",
        enabledTools: ["read"],
        disabledTools: ["write"],
      });
    });

    it("should ignore a .mcp.json without an mcpServers object", async () => {
      await writeSettings({ server: { command: "node" } });
      await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify({ mcpServers: [] }));

      const qwencodeMcp = await QwencodeMcp.fromFile({ outputRoot: testDir });

      expect(qwencodeMcp.getJson().mcpServers).toEqual({ server: { command: "node" } });
    });

    it("should not read the project .mcp.json in global mode", async () => {
      await writeSettings({ globalServer: { command: "node" } });
      await writeProjectMcpJson({ claude: { command: "claude" } });

      const qwencodeMcp = await QwencodeMcp.fromFile({ outputRoot: testDir, global: true });

      expect(qwencodeMcp.getJson().mcpServers).toEqual({ globalServer: { command: "node" } });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should round-trip and map includeTools->enabledTools / excludeTools->disabledTools", () => {
      const jsonData = {
        mcpServers: {
          server: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            includeTools: ["read", "list"],
            excludeTools: ["write"],
          },
          remote: {
            type: "http",
            httpUrl: "https://example.com/mcp",
          },
        },
      };
      const qwencodeMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = qwencodeMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      const exported = JSON.parse(rulesyncMcp.getFileContent());
      expect(exported.$schema).toBe(RULESYNC_MCP_SCHEMA_URL);
      expect(exported.mcpServers.server.enabledTools).toEqual(["read", "list"]);
      expect(exported.mcpServers.server.disabledTools).toEqual(["write"]);
      expect(exported.mcpServers.server.includeTools).toBeUndefined();
      expect(exported.mcpServers.server.excludeTools).toBeUndefined();
      expect(exported.mcpServers.remote.httpUrl).toBe("https://example.com/mcp");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
    });

    it("should import mcp.allowed/excluded into the qwencode block", () => {
      const qwencodeMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          mcpServers: {},
          mcp: { allowed: ["a", "b-*"], excluded: ["c"], serverCommand: "run-mcp" },
        }),
      });

      const exported = JSON.parse(qwencodeMcp.toRulesyncMcp().getFileContent());
      expect(exported.qwencode).toEqual({ allowed: ["a", "b-*"], excluded: ["c"] });
    });

    it("should not emit a qwencode block when the mcp object has no lists", () => {
      const qwencodeMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {}, mcp: { serverCommand: "run-mcp" } }),
      });

      const exported = JSON.parse(qwencodeMcp.toRulesyncMcp().getFileContent());
      expect(exported.qwencode).toBeUndefined();
    });

    it("should handle empty mcpServers object", () => {
      const qwencodeMcp = new QwencodeMcp({
        relativeDirPath: ".qwen",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });

      const rulesyncMcp = qwencodeMcp.toRulesyncMcp();
      const exported = JSON.parse(rulesyncMcp.getFileContent());
      expect(exported.mcpServers).toEqual({});
    });
  });

  describe("integration", () => {
    it("should round-trip enabledTools/disabledTools through both conversions", async () => {
      const rulesyncJson = {
        mcpServers: {
          server: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            enabledTools: ["read"],
            disabledTools: ["write"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(rulesyncJson),
      });

      const qwencodeMcp = await QwencodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const backToRulesync = qwencodeMcp.toRulesyncMcp();
      const exported = JSON.parse(backToRulesync.getFileContent());
      expect(exported.mcpServers.server.enabledTools).toEqual(["read"]);
      expect(exported.mcpServers.server.disabledTools).toEqual(["write"]);
    });
  });
});
