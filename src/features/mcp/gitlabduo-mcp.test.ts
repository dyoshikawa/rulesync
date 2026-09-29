import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GitlabduoMcp } from "./gitlabduo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

function makeRulesyncMcp(json: Record<string, unknown>): RulesyncMcp {
  return new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify(json),
  });
}

describe("GitlabduoMcp", () => {
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

  it("should resolve .gitlab/duo/mcp.json in both scopes", () => {
    const expected = { relativeDirPath: join(".gitlab", "duo"), relativeFilePath: "mcp.json" };
    expect(GitlabduoMcp.getSettablePaths()).toEqual(expected);
    expect(GitlabduoMcp.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("should always write an explicit type and pass approvedTools through", () => {
    const mcp = GitlabduoMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        mcpServers: {
          local: { command: "node", args: ["server.js"], approvedTools: true },
          remote: { url: "https://example.com/mcp", approvedTools: ["search"] },
          streamable: { type: "streamable-http", url: "https://example.com/stream" },
          events: { transport: "sse", url: "https://example.com/sse" },
          aliased: { httpUrl: "https://example.com/alias" },
          split: { command: ["npx", "-y", "pkg"], args: ["--flag"] },
        },
      }),
    });

    expect(mcp.getFilePath()).toBe(join(testDir, ".gitlab", "duo", "mcp.json"));
    expect(mcp.getJson()).toEqual({
      mcpServers: {
        local: { type: "stdio", command: "node", args: ["server.js"], approvedTools: true },
        remote: { type: "http", url: "https://example.com/mcp", approvedTools: ["search"] },
        streamable: { type: "http", url: "https://example.com/stream" },
        events: { type: "sse", url: "https://example.com/sse" },
        aliased: { type: "http", url: "https://example.com/alias" },
        split: { type: "stdio", command: "npx", args: ["-y", "pkg", "--flag"] },
      },
    });
  });

  it("should skip servers it cannot express", () => {
    const warn = vi.fn();
    const mcp = GitlabduoMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        mcpServers: {
          socket: { type: "ws", url: "wss://example.com" },
          ok: { command: "node" },
        },
      }),
      logger: { warn } as never,
    });

    expect(mcp.getJson()).toEqual({ mcpServers: { ok: { type: "stdio", command: "node" } } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("should apply the gitlabduo tool-scoped block", () => {
    const rulesyncMcp = makeRulesyncMcp({
      mcpServers: { shared: { command: "node" } },
      gitlabduo: { mcpServers: { only: { url: "https://example.com/mcp" } } },
    });

    const mcp = GitlabduoMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: rulesyncMcp.forTarget({ toolTarget: "gitlabduo" }),
    });

    expect(Object.keys((mcp.getJson().mcpServers ?? {}) as object).toSorted()).toEqual([
      "only",
      "shared",
    ]);
  });

  it("should import mcp.json into the rulesync shape", async () => {
    await writeFileContent(
      join(testDir, ".gitlab", "duo", "mcp.json"),
      JSON.stringify({ mcpServers: { s: { type: "stdio", command: "node" } } }),
    );

    const mcp = await GitlabduoMcp.fromFile({ outputRoot: testDir });
    const json = JSON.parse(mcp.toRulesyncMcp().getFileContent());

    expect(json.mcpServers).toEqual({ s: { type: "stdio", command: "node" } });
  });
});
