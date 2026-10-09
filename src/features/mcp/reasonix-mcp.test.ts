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

  // Rulesync owns the whole `plugins` key, so a field it does not carry cannot
  // just be written by hand instead — it is deleted from a hand-written
  // `reasonix.toml` on the next generate, and for these two that silently
  // changes how the server runs.
  describe("plugin scheduling fields round-trip", () => {
    // `browser` is a name Reasonix's known-stateful substring list catches, so
    // `parallel` here is the value that overrides a default rather than restating
    // it — the case where dropping the key would change how the server runs.
    it("should export concurrency and auto_start", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            browser: {
              command: "reasonix-plugin-browser",
              concurrency: "parallel",
              auto_start: false,
            },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0]).toMatchObject({
        name: "browser",
        concurrency: "parallel",
        auto_start: false,
      });
    });

    it("should import concurrency and auto_start from an existing [[plugins]] entry", () => {
      const fileContent = [
        "[[plugins]]",
        'name = "browser"',
        'command = "reasonix-plugin-browser"',
        'concurrency = "parallel"',
        "auto_start = false",
      ].join("\n");

      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent,
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(parsed.mcpServers.browser.concurrency).toBe("parallel");
      expect(parsed.mcpServers.browser.disabled).toBe(true);
      expect(parsed.mcpServers.browser).not.toHaveProperty("auto_start");
    });

    // `false` is the value that carries the instruction here, so a truthiness
    // filter anywhere on either path would drop exactly the one worth keeping.
    it("should keep both concurrency and an auto_start of false through export then import", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            lazy: { command: "reasonix-plugin-lazy", auto_start: false, concurrency: "serial" },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(roundTripped.mcpServers.lazy.disabled).toBe(true);
      // `lazy` is not a name Reasonix's stateful list catches, so this `serial` is
      // the only thing standing between the server and the parallel path: losing
      // it on the trip would silently undo the author's containment choice.
      expect(roundTripped.mcpServers.lazy.concurrency).toBe("serial");
    });
  });

  // Reasonix decodes these into a `string` / `*bool`, and a TOML type mismatch
  // fails the load of the whole `reasonix.toml`, so a bad value is dropped with a
  // warning instead of being passed through.
  describe("plugin scheduling field validation", () => {
    const exportServer = async (server: Record<string, unknown>) => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { srv: { command: "reasonix-plugin-srv", ...server } },
        }),
      });
      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
      return { plugin: parsed.plugins[0], logger };
    };

    it.each([["serial"], ["parallel"], [" Serial "], ["PARALLEL"]])(
      "should write a concurrency of %j as authored",
      async (concurrency) => {
        const { plugin, logger } = await exportServer({ concurrency });

        expect(plugin.concurrency).toBe(concurrency);
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );

    it.each([[true], [false]])("should write an auto_start of %j", async (autoStart) => {
      const { plugin, logger } = await exportServer({ auto_start: autoStart });

      expect(plugin.auto_start).toBe(autoStart);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([["false"], [0], ["yes"], [null]])(
      "should drop a non-boolean auto_start of %j with a warning",
      async (autoStart) => {
        const { plugin, logger } = await exportServer({ auto_start: autoStart });

        expect(plugin).not.toHaveProperty("auto_start");
        expect(plugin.command).toBe("reasonix-plugin-srv");
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('dropping "auto_start" from "srv"'),
        );
      },
    );

    it.each([[1], [true], [["serial"]], [null]])(
      "should drop a non-string concurrency of %j with a warning",
      async (concurrency) => {
        const { plugin, logger } = await exportServer({ concurrency });

        expect(plugin).not.toHaveProperty("concurrency");
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('dropping "concurrency" from "srv"'),
        );
      },
    );

    it("should drop an unknown concurrency string with a warning", async () => {
      const { plugin, logger } = await exportServer({ concurrency: "sequential" });

      expect(plugin).not.toHaveProperty("concurrency");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ignores "sequential"'));
    });

    it("should keep a valid field when its sibling is dropped", async () => {
      const { plugin } = await exportServer({ concurrency: "serial", auto_start: "no" });

      expect(plugin.concurrency).toBe("serial");
      expect(plugin).not.toHaveProperty("auto_start");
    });

    // Reasonix decodes the timeouts into `int` / `map[string]int`, and
    // smol-toml writes a fractional or unsafe-integer number as a TOML float,
    // which BurntSushi/toml refuses to decode into an `int`.
    it("should write integer timeout fields as authored", async () => {
      const { plugin, logger } = await exportServer({
        startup_timeout_seconds: 0,
        call_timeout_seconds: 120,
        tool_timeout_seconds: { slow_tool: 600, fast_tool: 5 },
      });

      expect(plugin.startup_timeout_seconds).toBe(0);
      expect(plugin.call_timeout_seconds).toBe(120);
      expect(plugin.tool_timeout_seconds).toEqual({ slow_tool: 600, fast_tool: 5 });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["startup_timeout_seconds", "30"],
      ["startup_timeout_seconds", 1.5],
      ["call_timeout_seconds", 1e20],
      ["call_timeout_seconds", true],
      ["call_timeout_seconds", null],
      ["tool_timeout_seconds", 30],
      ["tool_timeout_seconds", [30]],
      ["tool_timeout_seconds", { slow_tool: "600" }],
      ["tool_timeout_seconds", { slow_tool: 2.5 }],
    ])("should drop a %s of %j with a warning", async (field, value) => {
      const { plugin, logger } = await exportServer({ [field]: value });

      expect(plugin).not.toHaveProperty(field);
      expect(plugin.command).toBe("reasonix-plugin-srv");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`dropping "${field}" from "srv"`),
      );
    });
  });
  describe("canonical disabled and auto_start", () => {
    const exportServers = async (mcpServers: Record<string, unknown>) => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers }),
      });
      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      return {
        reasonixMcp,
        plugins: (smolToml.parse(reasonixMcp.getFileContent()) as any).plugins,
      };
    };

    // Without the mapping a canonical `disabled: true` server was written as an
    // enabled plugin, since Reasonix reads a missing `auto_start` as "on".
    it("should write a canonical disabled: true as auto_start = false", async () => {
      const { plugins } = await exportServers({ off: { command: "off-mcp", disabled: true } });

      expect(plugins[0].auto_start).toBe(false);
      expect(plugins[0]).not.toHaveProperty("disabled");
    });

    it("should leave auto_start out for a server that is not disabled", async () => {
      const { plugins } = await exportServers({
        on: { command: "on-mcp" },
        explicit: { command: "explicit-mcp", disabled: false },
      });

      expect(plugins[0]).not.toHaveProperty("auto_start");
      expect(plugins[1]).not.toHaveProperty("auto_start");
    });

    // Fail-safe: a server stopped for every tool must not keep starting in
    // Reasonix because of a stale tool-specific `true`.
    it("should let canonical disabled win over an authored auto_start with a warning", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            on: { command: "on-mcp", disabled: true, auto_start: true },
            typo: { command: "typo-mcp", disabled: true, auto_start: "yes" },
          },
        }),
      });
      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      const plugins = (smolToml.parse(reasonixMcp.getFileContent()) as any).plugins;

      expect(plugins[0].auto_start).toBe(false);
      expect(plugins[1].auto_start).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"on" is disabled, so "auto_start" is written as false'),
      );
    });

    it("should write an authored auto_start = false for a server that is not disabled", async () => {
      const { plugins } = await exportServers({
        srv: { command: "srv-mcp", auto_start: false },
      });

      expect(plugins[0].auto_start).toBe(false);
    });

    // Import keeps no `auto_start` passthrough: a leftover `false` would shadow a
    // later `disabled: false` edit on the next generate.
    it("should import auto_start = false as disabled: true without a passthrough", () => {
      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: [
          "[[plugins]]",
          'name = "off"',
          'command = "off-mcp"',
          "auto_start = false",
          "",
          "[[plugins]]",
          'name = "on"',
          'command = "on-mcp"',
          "auto_start = true",
        ].join("\n"),
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(parsed.mcpServers.off.disabled).toBe(true);
      expect(parsed.mcpServers.off).not.toHaveProperty("auto_start");
      expect(parsed.mcpServers.on).not.toHaveProperty("disabled");
      expect(parsed.mcpServers.on).not.toHaveProperty("auto_start");
    });

    it("should round-trip a disabled server through export then import", async () => {
      const { reasonixMcp } = await exportServers({ off: { command: "off-mcp", disabled: true } });

      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(roundTripped.mcpServers.off.disabled).toBe(true);
    });

    it("should re-enable an imported server once canonical disabled is turned off", async () => {
      const imported = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: [
          "[[plugins]]",
          'name = "srv"',
          'command = "srv-mcp"',
          "auto_start = false",
        ].join("\n"),
      });
      const canonical = JSON.parse(imported.toRulesyncMcp().getFileContent());
      canonical.mcpServers.srv.disabled = false;

      const { plugins } = await exportServers(canonical.mcpServers);

      expect(plugins[0]).not.toHaveProperty("auto_start");
    });
  });

  describe("disabled_tools", () => {
    it("should write canonical disabledTools as disabled_tools", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            fs: { command: "fs-mcp", disabledTools: ["write_file", "delete_file"] },
            empty: { command: "empty-mcp", disabledTools: [] },
          },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0].disabled_tools).toEqual(["write_file", "delete_file"]);
      expect(parsed.plugins[0]).not.toHaveProperty("disabledTools");
      expect(parsed.plugins[1]).not.toHaveProperty("disabled_tools");
    });

    it("should import disabled_tools as canonical disabledTools", () => {
      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: [
          "[[plugins]]",
          'name = "fs"',
          'command = "fs-mcp"',
          'disabled_tools = ["write_file"]',
        ].join("\n"),
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(parsed.mcpServers.fs.disabledTools).toEqual(["write_file"]);
      expect(parsed.mcpServers.fs).not.toHaveProperty("disabled_tools");
    });

    // Dropping the whole list over one bad entry would lift every restriction
    // on the other targets.
    it("should keep the string entries of a disabled_tools list holding other types", () => {
      const reasonixMcp = new ReasonixMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "reasonix.toml",
        fileContent: [
          "[[plugins]]",
          'name = "fs"',
          'command = "fs-mcp"',
          'disabled_tools = ["write_file", 1]',
        ].join("\n"),
      });

      const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      expect(parsed.mcpServers.fs.disabledTools).toEqual(["write_file"]);
    });

    it("should drop blank disabledTools entries with a warning", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fs: { command: "fs-mcp", disabledTools: ["write_file", " "] } },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0].disabled_tools).toEqual(["write_file"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('dropping blank "disabledTools" entries from "fs"'),
      );
    });
  });

  // Fields the CLI v2 line added to `[[plugins]]`. Rulesync rewrites the whole
  // `plugins` key, so a field missing from the allowlist is deleted on generate.
  describe("load and oauth_allow_missing_pkce_metadata", () => {
    it("should round-trip both fields through export then import", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              load: "always",
              oauth_allow_missing_pkce_metadata: true,
            },
          },
        }),
      });

      const logger = createMockLogger();
      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
      const roundTripped = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

      // It loosens OAuth and only works from the user config, so it is named.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"remote" sets "oauth_allow_missing_pkce_metadata"'),
      );
      expect(parsed.plugins[0]).toMatchObject({
        load: "always",
        oauth_allow_missing_pkce_metadata: true,
      });
      expect(roundTripped.mcpServers.remote).toMatchObject({
        load: "always",
        oauth_allow_missing_pkce_metadata: true,
      });
    });

    it("should not call the OAuth key project-only when writing the global config", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            remote: {
              type: "http",
              url: "https://example.com/mcp",
              oauth_allow_missing_pkce_metadata: true,
            },
          },
        }),
      });

      await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true, logger });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"remote" sets "oauth_allow_missing_pkce_metadata"'),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("project reasonix.toml"),
      );
    });

    it.each([
      ["load", 1],
      ["oauth_allow_missing_pkce_metadata", "true"],
    ])("should drop a %s of the wrong type with a warning", async (field, value) => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { srv: { command: "srv-mcp", [field]: value } },
        }),
      });

      const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        logger,
      });
      const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

      expect(parsed.plugins[0]).not.toHaveProperty(field);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`dropping "${field}" from "srv"`),
      );
    });
  });
});
