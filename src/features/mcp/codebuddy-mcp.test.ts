import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { CodebuddyMcp } from "./codebuddy-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

const buildRulesyncMcp = (mcpServers: Record<string, unknown>): RulesyncMcp =>
  new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "mcp.json",
    fileContent: JSON.stringify({ mcpServers }),
  });

const GLOBAL_DIR = ".codebuddy";

describe("CodebuddyMcp", () => {
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
    it("should point to .mcp.json at the project root in project mode", () => {
      expect(CodebuddyMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
      });
    });

    it("should point to ~/.codebuddy/.mcp.json in global mode", () => {
      expect(CodebuddyMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GLOBAL_DIR,
        relativeFilePath: ".mcp.json",
      });
    });
  });

  describe("constructor", () => {
    it("should accept JSONC comments in a hand-written file", () => {
      const mcp = new CodebuddyMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: '{ // shared with other agents\n "mcpServers": {}, }',
      });
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should throw when the JSON root is not an object", () => {
      expect(
        () =>
          new CodebuddyMcp({
            outputRoot: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".mcp.json",
            fileContent: "[]",
          }),
      ).toThrow("expected a JSON object at the root");
    });

    it("should throw on invalid JSON", () => {
      expect(
        () =>
          new CodebuddyMcp({
            outputRoot: testDir,
            relativeDirPath: ".",
            relativeFilePath: ".mcp.json",
            fileContent: "{ nope",
          }),
      ).toThrow("Failed to parse CodeBuddy MCP config");
    });
  });

  describe("isDeletable", () => {
    it("should be deletable in project mode and not in global mode", () => {
      const build = (global: boolean) =>
        new CodebuddyMcp({
          outputRoot: testDir,
          relativeDirPath: global ? GLOBAL_DIR : ".",
          relativeFilePath: ".mcp.json",
          fileContent: "{}",
          global,
        });
      expect(build(false).isDeletable()).toBe(true);
      expect(build(true).isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    const servers = {
      git: { command: "npx", args: ["-y", "mcp-git"], env: { TOKEN: "x" } },
      http: { type: "http", url: "https://example.com/mcp", headers: { A: "b" } },
      events: { type: "sse", url: "https://example.com/sse" },
      scoped: { command: "git-mcp", targets: ["codebuddy"] },
    };

    it("should write servers pass-through to .mcp.json in project mode", async () => {
      const mcp = await CodebuddyMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp(servers) });

      expect(mcp.getRelativeDirPath()).toBe(".");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        mcpServers: { ...servers, scoped: { command: "git-mcp" } },
      });
    });

    it("should write the same .mcp.json bytes as the claudecode target in project mode", async () => {
      await writeFileContent(
        join(testDir, ".mcp.json"),
        JSON.stringify({ someOtherKey: true, mcpServers: { stale: { command: "old" } } }),
      );
      const rulesyncMcp = buildRulesyncMcp(servers);

      const codebuddy = await CodebuddyMcp.fromRulesyncMcp({ rulesyncMcp });
      const claudecode = await ClaudecodeMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(codebuddy.getRelativeDirPath()).toBe(claudecode.getRelativeDirPath());
      expect(codebuddy.getRelativeFilePath()).toBe(claudecode.getRelativeFilePath());
      expect(codebuddy.getFileContent()).toBe(claudecode.getFileContent());
    });

    it("should write to ~/.codebuddy/.mcp.json in global mode and keep disabledMcpServers", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, ".mcp.json"),
        JSON.stringify({ disabledMcpServers: ["legacy"], mcpServers: { stale: { command: "x" } } }),
      );

      const mcp = await CodebuddyMcp.fromRulesyncMcp({
        rulesyncMcp: buildRulesyncMcp({ git: { command: "git-mcp" } }),
        global: true,
      });

      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(JSON.parse(mcp.getFileContent())).toEqual({
        disabledMcpServers: ["legacy"],
        mcpServers: { git: { command: "git-mcp" } },
      });
    });

    it("should ignore prototype-pollution keys on generate", async () => {
      const rulesyncMcp = buildRulesyncMcp(
        JSON.parse(
          '{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}',
        ),
      );

      const mcp = await CodebuddyMcp.fromRulesyncMcp({ rulesyncMcp });

      const written = JSON.parse(mcp.getFileContent()).mcpServers;
      expect(Object.keys(written)).toEqual(["git"]);
      expect(Object.keys(written.git)).toEqual(["command"]);
    });

    it("should throw when the existing file is not valid JSON", async () => {
      await writeFileContent(join(testDir, ".mcp.json"), "{ nope");

      await expect(
        CodebuddyMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp({}) }),
      ).rejects.toThrow("Failed to parse CodeBuddy MCP config");
    });
  });

  describe("fromFile", () => {
    it("should read ~/.codebuddy/.mcp.json in global mode", async () => {
      await ensureDir(join(testDir, GLOBAL_DIR));
      await writeFileContent(
        join(testDir, GLOBAL_DIR, ".mcp.json"),
        JSON.stringify({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } }),
      );

      const mcp = await CodebuddyMcp.fromFile({ global: true });

      expect(mcp.getRelativeDirPath()).toBe(GLOBAL_DIR);
      expect(mcp.getJson()).toEqual({ mcpServers: { git: { type: "stdio", command: "git-mcp" } } });
    });

    it("should fall back to an empty server map when the file is missing", async () => {
      const mcp = await CodebuddyMcp.fromFile({});
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should keep servers as they are and drop sibling top-level keys", () => {
      const mcp = new CodebuddyMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          disabledMcpServers: ["api"],
          mcpServers: {
            git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] },
            api: { type: "http", url: "https://api.example.com/mcp", description: "API" },
          },
        }),
      });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        mcpServers: {
          git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] },
          api: { type: "http", url: "https://api.example.com/mcp", description: "API" },
        },
      });
    });

    it("should ignore prototype-pollution keys on import", () => {
      const mcp = new CodebuddyMcp({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
        fileContent:
          '{"mcpServers":{"__proto__":{"command":"evil"},"git":{"command":"git-mcp","__proto__":{"x":1}}}}',
      });

      const servers = JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers;
      expect(Object.keys(servers)).toEqual(["git"]);
      expect(Object.keys(servers.git)).toEqual(["command"]);
    });

    it("should round-trip servers through generate and import", async () => {
      const servers = {
        git: { type: "stdio", command: "git-mcp", args: ["--x"] },
        api: { type: "http", url: "https://example.com/mcp" },
      };
      const mcp = await CodebuddyMcp.fromRulesyncMcp({ rulesyncMcp: buildRulesyncMcp(servers) });

      expect(JSON.parse(mcp.toRulesyncMcp().getFileContent()).mcpServers).toEqual(servers);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable project instance", () => {
      const mcp = CodebuddyMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: ".mcp.json",
      });
      expect(mcp.isDeletable()).toBe(true);
    });
  });
});
