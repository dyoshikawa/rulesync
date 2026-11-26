import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ZeroMcp } from "./zero-mcp.js";

function makeRulesyncMcp(mcpServers: Record<string, unknown>): RulesyncMcp {
  return new RulesyncMcp({
    outputRoot: "/mock",
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });
}

describe("ZeroMcp", () => {
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

  describe("getSettablePaths", () => {
    it("should use .zero/config.json in project scope", () => {
      expect(ZeroMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".zero",
        relativeFilePath: "config.json",
      });
    });

    it.each([
      ["linux", join(".config", "zero")],
      ["darwin", join(".config", "zero")],
      ["win32", join("AppData", "Roaming", "zero")],
    ] as const)("should use the %s user config dir in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(ZeroMcp.getSettablePaths({ global: true }).relativeDirPath).toBe(expected);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write stdio and http servers under mcp.servers", async () => {
      const mcp = await ZeroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          docs: { command: "docs-mcp", args: ["--port", "7777"], env: { A: "1" } },
          github: {
            type: "http",
            url: "https://api.example.com/mcp",
            headers: { Authorization: "Bearer x" },
            disabled: true,
          },
        }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcp: {
          servers: {
            docs: { type: "stdio", command: "docs-mcp", args: ["--port", "7777"], env: { A: "1" } },
            github: {
              type: "http",
              url: "https://api.example.com/mcp",
              headers: { Authorization: "Bearer x" },
              disabled: true,
            },
          },
        },
      });
    });

    it("should keep the other keys of an existing config.json", async () => {
      await writeFileContent(
        join(testDir, ".zero", "config.json"),
        JSON.stringify({ defaultModel: "m", mcp: { servers: { old: { command: "x" } } } }),
      );

      const mcp = await ZeroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({ docs: { command: "docs-mcp" } }),
      });

      expect(JSON.parse(mcp.getFileContent())).toEqual({
        defaultModel: "m",
        mcp: { servers: { docs: { type: "stdio", command: "docs-mcp" } } },
      });
    });

    it("should write zeroOauth as oauth and carry over unmanaged keys of existing servers", async () => {
      await writeFileContent(
        join(testDir, ".zero", "config.json"),
        JSON.stringify({
          mcp: {
            servers: {
              github: { type: "http", url: "https://old", oauth: { scope: "repo" }, extra: 1 },
              docs: { type: "http", url: "https://docs", oauth: { scope: "x" } },
              same: { type: "http", url: "https://same", oauth: { scope: "s" } },
            },
          },
        }),
      );

      const mcp = await ZeroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          github: { type: "http", url: "https://api.example.com/mcp" },
          docs: { command: "docs-mcp" },
          same: { type: "http", url: "https://same" },
          linear: { type: "http", url: "https://linear", zeroOauth: { clientId: "id" } },
        }),
      });

      expect(JSON.parse(mcp.getFileContent()).mcp.servers).toEqual({
        // The url changed, so the old `oauth` block (which may hold a client
        // secret) is dropped while other unmanaged keys are kept.
        github: { type: "http", url: "https://api.example.com/mcp", extra: 1 },
        same: { type: "http", url: "https://same", oauth: { scope: "s" } },
        // `oauth` is not carried onto a server that became stdio.
        docs: { type: "stdio", command: "docs-mcp" },
        linear: { type: "http", url: "https://linear", oauth: { clientId: "id" } },
      });
    });

    it("should skip sse servers and invalid names with a warning", async () => {
      const logger = createMockLogger();
      const mcp = await ZeroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          events: { type: "sse", url: "https://example.com/sse" },
          "bad name": { command: "x" },
          ok: { command: "ok" },
        }),
        logger,
      });

      expect(Object.keys(JSON.parse(mcp.getFileContent()).mcp.servers)).toEqual(["ok"]);
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("should warn that environment variable references are written literally", async () => {
      const logger = createMockLogger();
      await ZeroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({ docs: { command: "x", env: { TOKEN: "${TOKEN}" } } }),
        logger,
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("does not expand"));
    });

    it("should refuse to rewrite an unparseable config.json", async () => {
      await writeFileContent(join(testDir, ".zero", "config.json"), "{ not json");
      await expect(
        ZeroMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: makeRulesyncMcp({ docs: { command: "x" } }),
        }),
      ).rejects.toThrow();
      expect(await readFileContent(join(testDir, ".zero", "config.json"))).toBe("{ not json");
    });
  });

  describe("toRulesyncMcp", () => {
    it("should import only mcp.servers", async () => {
      await writeFileContent(
        join(testDir, ".zero", "config.json"),
        JSON.stringify({
          apiKey: "secret",
          mcp: {
            servers: {
              docs: { type: "stdio", command: "docs-mcp", args: ["a"] },
              github: {
                type: "http",
                url: "https://x",
                auth: "oauth",
                oauth: { scope: "repo" },
                disabled: true,
              },
            },
          },
        }),
      );

      const mcp = await ZeroMcp.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(mcp.toRulesyncMcp().getFileContent());

      expect(imported.apiKey).toBeUndefined();
      expect(imported.mcpServers).toEqual({
        docs: { type: "stdio", command: "docs-mcp", args: ["a"] },
        github: {
          type: "http",
          url: "https://x",
          auth: "oauth",
          zeroOauth: { scope: "repo" },
          disabled: true,
        },
      });
    });
  });

  it("should never be deletable", () => {
    const mcp = ZeroMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".zero",
      relativeFilePath: "config.json",
    });
    expect(mcp.isDeletable()).toBe(false);
  });
});
