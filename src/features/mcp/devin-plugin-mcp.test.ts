import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinMcp } from "./devin-mcp.js";
import { DevinPluginMcp } from "./devin-plugin-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("DevinPluginMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  it("writes .mcp.json at the plugin root, while devin keeps .devin/mcp_config.json", () => {
    expect(DevinPluginMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    });
    expect(DevinMcp.getSettablePaths().relativeDirPath).toBe(".devin");
  });

  it("writes the whole mcpServers map, replacing any existing file content", async () => {
    await writeFileContent(
      join(testDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { stale: { command: "old" } } }),
    );

    const mcp = await DevinPluginMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({
        local: { command: "npx", args: ["-y", "server"], disabledTools: ["dangerous"] },
      }),
    });

    expect(mcp).toBeInstanceOf(DevinPluginMcp);
    expect(mcp.isDeletable()).toBe(true);
    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        local: { command: "npx", args: ["-y", "server"], disabledTools: ["dangerous"] },
      },
    });
  });

  it("round-trips .mcp.json and ignores keys other than mcpServers", async () => {
    await writeFileContent(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { remote: { url: "https://example.com/mcp" } },
        extra: true,
      }),
    );

    const mcp = await DevinPluginMcp.fromFile({ outputRoot: testDir });

    expect(mcp).toBeInstanceOf(DevinPluginMcp);
    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: { remote: { url: "https://example.com/mcp" } },
    });
    expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
      remote: { url: "https://example.com/mcp" },
    });
  });

  it("defaults to an empty server map when .mcp.json is missing", async () => {
    const mcp = await DevinPluginMcp.fromFile({ outputRoot: testDir });

    expect(JSON.parse(mcp.getFileContent())).toEqual({ mcpServers: {} });
  });

  it("throws a descriptive error for malformed JSON", async () => {
    await writeFileContent(join(testDir, ".mcp.json"), "{ not json");

    await expect(DevinPluginMcp.fromFile({ outputRoot: testDir })).rejects.toThrow(
      /Failed to parse Devin plugin MCP config/,
    );
  });
});
