import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { QoderMcp } from "./qoder-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("QoderMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const servers = {
    fs: { type: "stdio", command: "npx", args: ["-y", "fs-server"], env: { A: "1" } },
    remote: { type: "http", url: "https://example.com/mcp" },
  };

  const makeRulesyncMcp = () =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers: servers }),
    });

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should use .mcp.json for the project and ~/.qoder/settings.json globally", () => {
    expect(QoderMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    });
    expect(QoderMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".qoder",
      relativeFilePath: "settings.json",
    });
  });

  it("should write the project .mcp.json byte-identical to the claudecode target", async () => {
    await writeFileContent(join(testDir, ".mcp.json"), JSON.stringify({ other: true }));

    const qoder = await QoderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp(),
    });
    const claudecode = await ClaudecodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp(),
    });

    expect(qoder.getFileContent()).toBe(claudecode.getFileContent());
    expect(JSON.parse(qoder.getFileContent())).toEqual({ other: true, mcpServers: servers });
    expect(qoder.isDeletable()).toBe(true);
  });

  it("should merge mcpServers into the user settings file and keep other settings", async () => {
    await writeFileContent(
      join(testDir, ".qoder", "settings.json"),
      JSON.stringify({ model: "auto", mcpServers: { stale: { command: "old" } } }),
    );

    const mcp = await QoderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp(),
      global: true,
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({ model: "auto", mcpServers: servers });
    expect(mcp.isDeletable()).toBe(false);
  });

  it("should refuse to rewrite an unparseable user settings file", async () => {
    await writeFileContent(join(testDir, ".qoder", "settings.json"), "[1, 2]");

    await expect(
      QoderMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp(),
        global: true,
      }),
    ).rejects.toThrow();
  });

  it("should import servers back into the canonical shape", async () => {
    await writeFileContent(
      join(testDir, ".qoder", "settings.json"),
      JSON.stringify({ theme: "dark", mcpServers: servers }),
    );

    const mcp = await QoderMcp.fromFile({ outputRoot: testDir, global: true });

    expect(mcp.toRulesyncMcp().getJson()).toMatchObject({ mcpServers: servers });
  });
});
