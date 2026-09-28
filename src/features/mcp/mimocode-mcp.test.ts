import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { MimocodeMcp } from "./mimocode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("MimocodeMcp", () => {
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

  it("should resolve project and global settable paths to mimocode.json", () => {
    expect(MimocodeMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".mimocode",
      relativeFilePath: "mimocode.json",
    });
    expect(MimocodeMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "mimocode"),
      relativeFilePath: "mimocode.json",
    });
  });

  it("should write servers into .mimocode/mimocode.jsonc in the OpenCode shape", async () => {
    const rulesyncMcp = new RulesyncMcp({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: { "test-server": { command: "node", args: ["server.js"] } },
      }),
    });

    const mcp = await MimocodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

    expect(mcp).toBeInstanceOf(MimocodeMcp);
    expect(mcp.getFilePath()).toBe(join(testDir, ".mimocode", "mimocode.jsonc"));
    expect(mcp.getJson().mcp).toEqual({
      "test-server": { type: "local", command: ["node", "server.js"], enabled: true },
    });
  });

  it("should import a transport-less server into the mimocode block", () => {
    const mcp = new MimocodeMcp({
      relativeDirPath: ".mimocode",
      relativeFilePath: "mimocode.json",
      fileContent: JSON.stringify({ mcp: { toggled: { enabled: false } } }),
      validate: false,
    });

    const imported = JSON.parse(mcp.toRulesyncMcp().getFileContent());
    expect(imported.mcpServers).toEqual({});
    expect(imported.mimocode.mcpServers.toggled).toEqual({ disabled: true });
    expect(imported.opencode).toBeUndefined();
  });

  it("should register project instructions verbatim, relative to the project root", async () => {
    const mcp = await MimocodeMcp.fromInstructions({
      outputRoot: testDir,
      instructions: [".mimocode/memories/overview.md"],
    });
    if (mcp === null) throw new Error("expected a registrar result");

    expect(mcp.getFilePath()).toBe(join(testDir, ".mimocode", "mimocode.jsonc"));
    expect((mcp.getJson() as Record<string, unknown>).instructions).toEqual([
      ".mimocode/memories/overview.md",
    ]);
  });

  it("should register global instructions as home-rooted paths and own their managed entries", async () => {
    await writeFileContent(
      join(testDir, ".config", "mimocode", "mimocode.json"),
      JSON.stringify({
        instructions: ["~/.config/mimocode/memories/stale.md", "docs/user.md"],
      }),
    );

    const mcp = await MimocodeMcp.fromInstructions({
      outputRoot: testDir,
      instructions: [".config/mimocode/memories/style.md"],
      global: true,
    });
    if (mcp === null) throw new Error("expected a registrar result");

    // MiMo Code resolves relative entries against the project directory, so a
    // global rule must be spelled from the home directory to be found.
    expect((mcp.getJson() as Record<string, unknown>).instructions).toEqual([
      "docs/user.md",
      "~/.config/mimocode/memories/style.md",
    ]);
  });
});
