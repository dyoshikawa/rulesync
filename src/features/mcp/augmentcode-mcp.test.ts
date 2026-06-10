import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import { AugmentcodeMcp } from "./augmentcode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

describe("AugmentcodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const settingsPath = () => join(testDir, ".augment", "settings.json");

  describe("getSettablePaths", () => {
    it("should point to .augment/settings.json", () => {
      expect(AugmentcodeMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should never be deletable (shared settings file)", () => {
      const mcp = new AugmentcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should throw in non-global mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
      });
      await expect(
        AugmentcodeMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, global: false }),
      ).rejects.toThrow(/global-only/);
    });

    it("should merge mcpServers preserving hooks and permissions keys", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify(
          {
            hooks: { SessionStart: [{ command: "echo hi" }] },
            toolPermissions: [{ "tool-name": "shell", permission: "allow" }],
            mcpServers: { old: { command: "old" } },
          },
          null,
          2,
        ),
      );

      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { fs: { command: "fs-server", args: ["--root", "."] } },
        }),
      });

      const mcp = await AugmentcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      const json = mcp.getJson();
      // Other keys are preserved.
      expect(json.hooks).toEqual({ SessionStart: [{ command: "echo hi" }] });
      expect(json.toolPermissions).toEqual([{ "tool-name": "shell", permission: "allow" }]);
      // mcpServers is replaced with the rulesync servers (old one removed).
      expect(json.mcpServers).toEqual({
        fs: { command: "fs-server", args: ["--root", "."] },
      });
    });

    it("should initialize settings when the file does not exist", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fs: { command: "fs" } } }),
      });

      const mcp = await AugmentcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(mcp.getJson()).toEqual({ mcpServers: { fs: { command: "fs" } } });
    });
  });

  describe("fromFile", () => {
    it("should throw in non-global mode", async () => {
      await expect(AugmentcodeMcp.fromFile({ outputRoot: testDir, global: false })).rejects.toThrow(
        /global-only/,
      );
    });

    it("should read existing settings and surface mcpServers", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({ hooks: {}, mcpServers: { fs: { command: "fs" } } }),
      );

      const mcp = await AugmentcodeMcp.fromFile({ outputRoot: testDir, global: true });
      expect(mcp.getJson().mcpServers).toEqual({ fs: { command: "fs" } });
    });

    it("should default to empty mcpServers when file is missing", async () => {
      const mcp = await AugmentcodeMcp.fromFile({ outputRoot: testDir, global: true });
      expect(mcp.getJson()).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should only surface mcpServers, not other settings keys", () => {
      const mcp = new AugmentcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: { x: 1 },
          mcpServers: { fs: { command: "fs" } },
        }),
        global: true,
      });

      const rulesyncMcp = mcp.toRulesyncMcp();
      const json = JSON.parse(rulesyncMcp.getFileContent());
      expect(json.mcpServers).toEqual({ fs: { command: "fs" } });
      expect(json.hooks).toBeUndefined();
    });
  });

  describe("generation writes a merged file", () => {
    it("should not clobber hooks when written to disk via processor flow", async () => {
      await writeFileContent(
        settingsPath(),
        JSON.stringify({ hooks: { SessionStart: [] } }, null, 2),
      );
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fs: { command: "fs" } } }),
      });
      const mcp = await AugmentcodeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      await writeFileContent(settingsPath(), mcp.getFileContent());
      const written = JSON.parse(await readFileContent(settingsPath()));
      expect(written.hooks).toEqual({ SessionStart: [] });
      expect(written.mcpServers).toEqual({ fs: { command: "fs" } });
    });

    it("should be an instance of ToolMcp", () => {
      const mcp = new AugmentcodeMcp({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        global: true,
      });
      expect(mcp).toBeInstanceOf(ToolMcp);
    });
  });
});
