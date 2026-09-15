import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_MCP_SCHEMA_URL } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CrushMcp } from "./crush-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const serversOf = (mcp: CrushMcp): unknown => mcp.getJson().mcp;

describe("CrushMcp", () => {
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

  const projectConfigPath = () => join(testDir, "crush.json");
  const hiddenConfigPath = () => join(testDir, ".crush.json");

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  describe("getSettablePaths", () => {
    it("should point to crush.json in project mode", () => {
      expect(CrushMcp.getSettablePaths({ global: false })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
    });

    it("should point to .config/crush/crush.json in global mode", () => {
      expect(CrushMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "crush"),
        relativeFilePath: "crush.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (the user's primary Crush config)", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert stdio servers to type/command/args/env", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: { command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: { type: "stdio", command: "fs-server", args: ["--root", "."], env: { TOKEN: "x" } },
      });
    });

    it("should convert remote servers to http/sse with url and headers", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          plain: { url: "https://example.com/mcp" },
          streamable: { type: "streamable-http", url: "https://example.com/mcp" },
          events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        plain: { type: "http", url: "https://example.com/mcp" },
        streamable: { type: "http", url: "https://example.com/mcp" },
        events: { type: "sse", url: "https://example.com/sse", headers: { A: "b" } },
      });
    });

    it("should carry disabled, tool filters, timeout and the Crush-only keys", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          fs: {
            command: "fs",
            disabled: true,
            disabledTools: ["rm"],
            enabledTools: ["ls"],
            timeout: 20,
            sessionless: true,
            oauth: true,
            oauth_client_id: "id",
          },
        }),
      });

      expect(serversOf(mcp)).toEqual({
        fs: {
          type: "stdio",
          command: "fs",
          disabled: true,
          disabled_tools: ["rm"],
          enabled_tools: ["ls"],
          timeout: 20,
          sessionless: true,
          oauth: true,
          oauth_client_id: "id",
        },
      });
    });

    it("should warn-and-skip servers Crush cannot run", async () => {
      const logger = createMockLogger();
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({
          noTransport: { env: { A: "b" } },
          ws: { url: "ws://example.com/mcp" },
          ok: { command: "fs" },
        }),
        logger,
      });

      expect(serversOf(mcp)).toEqual({ ok: { type: "stdio", command: "fs" } });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should preserve unrelated top-level keys and rebuild the mcp block", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({
          $schema: "https://charm.land/crush.json",
          providers: { anthropic: { api_key: "$ANTHROPIC_API_KEY" } },
          mcp: { stale: { type: "stdio", command: "old" } },
        }),
      );

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      expect(mcp.getJson()).toEqual({
        $schema: "https://charm.land/crush.json",
        providers: { anthropic: { api_key: "$ANTHROPIC_API_KEY" } },
        mcp: { fs: { type: "stdio", command: "fs" } },
      });
    });

    it("should write into an existing .crush.json instead of crush.json", async () => {
      await writeFileContent(hiddenConfigPath(), JSON.stringify({ options: { debug: true } }));

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
      });

      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      expect(mcp.getJson()).toEqual({
        options: { debug: true },
        mcp: { fs: { type: "stdio", command: "fs" } },
      });
    });

    it("should warn when the crush.json twin still carries mcp entries", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { stale: { type: "stdio", command: "stale" } } }),
      );
      await writeFileContent(hiddenConfigPath(), JSON.stringify({ options: { debug: true } }));
      const logger = createMockLogger();

      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        logger,
      });

      // Only .crush.json is written; the stale server in crush.json is reported
      // because Crush keeps reading it.
      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      expect(serversOf(mcp)).toEqual({ fs: { type: "stdio", command: "fs" } });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"mcp"'));
    });

    it("should target ~/.config/crush/crush.json in global mode", async () => {
      const mcp = await CrushMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(join(".config", "crush"));
      expect(mcp.getRelativeFilePath()).toBe("crush.json");
    });

    it("should fail closed on an unparseable existing config", async () => {
      await writeFileContent(projectConfigPath(), "{ not json");

      await expect(
        CrushMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: buildRulesyncMcp({ fs: { command: "fs" } }),
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromFile", () => {
    it("should read an existing config", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { fs: { type: "stdio", command: "fs" } } }),
      );

      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(serversOf(mcp)).toEqual({ fs: { type: "stdio", command: "fs" } });
    });

    it("should merge both twins the way Crush does, .crush.json on top", async () => {
      await writeFileContent(
        projectConfigPath(),
        JSON.stringify({ mcp: { a: { command: "a" }, shared: { command: "old", timeout: 5 } } }),
      );
      await writeFileContent(
        hiddenConfigPath(),
        JSON.stringify({ mcp: { b: { command: "b" }, shared: { command: "new" } } }),
      );

      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getRelativeFilePath()).toBe(".crush.json");
      // Crush reads every server of both files, so an import does too.
      expect(serversOf(mcp)).toEqual({
        a: { command: "a" },
        b: { command: "b" },
        shared: { command: "new", timeout: 5 },
      });
    });

    it("should default to an empty document when the file is missing", async () => {
      const mcp = await CrushMcp.fromFile({ outputRoot: testDir });
      expect(mcp.getJson()).toEqual({});
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert back to canonical servers without leaking Crush's own keys", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: JSON.stringify({
          providers: { anthropic: {} },
          mcp: {
            fs: { type: "stdio", command: "fs", args: ["--root", "."], disabled_tools: ["rm"] },
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              enabled_tools: ["a"],
              oauth_token: "secret",
              sessionless: true,
            },
          },
        }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          fs: { command: "fs", args: ["--root", "."], disabledTools: ["rm"] },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            enabledTools: ["a"],
            sessionless: true,
          },
        },
      });
    });

    it("should yield empty servers when the config has no mcp block", () => {
      const mcp = new CrushMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
        fileContent: "{}",
      });
      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers).toEqual({});
    });
  });

  describe("forDeletion", () => {
    it("should return a well-formed instance", () => {
      const mcp = CrushMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "crush.json",
      });
      expect(mcp.getJson()).toEqual({ mcp: {} });
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});
