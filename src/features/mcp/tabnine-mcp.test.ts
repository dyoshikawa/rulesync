import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { TabnineMcp } from "./tabnine-mcp.js";

const SETTINGS_DIR = join(".tabnine", "agent");
const SETTINGS_FILE = "settings.json";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

async function writeSettings({
  testDir,
  content,
}: {
  testDir: string;
  content: string;
}): Promise<void> {
  const dir = join(testDir, SETTINGS_DIR);
  await ensureDir(dir);
  await writeFileContent(join(dir, SETTINGS_FILE), content);
}

describe("TabnineMcp", () => {
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
    it("should return .tabnine/agent/settings.json for both scopes", () => {
      expect(TabnineMcp.getSettablePaths()).toEqual({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(TabnineMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
    });
  });

  describe("constructor", () => {
    it("should parse the JSON content", () => {
      const mcp = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: JSON.stringify({ mcpServers: { git: { command: "git-mcp" } } }),
      });
      expect(mcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } } });
    });

    it("should throw when the JSON root is not an object", () => {
      expect(
        () =>
          new TabnineMcp({
            relativeDirPath: SETTINGS_DIR,
            relativeFilePath: SETTINGS_FILE,
            fileContent: "[1]",
          }),
      ).toThrow();
    });

    it("should throw on invalid JSON", () => {
      expect(
        () =>
          new TabnineMcp({
            relativeDirPath: SETTINGS_DIR,
            relativeFilePath: SETTINGS_FILE,
            fileContent: "{ nope",
          }),
      ).toThrow();
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (shared settings file)", () => {
      const mcp = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: "{}",
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write stdio servers with documented fields under mcpServers", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: {
          command: "npx",
          args: ["-y", "mcp-git"],
          env: { TOKEN: "x" },
          cwd: "/repo",
          timeout: 30000,
          trust: true,
        },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(mcp.getOutputRoot()).toBe(testDir);
      expect(mcp.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(mcp.getRelativeFilePath()).toBe(SETTINGS_FILE);
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: {
          git: {
            command: "npx",
            args: ["-y", "mcp-git"],
            env: { TOKEN: "x" },
            cwd: "/repo",
            timeout: 30000,
            trust: true,
          },
        },
      });
    });

    it("should map remote transports to Tabnine's http/sse type", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        streamable: { transport: "streamable-http", url: "https://example.com/s" },
        sse: { type: "sse", url: "https://example.com/sse" },
        bare: { url: "https://example.com/auto" },
        claude: { httpUrl: "https://example.com/claude" },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(mcp.getFileContent()).mcpServers).toEqual({
        http: { url: "https://example.com/mcp", type: "http", headers: { A: "b" } },
        streamable: { url: "https://example.com/s", type: "http" },
        sse: { url: "https://example.com/sse", type: "sse" },
        bare: { url: "https://example.com/auto" },
        claude: { url: "https://example.com/claude" },
      });
    });

    it("should rename enabledTools/disabledTools to includeTools/excludeTools", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", enabledTools: ["log"], disabledTools: ["push"] },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({
        command: "git-mcp",
        includeTools: ["log"],
        excludeTools: ["push"],
      });
    });

    it("should normalize an array command into command and args", async () => {
      const rulesyncMcp = buildRulesyncMcp({ git: { command: ["npx", "mcp-git"], args: ["-v"] } });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({
        command: "npx",
        args: ["mcp-git", "-v"],
      });
    });

    it("should warn and skip servers Tabnine cannot start or reach", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = buildRulesyncMcp({
        none: { env: { A: "b" } },
        noUrl: { type: "http" },
        ws: { url: "wss://example.com/socket" },
        wsTyped: { type: "ws", url: "wss://example.com/socket" },
        noCommand: { type: "stdio" },
        ok: { command: "git-mcp" },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp, logger });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { ok: { command: "git-mcp" } },
      });
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(5);
      for (const name of ["none", "noUrl", "ws", "wsTyped", "noCommand"]) {
        expect(warnings.some((message) => message.includes(`"${name}"`))).toBe(true);
      }
    });

    it("should ignore prototype-pollution keys on generate", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should sanitize prototype-pollution keys inside env and headers", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"git":{"command":"git-mcp","env":{"TOKEN":"x","__proto__":{"y":1}}},"api":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer t","constructor":{"z":1}}}}',
        ),
      );

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      const servers = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(servers.git.env)).toEqual(["TOKEN"]);
      expect(Object.keys(servers.api.headers)).toEqual(["Authorization"]);
    });

    it("should strip rulesync-only fields such as targets", async () => {
      const rulesyncMcp = buildRulesyncMcp({
        git: { command: "git-mcp", targets: ["tabnine"], description: "d" },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(mcp.getFileContent()).mcpServers.git).toEqual({ command: "git-mcp" });
    });

    it("should keep sibling keys of an existing settings file", async () => {
      await writeSettings({
        testDir,
        content: JSON.stringify({
          general: { vimMode: true },
          hooks: { SessionStart: [] },
          mcpServers: { stale: { command: "old" } },
        }),
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp({ git: { command: "git-mcp" } }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        general: { vimMode: true },
        hooks: { SessionStart: [] },
        mcpServers: { git: { command: "git-mcp" } },
      });
    });

    it("should throw when the existing settings file is not valid JSON", async () => {
      await writeSettings({ testDir, content: "{ nope" });

      await expect(
        TabnineMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp({ git: { command: "x" } }) }),
      ).rejects.toThrow();
    });

    it("should honor a custom outputRoot and global scope", async () => {
      const outputRoot = join(testDir, "home");
      const mcp = await TabnineMcp.fromRulesyncMcp({
        outputRoot,
        rulesyncMcp: buildRulesyncMcp({ git: { command: "x" } }),
        global: true,
      });

      expect(mcp.getOutputRoot()).toBe(outputRoot);
      expect(mcp.getRelativeDirPath()).toBe(SETTINGS_DIR);
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should read .tabnine/agent/settings.json", async () => {
      await writeSettings({
        testDir,
        content: JSON.stringify({ mcpServers: { git: { command: "git-mcp" } }, general: {} }),
      });

      const mcp = await TabnineMcp.fromFile({});

      expect(mcp.getJson()).toEqual({ mcpServers: { git: { command: "git-mcp" } }, general: {} });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const mcp = await TabnineMcp.fromFile({});
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should throw when the file is not valid JSON", async () => {
      await writeSettings({ testDir, content: "{ nope" });
      await expect(TabnineMcp.fromFile({})).rejects.toThrow();
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep stdio servers and emit the rulesync schema", () => {
      const mcp = new TabnineMcp({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: JSON.stringify({ mcpServers: { git: { command: "git-mcp", args: ["x"] } } }),
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesyncMcp.getRelativeFilePath()).toBe("mcp.jsonc");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: { git: { command: "git-mcp", args: ["x"] } },
      });
    });

    it("should rename includeTools/excludeTools back and keep the other fields", () => {
      const mcp = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: JSON.stringify({
          general: { vimMode: true },
          mcpServers: {
            api: {
              url: "https://example.com/mcp",
              type: "http",
              headers: { A: "b" },
              includeTools: ["a"],
              excludeTools: ["b"],
              trust: true,
            },
          },
        }),
      });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
        api: {
          url: "https://example.com/mcp",
          type: "http",
          headers: { A: "b" },
          enabledTools: ["a"],
          disabledTools: ["b"],
          trust: true,
        },
      });
    });

    it("should ignore prototype-pollution keys and tolerate a missing server map", () => {
      const polluted = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent:
          '{"mcpServers":{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","constructor":{"x":1}}}}',
      });
      const servers = polluted.toRulesyncMcp().getMcpServers();
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git ?? {})).toEqual(["command"]);

      const empty = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: JSON.stringify({ general: {} }),
      });
      expect(empty.toRulesyncMcp().getMcpServers()).toEqual({});
    });

    it("should round-trip http, sse and stdio servers", async () => {
      const original = buildRulesyncMcp({
        http: { type: "http", url: "https://example.com/mcp" },
        sse: { type: "sse", url: "https://example.com/sse" },
        stdio: { command: "git-mcp", enabledTools: ["log"] },
      });

      const mcp = await TabnineMcp.fromRulesyncMcp({ rulesyncMcp: original });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
        http: { type: "http", url: "https://example.com/mcp" },
        sse: { type: "sse", url: "https://example.com/sse" },
        stdio: { command: "git-mcp", enabledTools: ["log"] },
      });
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const mcp = new TabnineMcp({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
        fileContent: "{}",
      });
      expect(mcp.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("forDeletion", () => {
    it("should create an instance with empty content", () => {
      const mcp = TabnineMcp.forDeletion({
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: SETTINGS_FILE,
      });
      expect(mcp.getFileContent()).toBe("{}");
      expect(mcp.getJson()).toEqual({});
    });
  });
});
