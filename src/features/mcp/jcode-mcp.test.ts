import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { JcodeMcp } from "./jcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

describe("JcodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should use .jcode/mcp.json in both scopes and never delete it", () => {
    expect(JcodeMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".jcode",
      relativeFilePath: "mcp.json",
    });
    expect(JcodeMcp.getSettablePaths({ global: true })).toEqual(JcodeMcp.getSettablePaths());
    const params = { outputRoot: testDir, relativeDirPath: ".jcode", relativeFilePath: "mcp.json" };
    expect(JcodeMcp.forDeletion(params).isDeletable()).toBe(false);
    expect(JcodeMcp.forDeletion({ ...params, global: true }).isDeletable()).toBe(false);
  });

  it("should write stdio and remote servers in jcode's shape", async () => {
    const logger = createMockLogger();
    const mcp = await JcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: buildRulesyncMcp({
        local: { command: ["npx", "-y", "pkg"], args: ["--flag"], env: { A: "${A}" }, cwd: "/x" },
        remote: { type: "http", url: "https://mcp.example.com/mcp", headers: { X: "y" } },
        legacy: { type: "sse", url: "https://mcp.example.com/sse", disabled: true },
        bare: { url: "https://mcp.example.com/bare" },
        socket: { type: "ws", url: "wss://mcp.example.com" },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        local: { command: "npx", args: ["-y", "pkg", "--flag"], env: { A: "${A}" } },
        remote: { type: "http", url: "https://mcp.example.com/mcp", headers: { X: "y" } },
        legacy: { type: "sse", url: "https://mcp.example.com/sse", disabled: true },
        bare: { url: "https://mcp.example.com/bare" },
      },
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((m) => m.includes('"socket"') && m.includes('"ws"'))).toBe(true);
    expect(warnings.some((m) => m.includes('"cwd"') && m.includes('"local"'))).toBe(true);
  });

  it("should preserve top-level keys and unknown keys of existing servers", async () => {
    await writeFileContent(
      join(testDir, ".jcode", "mcp.json"),
      JSON.stringify({
        servers: {
          browser: { command: "old", shared: false, timeout_secs: 120, enabled: false },
          stale: { command: "stale" },
        },
        extra: true,
      }),
    );
    const mcp = await JcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({ browser: { command: "playwright-mcp" } }),
    });

    // The historical `servers` key the file already used is kept (jcode
    // rejects a file that has both keys).
    expect(JSON.parse(mcp.getFileContent())).toEqual({
      servers: { browser: { shared: false, timeout_secs: 120, command: "playwright-mcp" } },
      extra: true,
    });
  });

  it("should import both server-map keys and fold enabled into disabled", async () => {
    await writeFileContent(
      join(testDir, ".jcode", "mcp.json"),
      JSON.stringify({
        servers: {
          a: { command: "run-a", args: ["x"], env: {}, shared: true, enabled: false },
          b: { command: "", type: "http", url: "https://b", timeout_secs: 9 },
        },
      }),
    );
    const mcp = await JcodeMcp.fromFile({ outputRoot: testDir });
    expect(mcp.toRulesyncMcp().getJson().mcpServers).toEqual({
      a: { command: "run-a", args: ["x"], disabled: true },
      b: { type: "http", url: "https://b" },
    });
  });

  it("should merge both server-map keys with a warning and write mcpServers only", async () => {
    await writeFileContent(
      join(testDir, ".jcode", "mcp.json"),
      JSON.stringify({
        servers: {
          legacy: { command: "a", shared: false },
          both: { command: "old", timeout_secs: 1 },
        },
        mcpServers: { both: { command: "new", timeout_secs: 2 } },
      }),
    );
    const logger = createMockLogger();
    const mcp = await JcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: buildRulesyncMcp({ legacy: { command: "a" }, both: { command: "b" } }),
    });
    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        legacy: { shared: false, command: "a" },
        both: { timeout_secs: 2, command: "b" },
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('both "mcpServers" and "servers"'),
    );

    const imported = await JcodeMcp.fromFile({ outputRoot: testDir });
    await writeFileContent(
      join(testDir, ".jcode", "mcp.json"),
      JSON.stringify({ servers: { x: { command: "x" } }, mcpServers: { y: { command: "y" } } }),
    );
    expect(Object.keys(imported.toRulesyncMcp().getJson().mcpServers)).toEqual(["legacy", "both"]);
    const both = await JcodeMcp.fromFile({ outputRoot: testDir });
    expect(Object.keys(both.toRulesyncMcp().getJson().mcpServers)).toEqual(["x", "y"]);
  });

  it("should normalize transport spellings the way jcode reads them", async () => {
    await writeFileContent(
      join(testDir, ".jcode", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          a: { type: " Streamable_HTTP ", url: "https://a" },
          b: { type: "SSE", url: "https://b" },
          c: { type: "carrier-pigeon", url: "https://c" },
        },
      }),
    );
    const imported = (await JcodeMcp.fromFile({ outputRoot: testDir })).toRulesyncMcp();
    expect(imported.getJson().mcpServers).toEqual({
      a: { type: "streamable-http", url: "https://a" },
      b: { type: "sse", url: "https://b" },
    });

    const regenerated = await JcodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({ a: { type: "streamable-http", url: "https://a" } }),
    });
    expect(JSON.parse(regenerated.getFileContent()).mcpServers).toEqual({
      a: { type: "streamable-http", url: "https://a" },
    });
  });

  it("should refuse a malformed file", async () => {
    await writeFileContent(join(testDir, ".jcode", "mcp.json"), "{ broken");
    await expect(
      JcodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp: buildRulesyncMcp({}) }),
    ).rejects.toThrow();
  });
});
