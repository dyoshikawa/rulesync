import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DshMcp } from "./dsh-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const PATCH_PATH = [".dsh", "cordis.patch.yml"] as const;

// Upstream `apps/cli/config/examples/mcp-memory/mcp-reference-memory.cordis.yml`
// plus a non-MCP insert row and an id-targeted patch.
const USER_PATCH = [
  "# Machine-local preferences",
  "- insert:",
  "    - id: my-plugin",
  "      name: '@example/other-plugin'",
  "      config:",
  "        root: !!js process.cwd()",
  "    - id: memory-mcp-reference",
  "      name: '@deepseek-ai/dsh-mcp-client'",
  "      config:",
  "        serverName: reference_memory",
  "        transport: stdio",
  "        command: mcp-server-memory",
  "        cwd: !!js process.cwd()",
  "        env:",
  "          MEMORY_FILE_PATH: !!js process.env.MEMORY_FILE_PATH?.trim() || 'memory.jsonl'",
  "          PLAIN: value",
  "        toolCallTimeoutMs: 90000",
  "        reconnect:",
  "          enabled: false",
  "- id: web-settings",
  "  config:",
  "    port: 3080",
].join("\n");

const createRulesyncMcp = (testDir: string, mcpServers: Record<string, unknown>) =>
  new RulesyncMcp({
    outputRoot: testDir,
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("DshMcp", () => {
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

  it("targets the home-level cordis.patch.yml", () => {
    expect(DshMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".dsh",
      relativeFilePath: "cordis.patch.yml",
    });
  });

  it("is global-only", async () => {
    const rulesyncMcp = createRulesyncMcp(testDir, {});
    await expect(DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp })).rejects.toThrow(
      /global-only/,
    );
    await expect(DshMcp.fromFile({ outputRoot: testDir })).rejects.toThrow(/global-only/);
  });

  it("writes stdio and streamable-http rows into a new file", async () => {
    const rulesyncMcp = createRulesyncMcp(testDir, {
      github: {
        type: "stdio",
        command: ["npx", "-y"],
        args: ["@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "token" },
        cwd: "/work",
        disabled: true,
        failOnStartupError: true,
      },
      web: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      },
    });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getRelativeDirPath()).toBe(".dsh");
    expect(dshMcp.getFileContent()).toBe(
      [
        "- insert:",
        "    - id: mcp-github",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      disabled: true",
        "      config:",
        "        serverName: github",
        "        transport: stdio",
        "        command: npx",
        "        args:",
        "          - -y",
        "          - '@modelcontextprotocol/server-github'",
        "        env:",
        "          GITHUB_TOKEN: token",
        "        cwd: /work",
        "        failOnStartupError: true",
        "    - id: mcp-web",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: web",
        "        transport: streamable-http",
        "        url: https://example.com/mcp",
        "        headers:",
        "          Authorization: Bearer x",
        "",
      ].join("\n"),
    );
  });

  it("replaces MCP rows in place and preserves every other patch entry and !!js tag", async () => {
    await writeFileContent(join(testDir, ...PATCH_PATH), USER_PATCH);
    const rulesyncMcp = createRulesyncMcp(testDir, {
      reference_memory: { command: "mcp-server-memory", args: ["--new"] },
      extra: { url: "https://example.com/mcp" },
    });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getFileContent()).toBe(
      [
        "- insert:",
        "    - id: my-plugin",
        "      name: '@example/other-plugin'",
        "      config:",
        "        root: !!js process.cwd()",
        // The existing id is kept, so patches targeting it still apply.
        "    - id: memory-mcp-reference",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: reference_memory",
        "        transport: stdio",
        "        command: mcp-server-memory",
        "        args:",
        "          - --new",
        "    - id: mcp-extra",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: extra",
        "        transport: streamable-http",
        "        url: https://example.com/mcp",
        "- id: web-settings",
        "  config:",
        "    port: 3080",
        "",
      ].join("\n"),
    );
  });

  it("removes stale MCP rows and drops an insert entry they leave empty", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- insert:",
        "    - id: mcp-old",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: old, transport: stdio, command: old }",
        "- id: web-settings",
        "  disabled: true",
      ].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, {});

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getFileContent()).toBe(["- id: web-settings", "  disabled: true", ""].join("\n"));
  });

  it("appends a new insert entry when the file has no MCP rows", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      ["- id: web-settings", "  config:", "    port: !!js ctx.webStartup.port ?? 3080"].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, { local: { command: "server" } });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getFileContent()).toBe(
      [
        "- id: web-settings",
        "  config:",
        "    port: !!js ctx.webStartup.port ?? 3080",
        "- insert:",
        "    - id: mcp-local",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: local",
        "        transport: stdio",
        "        command: server",
        "",
      ].join("\n"),
    );
  });

  it("keeps each server in the entry that held it and appends new servers to a top-level insert", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- id: tools-group",
        "  insert:",
        "    - id: mcp-a",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: a, transport: stdio, command: old }",
        "- insert:",
        "    - id: mcp-b",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: b, transport: stdio, command: old }",
      ].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, {
      a: { command: "a" },
      b: { command: "b" },
      c: { command: "c" },
    });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    const entries = load(dshMcp.getFileContent()) as Array<{ id?: string; insert: unknown[] }>;
    expect(entries.map((entry) => entry.id)).toEqual(["tools-group", undefined]);
    expect(entries[0]?.insert).toEqual([
      expect.objectContaining({ id: "mcp-a", config: expect.objectContaining({ command: "a" }) }),
    ]);
    expect(entries[1]?.insert).toEqual([
      expect.objectContaining({ id: "mcp-b" }),
      expect.objectContaining({ id: "mcp-c" }),
    ]);
  });

  it("keeps an entry's other keys when its last MCP row is removed", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- id: tools-group",
        "  disabled: true",
        "  insert:",
        "    - id: mcp-old",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: old, transport: stdio, command: old }",
      ].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, {});

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getFileContent()).toBe(["- id: tools-group", "  disabled: true", ""].join("\n"));
  });

  it("keeps a reused id that a top-level patch entry targets", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- insert:",
        "    - id: mcp-a",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: a, transport: stdio, command: old }",
        "- id: mcp-a",
        "  disabled: true",
      ].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, { a: { command: "a" } });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    const [entry, patch] = load(dshMcp.getFileContent()) as Array<{
      id?: string;
      insert?: Array<{ id: string }>;
    }>;
    expect(entry?.insert?.map((row) => row.id)).toEqual(["mcp-a"]);
    expect(patch).toEqual({ id: "mcp-a", disabled: true });
  });

  it("never writes two rows with the same id", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- id: mcp-d",
        "  disabled: true",
        "- insert:",
        "    - id: mcp-c",
        "      name: '@example/other-plugin'",
        "    - id: mcp-a",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: b, transport: stdio, command: old }",
      ].join("\n"),
    );
    const rulesyncMcp = createRulesyncMcp(testDir, {
      a: { command: "a" },
      b: { command: "b" },
      c: { command: "c" },
      d: { command: "d" },
    });

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    const [, entry] = load(dshMcp.getFileContent()) as Array<{
      insert: Array<{ id: string; config?: { serverName: string } }>;
    }>;
    expect(entry?.insert.map((row) => [row.id, row.config?.serverName])).toEqual([
      ["mcp-c", undefined],
      // b keeps the id of its existing row, so a falls back to a suffixed id.
      ["mcp-a", "b"],
      ["mcp-a-2", "a"],
      ["mcp-c-2", "c"],
      // `mcp-d` is the target of a top-level patch entry.
      ["mcp-d-2", "d"],
    ]);
  });

  it("leaves a file without MCP rows untouched when there are no servers", async () => {
    const content = "# Machine-local preferences\n- id: web-settings\n  config: { port: 3080 }\n";
    await writeFileContent(join(testDir, ...PATCH_PATH), content);
    const rulesyncMcp = createRulesyncMcp(testDir, {});

    const dshMcp = await DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true });

    expect(dshMcp.getFileContent()).toBe(content);
  });

  it("skips servers dsh cannot load, with a warning", async () => {
    const logger = createMockLogger();
    const rulesyncMcp = createRulesyncMcp(testDir, {
      "bad.name": { command: "server" },
      legacy: { type: "sse", url: "https://example.com/sse" },
      socket: { url: "wss://example.com/mcp" },
      ok: { command: "server" },
    });

    const dshMcp = await DshMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      global: true,
      logger,
    });

    expect(dshMcp.getFileContent()).toContain("serverName: ok");
    expect(dshMcp.getFileContent()).not.toMatch(/bad\.name|legacy|socket/);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it("refuses to overwrite a file whose root is not a list", async () => {
    await writeFileContent(join(testDir, ...PATCH_PATH), "key: value\n");
    const rulesyncMcp = createRulesyncMcp(testDir, { ok: { command: "server" } });

    await expect(
      DshMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: true }),
    ).rejects.toThrow(/must be a YAML list/);
  });

  it("imports MCP rows, dropping !!js map values and keeping dsh-only fields in the dsh block", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- insert:",
        "    - id: memory-mcp-reference",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: reference_memory",
        "        transport: stdio",
        "        command: mcp-server-memory",
        "        env:",
        "          MEMORY_FILE_PATH: !!js process.env.MEMORY_FILE_PATH?.trim() || 'memory.jsonl'",
        "          PLAIN: value",
        "        headers:",
        "          Ignored: !!js 'x'",
        "        toolCallTimeoutMs: 90000",
        "        reconnect:",
        "          enabled: false",
      ].join("\n"),
    );

    const dshMcp = await DshMcp.fromFile({ outputRoot: testDir, global: true });
    const imported = JSON.parse(dshMcp.toRulesyncMcp().getFileContent());

    expect(imported.mcpServers).toEqual({
      reference_memory: {
        type: "stdio",
        command: "mcp-server-memory",
        env: { PLAIN: "value" },
      },
    });
    expect(imported.dsh.mcpServers.reference_memory).toEqual({
      type: "stdio",
      command: "mcp-server-memory",
      env: { PLAIN: "value" },
      toolCallTimeoutMs: 90000,
      reconnect: { enabled: false },
    });
  });

  it("skips importing a row whose core or dsh-only fields hold a !!js expression", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        USER_PATCH,
        "- insert:",
        "    - id: mcp-args",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: args, transport: stdio, command: server, args: [a, !!js 'b'] }",
        "    - id: mcp-toggle",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      disabled: !!js process.env.CI === '1'",
        "      config: { serverName: toggle, transport: stdio, command: server }",
        "    - id: mcp-remote",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: remote, transport: streamable-http, url: !!js 'https://x' }",
        "    - id: mcp-transport",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: transport, transport: !!js 'stdio', command: server }",
        "    - id: mcp-retry",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config:",
        "        serverName: retry",
        "        transport: stdio",
        "        command: server",
        "        reconnect: { enabled: true, maxAttempts: !!js 3 + 1 }",
        "    - id: mcp-dynamic",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: !!js 'dynamic', transport: stdio, command: server }",
        "    - id: mcp-plain",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      config: { serverName: plain, transport: stdio, command: server }",
      ].join("\n"),
    );
    const logger = createMockLogger();

    const dshMcp = await DshMcp.fromFile({ outputRoot: testDir, global: true, logger });
    const imported = JSON.parse(dshMcp.toRulesyncMcp().getFileContent());

    // reference_memory has `cwd: !!js process.cwd()`.
    expect(Object.keys(imported.mcpServers)).toEqual(["plain"]);
    expect(logger.warn).toHaveBeenCalledTimes(7);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"reference_memory"'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("`reconnect`"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"mcp-dynamic"'));
  });

  it("imports a streamable-http row as canonical http", async () => {
    await writeFileContent(
      join(testDir, ...PATCH_PATH),
      [
        "- insert:",
        "    - id: mcp-web",
        "      name: '@deepseek-ai/dsh-mcp-client'",
        "      disabled: true",
        "      config:",
        "        serverName: web",
        "        transport: streamable-http",
        "        url: https://example.com/mcp",
        "        headers: { Authorization: Bearer x }",
      ].join("\n"),
    );

    const dshMcp = await DshMcp.fromFile({ outputRoot: testDir, global: true });
    const imported = JSON.parse(dshMcp.toRulesyncMcp().getFileContent());

    expect(imported.mcpServers).toEqual({
      web: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
        disabled: true,
      },
    });
    expect(imported.dsh).toBeUndefined();
  });

  it("is never deleted", () => {
    const dshMcp = DshMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".dsh",
      relativeFilePath: "cordis.patch.yml",
      global: true,
    });
    expect(dshMcp.isDeletable()).toBe(false);
  });
});
