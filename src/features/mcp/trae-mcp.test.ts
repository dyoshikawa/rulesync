import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { TraeMcp } from "./trae-mcp.js";

describe("TraeMcp", () => {
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

  it("should resolve .trae/mcp.json", () => {
    expect(TraeMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".trae",
      relativeFilePath: "mcp.json",
    });
  });

  it("should write stdio and HTTP servers into .trae/mcp.json as mcpServers", async () => {
    const rulesyncMcp = new RulesyncMcp({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          local: {
            command: "node",
            args: ["${workspaceFolder}/plugins/mcp.js"],
            env: { API_KEY: "value" },
          },
          remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
        },
      }),
    });

    const mcp = await TraeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

    expect(mcp).toBeInstanceOf(TraeMcp);
    expect(mcp.getFilePath()).toBe(join(testDir, ".trae", "mcp.json"));
    expect(mcp.getJson().mcpServers).toEqual({
      local: {
        command: "node",
        args: ["${workspaceFolder}/plugins/mcp.js"],
        env: { API_KEY: "value" },
      },
      remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
    });
  });

  it("should import .trae/mcp.json back into rulesync", async () => {
    await writeFileContent(
      join(testDir, ".trae", "mcp.json"),
      JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "server"] } } }),
    );

    const mcp = await TraeMcp.fromFile({ outputRoot: testDir });

    expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
      github: { command: "npx", args: ["-y", "server"] },
    });
  });

  it("should report the file path when .trae/mcp.json is not valid JSON", () => {
    expect(
      () =>
        new TraeMcp({
          outputRoot: testDir,
          relativeDirPath: ".trae",
          relativeFilePath: "mcp.json",
          fileContent: "{ not json",
        }),
    ).toThrow(`Failed to parse Trae MCP config at ${join(".trae", "mcp.json")}`);
  });

  it("should build a deletable placeholder for .trae/mcp.json", () => {
    const mcp = TraeMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".trae",
      relativeFilePath: "mcp.json",
    });

    expect(mcp.isDeletable()).toBe(true);
  });
});
