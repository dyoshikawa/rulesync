import { describe, expect, it, vi } from "vitest";

import type { Logger } from "../../utils/logger.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";

describe("declaresNoTransport", () => {
  it("is true only when nothing names a way to reach the server", () => {
    expect(declaresNoTransport({})).toBe(true);
    expect(declaresNoTransport({ disabled: true, enabledTools: ["read"] })).toBe(true);
    // Fields that cannot reach a server on their own still leave it unreachable.
    expect(declaresNoTransport({ args: ["--port"], env: { TOKEN: "x" } })).toBe(true);
  });

  it("is false as soon as any transport field is present", () => {
    expect(declaresNoTransport({ type: "stdio" })).toBe(false);
    expect(declaresNoTransport({ transport: "http" })).toBe(false);
    expect(declaresNoTransport({ command: "npx" })).toBe(false);
    expect(declaresNoTransport({ url: "https://example.com" })).toBe(false);
    expect(declaresNoTransport({ httpUrl: "https://example.com" })).toBe(false);
  });
});

describe("isRemoteMcpServer", () => {
  it("recognizes every remote transport spelling, through type and transport alike", () => {
    for (const transport of ["sse", "http", "streamable-http", "ws"] as const) {
      expect(isRemoteMcpServer({ type: transport })).toBe(true);
      expect(isRemoteMcpServer({ transport })).toBe(true);
    }
  });

  it("treats a stated url as remote, httpUrl included", () => {
    expect(isRemoteMcpServer({ url: "https://example.com/mcp" })).toBe(true);
    expect(isRemoteMcpServer({ httpUrl: "https://example.com/mcp" })).toBe(true);
  });

  it("leaves a spawned server local", () => {
    expect(isRemoteMcpServer({ command: "npx", args: ["-y", "server"] })).toBe(false);
    expect(isRemoteMcpServer({ type: "stdio" })).toBe(false);
    expect(isRemoteMcpServer({ type: "local" })).toBe(false);
    expect(isRemoteMcpServer({})).toBe(false);
  });
});

describe("resolveRemoteMcpUrl", () => {
  it("prefers url, falls back to httpUrl", () => {
    expect(resolveRemoteMcpUrl({ url: "https://a", httpUrl: "https://b" })).toBe("https://a");
    expect(resolveRemoteMcpUrl({ httpUrl: "https://b" })).toBe("https://b");
  });

  it("reports an empty url as no url at all, so the caller can skip it", () => {
    expect(resolveRemoteMcpUrl({ url: "" })).toBeUndefined();
    expect(resolveRemoteMcpUrl({ url: "", httpUrl: "" })).toBeUndefined();
    expect(resolveRemoteMcpUrl({})).toBeUndefined();
  });
});

describe("resolveLocalMcpCommand", () => {
  it("merges args into a string command", () => {
    expect(resolveLocalMcpCommand({ command: "npx", args: ["-y", "server"] })).toEqual([
      "npx",
      "-y",
      "server",
    ]);
  });

  it("merges args after an array command", () => {
    expect(resolveLocalMcpCommand({ command: ["npx", "-y"], args: ["server"] })).toEqual([
      "npx",
      "-y",
      "server",
    ]);
  });

  it("returns an empty array when there is nothing to spawn", () => {
    expect(resolveLocalMcpCommand({})).toEqual([]);
    expect(resolveLocalMcpCommand({ command: [] })).toEqual([]);
    expect(resolveLocalMcpCommand({ args: ["--port", "1"] })).toEqual(["--port", "1"]);
  });
});

describe("warnAndSkipMcpServer", () => {
  it("names the tool, the server, and the reason, and returns null", () => {
    const logger = { warn: vi.fn() } as unknown as Logger;

    expect(
      warnAndSkipMcpServer({
        toolName: "Kilo",
        serverName: "broken",
        reason: "a local transport but no command",
        logger,
      }),
    ).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Kilo MCP: skipping "broken" because it declares a local transport but no command.',
    );
  });

  it("still skips when no logger is passed", () => {
    expect(
      warnAndSkipMcpServer({ toolName: "Kilo", serverName: "broken", reason: "nothing" }),
    ).toBeNull();
  });
});
