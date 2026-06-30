import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { TaktMcp } from "./takt-mcp.js";

const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
  new RulesyncMcp({
    relativeDirPath: ".rulesync",
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readAllowlist = (content: string): Record<string, unknown> =>
  toRecord(toRecord(load(content)).workflow_mcp_servers);

describe("TaktMcp", () => {
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
    it("writes to .takt/config.yaml for both scopes", () => {
      expect(TaktMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
      });
      expect(TaktMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
      });
    });
  });

  describe("fromRulesyncMcp (generate)", () => {
    it("enables only the transports present among the servers", async () => {
      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          local: { type: "stdio", command: "echo", args: ["hi"] },
          remote: { type: "http", url: "https://example.com/mcp" },
        }),
      });

      expect(readAllowlist(mcp.getFileContent())).toEqual({
        stdio: true,
        sse: false,
        http: true,
      });
    });

    it("treats sse type and aliases (local/streamable-http/ws) correctly", async () => {
      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          a: { type: "sse", url: "https://example.com/sse" },
          b: { type: "local", command: "node" },
          c: { type: "streamable-http", url: "https://example.com/s" },
        }),
      });

      expect(readAllowlist(mcp.getFileContent())).toEqual({
        stdio: true,
        sse: true,
        http: true,
      });
    });

    it("infers stdio from a bare command and http from a bare url", async () => {
      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          a: { command: "echo" },
          b: { url: "https://example.com/mcp" },
        }),
      });

      expect(readAllowlist(mcp.getFileContent())).toEqual({
        stdio: true,
        sse: false,
        http: true,
      });
    });

    it("emits an all-false allowlist when there are no servers", async () => {
      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({}),
      });

      expect(readAllowlist(mcp.getFileContent())).toEqual({
        stdio: false,
        sse: false,
        http: false,
      });
    });

    it("preserves unrelated existing config keys (in-place merge)", async () => {
      await writeFileContent(
        join(testDir, ".takt", "config.yaml"),
        [
          "provider: claude",
          "provider_profiles:",
          "  claude:",
          "    default_permission_mode: edit",
        ].join("\n"),
      );

      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          local: { type: "stdio", command: "echo" },
        }),
      });

      const parsed = toRecord(load(mcp.getFileContent()));
      expect(parsed.provider).toBe("claude");
      expect(toRecord(toRecord(parsed.provider_profiles).claude).default_permission_mode).toBe(
        "edit",
      );
      expect(readAllowlist(mcp.getFileContent())).toEqual({
        stdio: true,
        sse: false,
        http: false,
      });
    });

    it("does not write any server name/command into config.yaml (documented lossiness)", async () => {
      const mcp = await TaktMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp({
          "secret-server": { type: "stdio", command: "run-secret", env: { TOKEN: "abc" } },
        }),
      });

      const content = mcp.getFileContent();
      expect(content).not.toContain("secret-server");
      expect(content).not.toContain("run-secret");
      expect(content).not.toContain("TOKEN");
    });
  });

  describe("toRulesyncMcp (import)", () => {
    it("yields an empty mcpServers map (definitions are not recoverable)", () => {
      const mcp = new TaktMcp({
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
        fileContent: "workflow_mcp_servers:\n  stdio: true\n  sse: false\n  http: false\n",
        validate: false,
      });

      const rulesync = mcp.toRulesyncMcp();
      const parsed = toRecord(JSON.parse(rulesync.getFileContent()));
      expect(parsed.mcpServers).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared config)", () => {
      const mcp = TaktMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".takt",
        relativeFilePath: "config.yaml",
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });
});
