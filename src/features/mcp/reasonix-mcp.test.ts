import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReasonixMcp } from "./reasonix-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ReasonixMcp", () => {
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

  it("should export rulesync MCP servers as Reasonix [[plugins]] and preserve config keys", async () => {
    await writeFileContent(
      join(testDir, "reasonix.toml"),
      ['default_model = "deepseek"', "", "[ui]", 'theme = "dark"'].join("\n"),
    );

    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
            env: { ROOT: "/path" },
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

    expect(parsed.default_model).toBe("deepseek");
    expect(parsed.ui.theme).toBe("dark");
    expect(parsed.plugins).toMatchObject([
      {
        name: "filesystem",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
        env: { ROOT: "/path" },
      },
      {
        name: "remote",
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    ]);
  });

  it("should import Reasonix [[plugins]] into rulesync mcpServers", () => {
    const fileContent = [
      'default_model = "deepseek"',
      "",
      "[[plugins]]",
      'name = "filesystem"',
      'type = "stdio"',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-filesystem", "/path"]',
      "",
      "[[plugins]]",
      'name = "remote"',
      'type = "http"',
      'url = "https://example.com/mcp"',
      'headers = { Authorization = "Bearer token" }',
    ].join("\n");

    const reasonixMcp = new ReasonixMcp({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
      fileContent,
    });

    const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

    expect(parsed.mcpServers).toMatchObject({
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      },
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  it("should default the transport to stdio for command-based servers", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          local: { command: "node", args: ["server.js"] },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
    expect(parsed.plugins[0]).toMatchObject({ name: "local", type: "stdio", command: "node" });
  });

  it("should write the sse transport verbatim, since Reasonix implements it", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          legacy: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
    // Collapsing it onto `http` pointed Reasonix at Streamable HTTP, and the
    // server could not connect; v1.17.18 re-implemented the legacy transport.
    expect(parsed.plugins[0].type).toBe("sse");
  });

  it("should skip a server whose transport Reasonix does not implement", async () => {
    // Reasonix implements stdio/http/sse; writing `ws` would produce a `type`
    // its loader rejects.
    const logger = createMockLogger();
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          socket: { type: "ws", url: "wss://example.com/mcp" },
          kept: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      logger,
    });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

    expect(parsed.plugins.map((plugin: any) => plugin.name)).toEqual(["kept"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ws" transport'));
  });

  it("should skip a websocket URL that carries no explicit transport", async () => {
    const logger = createMockLogger();
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: { socket: { url: "wss://example.com/mcp" } },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      logger,
    });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

    // Guessing `http` from the URL would write a config that cannot connect.
    expect(parsed.plugins ?? []).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ws" transport'));
  });

  it("should round-trip the sse transport through generate then import", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: { legacy: { type: "sse", url: "https://example.com/sse" } },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const imported = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

    expect(imported.mcpServers.legacy).toMatchObject({
      type: "sse",
      url: "https://example.com/sse",
    });
  });

  it("should write the global config to .reasonix/config.toml", () => {
    expect(ReasonixMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".reasonix",
      relativeFilePath: "config.toml",
    });
    expect(ReasonixMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
    });
  });

  it("should not be deletable because the config file is shared", () => {
    const reasonixMcp = ReasonixMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
    });

    expect(reasonixMcp.isDeletable()).toBe(false);
  });

  describe("the retired trusted_read_only_tools field", () => {
    it("should not write the retired trusted_read_only_tools back out", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            search: {
              type: "stdio",
              command: "reasonix-plugin-search",
              trusted_read_only_tools: ["search"],
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      // Retired in v1.17.18: Reasonix ignores it and strips it on its next
      // save, so re-emitting it only makes the two writers churn.
      expect(parsed.plugins[0]).toMatchObject({
        name: "search",
        command: "reasonix-plugin-search",
      });
      expect(parsed.plugins[0].trusted_read_only_tools).toBeUndefined();
    });

    it("should say so when a canonical config still carries the retired field", async () => {
      // Reachable when an older rulesync imported it before this adapter
      // stopped. Rulesync owns `plugins`, so staying silent would take it out of
      // the user's file without a word.
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            search: { command: "reasonix-plugin-search", trusted_read_only_tools: ["search"] },
          },
        }),
      });

      await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, logger });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('dropping "trusted_read_only_tools"'),
      );
    });

    it("should leave the retired trusted_read_only_tools out of the canonical config", () => {
      const fileContent = [
        "[[plugins]]",
        'name = "search"',
        'command = "reasonix-plugin-search"',
        'trusted_read_only_tools = ["search"]',
      ].join("\n");

      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent,
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      // The canonical `mcpServers` is shared by every MCP target, so importing a
      // Reasonix-only dead key would put it into .mcp.json, .cursor/mcp.json and
      // the rest. Rulesync owns `plugins`, so the next generate drops it from
      // the file as well — which loses nothing Reasonix still reads.
      expect(parsed.mcpServers.search.trusted_read_only_tools).toBeUndefined();
      expect(parsed.mcpServers.search.command).toBe("reasonix-plugin-search");
    });

    it("should drop the retired key on a generate, leaving nothing to import", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            example: {
              command: "reasonix-plugin-example",
              trusted_read_only_tools: ["search", "list_files"],
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      // Neither direction carries it, so the round trip loses it by design
      // rather than re-writing a key Reasonix ignores.
      expect(roundTripped.mcpServers.example.trusted_read_only_tools).toBeUndefined();
    });
  });

  describe("plugin timeout fields round-trip", () => {
    it("should round-trip startup_timeout_seconds, which overrides the global cap", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            slow: {
              command: "reasonix-plugin-slow",
              startup_timeout_seconds: 60,
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0]).toMatchObject({
        name: "slow",
        startup_timeout_seconds: 60,
      });

      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());
      expect(roundTripped.mcpServers.slow.startup_timeout_seconds).toBe(60);
    });

    it("should export a startup_timeout_seconds of 0 rather than dropping it as falsy", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            slow: { command: "reasonix-plugin-slow", startup_timeout_seconds: 0 },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0].startup_timeout_seconds).toBe(0);
    });

    it("should preserve an imported startup_timeout_seconds of 0, which defers to the global cap", () => {
      const fileContent = [
        "[[plugins]]",
        'name = "slow"',
        'command = "reasonix-plugin-slow"',
        "startup_timeout_seconds = 0",
      ].join("\n");

      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent,
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      // 0 is meaningful (fall back to `mcp_startup_timeout_seconds`), so it must
      // survive rather than be dropped as falsy.
      expect(parsed.mcpServers.slow.startup_timeout_seconds).toBe(0);
    });

    it("should export call_timeout_seconds (per-server) and tool_timeout_seconds (per-tool table)", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            media: {
              command: "reasonix-plugin-media",
              call_timeout_seconds: 600,
              tool_timeout_seconds: { generate_video: 1800 },
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0]).toMatchObject({
        name: "media",
        call_timeout_seconds: 600,
        tool_timeout_seconds: { generate_video: 1800 },
      });
    });

    it("should import both timeout fields from an existing [[plugins]] entry", () => {
      const fileContent = [
        "[[plugins]]",
        'name = "media"',
        'command = "reasonix-plugin-media"',
        "call_timeout_seconds = 600",
        "tool_timeout_seconds = { generate_video = 1800 }",
      ].join("\n");

      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent,
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(parsed.mcpServers.media.call_timeout_seconds).toBe(600);
      expect(parsed.mcpServers.media.tool_timeout_seconds).toEqual({ generate_video: 1800 });
    });

    it("should round-trip both timeout fields through export then import unchanged", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            media: {
              command: "reasonix-plugin-media",
              call_timeout_seconds: 300,
              tool_timeout_seconds: { generate_video: 1800, transcribe: 120 },
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(roundTripped.mcpServers.media.call_timeout_seconds).toBe(300);
      expect(roundTripped.mcpServers.media.tool_timeout_seconds).toEqual({
        generate_video: 1800,
        transcribe: 120,
      });
    });
  });
});
