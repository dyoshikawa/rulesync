import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { parseJson5 } from "../../utils/json5.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { TheiaMcp } from "./theia-mcp.js";

const KEY = "ai-features.mcp.mcpServers";

describe("TheiaMcp", () => {
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

  const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  const settingsPath = () => join(testDir, ".theia", "settings.json");

  it("should use .theia/settings.json and refuse global mode", () => {
    expect(TheiaMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".theia",
      relativeFilePath: "settings.json",
    });
    expect(() => TheiaMcp.getSettablePaths({ global: true })).toThrow(
      "TheiaMcp does not support global mode.",
    );
  });

  it("should write local and remote servers in Theia's shape", async () => {
    const mcp = await TheiaMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        local: { type: "stdio", command: ["npx", "-y", "server"], env: { KEY: "v" } },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { "X-Team": "a" },
          autostart: false,
          serverAuthToken: "token",
          timeout: 1000,
        },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      [KEY]: {
        local: { command: "npx", args: ["-y", "server"], env: { KEY: "v" } },
        remote: {
          autostart: false,
          serverAuthToken: "token",
          serverUrl: "https://example.com/mcp",
          headers: { "X-Team": "a" },
        },
      },
    });
  });

  it("should skip disabled servers with a warning", async () => {
    const logger = createMockLogger();
    const mcp = await TheiaMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ off: { command: "x", disabled: true } }),
      logger,
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({});
    expect(logger.warn).toHaveBeenCalled();
  });

  it("should keep other preferences, comments and Theia-managed server keys", async () => {
    await writeFileContent(
      settingsPath(),
      [
        "{",
        "  // keep me",
        '  "editor.fontSize": 14,',
        `  "${KEY}": {`,
        '    "srv": { "command": "old", "autostart": false, "registryMetadata": { "serverId": "a" }, "futureKey": 1 },',
        '    "gone": { "command": "gone" }',
        "  }",
        "}",
      ].join("\n"),
    );

    const mcp = await TheiaMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ srv: { command: "new" } }),
    });
    const content = mcp.getFileContent();

    expect(content).toContain("// keep me");
    expect(parseJson5(content)).toEqual({
      "editor.fontSize": 14,
      [KEY]: {
        srv: { registryMetadata: { serverId: "a" }, futureKey: 1, command: "new" },
      },
    });
  });

  it("should retract the key when no server is left", async () => {
    await writeFileContent(
      settingsPath(),
      JSON.stringify({ "editor.fontSize": 14, [KEY]: { srv: { command: "x" } } }),
    );

    const mcp = await TheiaMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({}),
    });

    expect(parseJson5(mcp.getFileContent())).toEqual({ "editor.fontSize": 14 });
  });

  it("should refuse to rewrite an unparseable settings file", async () => {
    await writeFileContent(settingsPath(), "{ not json");

    await expect(
      TheiaMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({ srv: { command: "x" } }),
      }),
    ).rejects.toThrow();
  });

  it("should import servers, mapping serverUrl to url and dropping registryMetadata", async () => {
    await writeFileContent(
      settingsPath(),
      JSON.stringify({
        "editor.fontSize": 14,
        [KEY]: {
          remote: {
            serverUrl: "https://example.com/mcp",
            headers: { "X-Team": "a" },
            registryMetadata: { serverId: "a" },
          },
          secret: {
            serverUrl: "https://secret.example.com/mcp",
            serverAuthToken: "token",
          },
          local: { command: "npx", args: ["a"] },
          bad: null,
        },
      }),
    );

    const mcp = await TheiaMcp.fromFile({ outputRoot: testDir });
    const json = JSON.parse(mcp.toRulesyncMcp().getFileContent());

    expect(json.mcpServers).toEqual({
      remote: { url: "https://example.com/mcp", headers: { "X-Team": "a" } },
      local: { command: "npx", args: ["a"] },
    });
    // Theia-specific keys (a token here) stay in the tool-scoped block, out of
    // the shared servers every other target generates from.
    expect(json.theia).toEqual({
      mcpServers: {
        secret: { url: "https://secret.example.com/mcp", serverAuthToken: "token" },
      },
    });
  });

  it("should never be deleted", () => {
    expect(
      TheiaMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".theia",
        relativeFilePath: "settings.json",
      }).isDeletable(),
    ).toBe(false);
  });
});
