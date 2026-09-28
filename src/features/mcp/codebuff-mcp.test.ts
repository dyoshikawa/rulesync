import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuffMcp } from "./codebuff-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

function rulesyncMcpOf(testDir: string, mcpServers: Record<string, unknown>): RulesyncMcp {
  return new RulesyncMcp({
    outputRoot: testDir,
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });
}

describe("CodebuffMcp", () => {
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

  it("targets .agents/mcp.json in both scopes", () => {
    const expected = { relativeDirPath: ".agents", relativeFilePath: "mcp.json" };
    expect(CodebuffMcp.getSettablePaths()).toEqual(expected);
    expect(CodebuffMcp.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("writes only the keys Codebuff's strict server schema accepts", () => {
    const logger = createMockLogger();
    const mcp = CodebuffMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: rulesyncMcpOf(testDir, {
        local: {
          type: "local",
          command: ["npx", "-y"],
          args: ["server"],
          env: { TOKEN: "${TOKEN}", MODE: "prod", URL: "https://${HOST}/x" },
          cwd: "/tmp",
          timeout: 1000,
        },
        remote: { type: "streamable-http", url: "https://example.com/mcp", headers: { A: "b" } },
        events: { transport: "sse", url: "https://example.com/events" },
        alias: { httpUrl: "https://example.com/alias" },
      }),
    });

    expect(mcp.getFilePath()).toBe(join(testDir, ".agents", "mcp.json"));
    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        local: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: { TOKEN: "$TOKEN", MODE: "prod", URL: "https://${HOST}/x" },
        },
        remote: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
        events: { type: "sse", url: "https://example.com/events" },
        alias: { type: "http", url: "https://example.com/alias" },
      },
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((message) => message.includes('"cwd", "timeout"'))).toBe(true);
    expect(warnings.some((message) => message.includes('"URL"'))).toBe(true);
  });

  it("skips disabled, WebSocket and command-less servers with a warning", () => {
    const logger = createMockLogger();
    const mcp = CodebuffMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: rulesyncMcpOf(testDir, {
        off: { command: "node", disabled: true },
        socket: { type: "ws", url: "wss://example.com" },
        empty: { type: "stdio", args: ["x"] },
        kept: { command: "node" },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: { kept: { type: "stdio", command: "node" } },
    });
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it("skips a server whose env value starts with $ but is not a whole ${VAR}", () => {
    const logger = createMockLogger();
    const mcp = CodebuffMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: rulesyncMcpOf(testDir, {
        port: { command: "node", env: { ADDR: "${HOST}:8080" } },
        fallback: { command: "node", env: { MODE: "${MODE:-dev}" } },
        kept: { command: "node", env: { TOKEN: "${TOKEN}" }, disabled: false },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: { kept: { type: "stdio", command: "node", env: { TOKEN: "$TOKEN" } } },
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps string params and drops non-string ones with a warning", () => {
    const logger = createMockLogger();
    const mcp = CodebuffMcp.fromRulesyncMcp({
      outputRoot: testDir,
      logger,
      rulesyncMcp: rulesyncMcpOf(testDir, {
        good: { url: "https://example.com/a", params: { key: "v" } },
        bad: { url: "https://example.com/b", params: { key: 1 } },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        good: { type: "http", url: "https://example.com/a", params: { key: "v" } },
        bad: { type: "http", url: "https://example.com/b" },
      },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("writes ~/.agents/mcp.json in global mode and never deletes it", () => {
    const mcp = CodebuffMcp.fromRulesyncMcp({
      outputRoot: testDir,
      global: true,
      rulesyncMcp: rulesyncMcpOf(testDir, { kept: { command: "node" } }),
    });

    expect(mcp.getFilePath()).toBe(join(testDir, ".agents", "mcp.json"));
    expect(mcp.isDeletable()).toBe(false);
    expect(
      CodebuffMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".agents",
        relativeFilePath: "mcp.json",
      }).isDeletable(),
    ).toBe(true);
  });

  it("imports .agents/mcp.json, restoring canonical ${VAR} env references", async () => {
    await writeFileContent(
      join(testDir, ".agents", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          notion: { command: "npx", args: ["notion"], env: { KEY: "$NOTION_KEY", MODE: "x" } },
          web: { type: "http", url: "https://example.com/mcp" },
        },
      }),
    );

    const mcp = await CodebuffMcp.fromFile({ outputRoot: testDir });

    expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
      notion: { command: "npx", args: ["notion"], env: { KEY: "${NOTION_KEY}", MODE: "x" } },
      web: { type: "http", url: "https://example.com/mcp" },
    });
  });
});
