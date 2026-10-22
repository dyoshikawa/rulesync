import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { XumMcp } from "./xum-mcp.js";

describe("XumMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should use .xum/mcp.jsonc for both scopes", () => {
    for (const global of [false, true]) {
      expect(XumMcp.getSettablePaths({ global })).toEqual({
        relativeDirPath: ".xum",
        relativeFilePath: "mcp.jsonc",
      });
    }
  });

  it("should write stdio servers as shell command strings", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        memory: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
        },
        chrome: { command: "npx -y chrome-devtools-mcp@latest --headless" },
        quoted: { command: ["node", "server.js"], args: ["--name", "it's here"] },
        spaced: { command: ["/opt/my tools/srv", "--flag"] },
      }),
    });

    expect(xum.getRelativeDirPath()).toBe(".xum");
    expect(xum.getRelativeFilePath()).toBe("mcp.jsonc");
    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        memory: "npx -y @modelcontextprotocol/server-memory",
        chrome: "npx -y chrome-devtools-mcp@latest --headless",
        quoted: "node server.js --name 'it'\\''s here'",
        spaced: "'/opt/my tools/srv' --flag",
      },
    });
  });

  it("should use the object form for disabled servers and enabledTools", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        off: { command: "off-server", disabled: true },
        limited: { command: "npx", args: ["limited"], enabledTools: ["read"] },
      }),
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        off: { command: "off-server", disabled: true },
        limited: { command: "npx limited", toolAllowlist: ["read"] },
      },
    });
  });

  it("should write remote servers with their transport, URL and headers", async () => {
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        http: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        streamable: { type: "streamable-http", url: "https://example.com/stream" },
        sse: { type: "sse", url: "https://example.com/sse" },
        auto: { url: "https://example.com/auto" },
      }),
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        http: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer x" },
        },
        streamable: { transport: "http", url: "https://example.com/stream" },
        sse: { transport: "sse", url: "https://example.com/sse" },
        auto: { url: "https://example.com/auto" },
      },
    });
  });

  it("should skip websocket servers and warn about cwd it cannot express", async () => {
    const logger = createMockLogger();
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        ws: { type: "ws", url: "wss://example.com/ws" },
        withCwd: { command: "server", cwd: "/srv" },
      }),
      logger,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({ servers: { withCwd: "server" } });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((message) => message.includes('"ws"'))).toBe(true);
    expect(warnings.some((message) => message.includes("cwd"))).toBe(true);
  });

  it("should prefix stdio commands with shell-quoted env assignments", async () => {
    const logger = createMockLogger();
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        plain: { command: "npx", args: ["-y", "srv"], env: { FOO: "bar" } },
        quoted: {
          command: "server",
          env: { GREETING: "it's $HOME; rm -rf /", AUTH: "Bearer ${TOKEN}", EMPTY: "" },
        },
        off: { command: "off-server", env: { FOO: "bar" }, disabled: true },
        badName: { command: "server", env: { "BAD-NAME": "x", OK: "1" } },
      }),
      logger,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        plain: "FOO=bar npx -y srv",
        quoted: `GREETING='it'\\''s $HOME; rm -rf /' AUTH='Bearer '"\${TOKEN}" EMPTY='' server`,
        off: { command: "FOO=bar off-server", disabled: true },
        badName: "OK=1 server",
      },
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((message) => message.includes("BAD-NAME"))).toBe(true);
    expect(warnings.some((message) => message.includes("FOO"))).toBe(false);
  });

  it("should drop env with a warning when a prefix would not reach the server", async () => {
    const logger = createMockLogger();
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        list: { command: "cd x && srv", env: { A: "1" } },
        parenGroup: { command: "( srv )", env: { A: "1" } },
        group: { command: "{ srv; }", env: { A: "1" } },
        multiline: { command: "srv\nother", env: { A: "1" } },
        reserved: { command: "if true; then srv; fi", env: { A: "1" } },
        reservedArgv: { command: ["time", "srv"], env: { A: "1" } },
        quotedArg: { command: ["srv"], args: ["a;b"], env: { A: "1" } },
        quotedString: { command: "node -e 'a;b'", env: { A: "1" } },
        unclosedQuote: { command: "srv 'a", env: { A: "1" } },
        noEnv: { command: "cd x && srv" },
      }),
      logger,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: {
        list: "cd x && srv",
        parenGroup: "( srv )",
        group: "{ srv; }",
        multiline: "srv\nother",
        reserved: "if true; then srv; fi",
        reservedArgv: "time srv",
        quotedArg: "A=1 srv 'a;b'",
        quotedString: "A=1 node -e 'a;b'",
        unclosedQuote: "srv 'a",
        noEnv: "cd x && srv",
      },
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    for (const name of [
      "list",
      "parenGroup",
      "group",
      "multiline",
      "reserved",
      "reservedArgv",
      "unclosedQuote",
    ]) {
      expect(warnings.some((message) => message.includes(`"${name}" sets env, but`))).toBe(true);
    }
    expect(warnings.some((message) => message.includes('"quotedArg"'))).toBe(false);
    expect(warnings.some((message) => message.includes('"quotedString"'))).toBe(false);
    expect(warnings.some((message) => message.includes('"noEnv"'))).toBe(false);
  });

  it("should warn separately about unassignable names and non-string values", async () => {
    const logger = createMockLogger();
    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: {
        getMcpServers: () => ({
          srv: { command: "srv", env: { "BAD-NAME": "x", NUM: 1, OK: "1" } },
        }),
      } as never,
      logger,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({ servers: { srv: "OK=1 srv" } });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(
      warnings.some((message) => message.includes("BAD-NAME") && message.includes("variable name")),
    ).toBe(true);
    expect(
      warnings.some((message) => message.includes("NUM") && message.includes("not a string")),
    ).toBe(true);
  });

  it("should round-trip env written as an assignment prefix", async () => {
    const env = {
      GREETING: "it's $HOME; rm -rf /",
      AUTH: "Bearer ${TOKEN}",
      EMPTY: "",
      FOO: "a=b",
    };
    const generated = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        srv: { command: "npx", args: ["-y", "srv"], env },
        withOperatorArg: { command: "srv", args: ["a;b", '{"a":1}'], env: { A: "1" } },
      }),
    });
    await writeFileContent(join(testDir, ".xum", "mcp.jsonc"), generated.getFileContent());

    const imported = await XumMcp.fromFile({ outputRoot: testDir });

    expect(imported.toRulesyncMcp().getMcpServers()).toEqual({
      srv: { command: "npx", args: ["-y", "srv"], env },
      withOperatorArg: { command: "srv 'a;b' '{\"a\":1}'", env: { A: "1" } },
    });
  });

  it("should keep a command string whole when its assignment prefix is not in the shape rulesync writes", async () => {
    await writeFileContent(
      join(testDir, ".xum", "mcp.jsonc"),
      JSON.stringify({
        servers: {
          github:
            'GITHUB_PERSONAL_ACCESS_TOKEN="$(cat ~/.config/github-mcp/token)" docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
          onlyAssignment: "FOO=bar",
          newline: "FOO=bar\nsrv",
          list: "FOO=bar cd x && srv",
        },
      }),
    );

    const xum = await XumMcp.fromFile({ outputRoot: testDir });

    expect(xum.toRulesyncMcp().getMcpServers()).toEqual({
      github: {
        command:
          'GITHUB_PERSONAL_ACCESS_TOKEN="$(cat ~/.config/github-mcp/token)" docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
      },
      onlyAssignment: { command: "FOO=bar" },
      newline: { command: "FOO=bar\nsrv" },
      list: { command: "FOO=bar cd x && srv" },
    });
  });

  it("should keep other top-level keys such as enabledPluginServers", async () => {
    await writeFileContent(
      join(testDir, ".xum", "mcp.jsonc"),
      '{\n  // managed by Xum\n  "servers": { "old": "old-server" },\n  "enabledPluginServers": ["plugin:0123:coder"],\n}\n',
    );

    const xum = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ fresh: { command: "fresh" } }),
      global: true,
    });

    expect(parseJsonc(xum.getFileContent())).toEqual({
      servers: { fresh: "fresh" },
      enabledPluginServers: ["plugin:0123:coder"],
    });
    expect(xum.isDeletable()).toBe(false);
  });

  it("should be deletable in project mode only", async () => {
    const project = await XumMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({}),
    });
    expect(project.isDeletable()).toBe(true);
  });

  it("should import Xum servers back into the canonical shape", async () => {
    await writeFileContent(
      join(testDir, ".xum", "mcp.jsonc"),
      JSON.stringify({
        servers: {
          memory: "npx -y @modelcontextprotocol/server-memory",
          piped: "cat config.json | my-server",
          off: { command: "off-server", disabled: true, toolAllowlist: ["read"] },
          remote: {
            transport: "sse",
            url: "https://example.com/sse",
            headers: { Authorization: "Bearer x", Secret: { secret: "KEY" } },
          },
          auto: { transport: "auto", url: "https://example.com/auto" },
        },
      }),
    );

    const xum = await XumMcp.fromFile({ outputRoot: testDir });

    expect(xum.toRulesyncMcp().getMcpServers()).toEqual({
      memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
      piped: { command: "cat config.json | my-server" },
      off: { command: "off-server", disabled: true, enabledTools: ["read"] },
      remote: {
        type: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer x" },
      },
      auto: { url: "https://example.com/auto" },
    });
  });

  it("should refuse a file that does not parse", async () => {
    await writeFileContent(join(testDir, ".xum", "mcp.jsonc"), "{ not json");

    await expect(
      XumMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({ a: { command: "a" } }),
      }),
    ).rejects.toThrow();
  });
});
