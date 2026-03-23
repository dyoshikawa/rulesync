import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DeepagentsMcp } from "./deepagents-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("DeepagentsMcp", () => {
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
    it("should return .deepagents/.mcp.json for project mode", () => {
      const paths = DeepagentsMcp.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".deepagents");
      expect(paths.relativeFilePath).toBe(".mcp.json");
    });

    it("should return .deepagents/.mcp.json for global mode", () => {
      const paths = DeepagentsMcp.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".deepagents");
      expect(paths.relativeFilePath).toBe(".mcp.json");
    });
  });

  describe("isDeletable", () => {
    it("should return true in project mode", () => {
      const mcp = new DeepagentsMcp({
        relativeDirPath: ".deepagents",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: false,
      });
      expect(mcp.isDeletable()).toBe(true);
    });

    it("should return false in global mode", () => {
      const mcp = new DeepagentsMcp({
        relativeDirPath: ".deepagents",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        global: true,
      });
      expect(mcp.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should create DeepagentsMcp from existing file", async () => {
      const deepagentsDir = join(testDir, ".deepagents");
      await ensureDir(deepagentsDir);
      const mcpContent = JSON.stringify({
        mcpServers: {
          "my-server": { command: "npx", args: ["my-server"] },
        },
      });
      await writeFileContent(join(deepagentsDir, ".mcp.json"), mcpContent);

      const mcp = await DeepagentsMcp.fromFile({ baseDir: testDir });

      expect(mcp.getRelativeDirPath()).toBe(".deepagents");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      const json = mcp.getJson();
      expect(json.mcpServers).toBeDefined();
    });

    it("should initialize with empty mcpServers if file does not exist", async () => {
      const mcp = await DeepagentsMcp.fromFile({ baseDir: testDir });
      const json = mcp.getJson();
      expect(json.mcpServers).toEqual({});
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create DeepagentsMcp with mcpServers from rulesync config", async () => {
      const rulesyncMcpContent = JSON.stringify({
        $schema: "https://example.com",
        mcpServers: {
          "test-server": { command: "npx", args: ["-y", "test-server"] },
        },
      });
      const deepagentsDir = join(testDir, ".rulesync");
      await ensureDir(deepagentsDir);
      await writeFileContent(join(deepagentsDir, "mcp.json"), rulesyncMcpContent);

      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: rulesyncMcpContent,
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ baseDir: testDir, rulesyncMcp });

      const json = mcp.getJson();
      expect(json.mcpServers).toEqual({
        "test-server": { command: "npx", args: ["-y", "test-server"] },
      });
      expect(mcp.getRelativeDirPath()).toBe(".deepagents");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
    });
  });
});
