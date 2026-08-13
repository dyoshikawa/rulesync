import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
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

      const mcp = await DeepagentsMcp.fromFile({ outputRoot: testDir });

      expect(mcp.getRelativeDirPath()).toBe(".deepagents");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      const json = mcp.getJson();
      expect(json.mcpServers).toBeDefined();
    });

    it("should initialize with empty mcpServers if file does not exist", async () => {
      const mcp = await DeepagentsMcp.fromFile({ outputRoot: testDir });
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
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: rulesyncMcpContent,
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      const json = mcp.getJson();
      expect(json.mcpServers).toEqual({
        "test-server": { command: "npx", args: ["-y", "test-server"] },
      });
      expect(mcp.getRelativeDirPath()).toBe(".deepagents");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
    });

    it("should normalize transports and skip the WebSocket one dcode rejects", async () => {
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            local: { type: "local", command: "npx", args: ["server"] },
            remote: { type: "streamable-http", url: "https://example.com/mcp" },
            events: { transport: "sse", url: "https://example.com/events" },
            socket: { type: "ws", url: "wss://example.com/mcp" },
          },
        }),
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, logger });

      expect(mcp.getJson().mcpServers).toEqual({
        local: { type: "stdio", command: "npx", args: ["server"] },
        remote: { type: "http", url: "https://example.com/mcp" },
        // The authored key is preserved: dcode reads `type` and `transport`
        // interchangeably.
        events: { transport: "sse", url: "https://example.com/events" },
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("socket"));
    });

    it("should translate enabledTools to allowedTools and keep disabledTools", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            allowed: { command: "npx", enabledTools: ["read_*"] },
            denied: { command: "npx", disabledTools: ["delete"] },
          },
        }),
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });

      expect(mcp.getJson().mcpServers).toEqual({
        allowed: { command: "npx", allowedTools: ["read_*"] },
        denied: { command: "npx", disabledTools: ["delete"] },
      });
    });

    it("should skip a server that sets both filters rather than publishing every tool", async () => {
      // Upstream refuses the server outright, and writing neither filter would
      // leave it running with all tools — the denied ones included.
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            both: { command: "npx", enabledTools: ["read"], disabledTools: ["write"] },
            kept: { command: "npx" },
          },
        }),
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, logger });

      expect(mcp.getJson().mcpServers).toEqual({ kept: { command: "npx" } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("both"));
    });

    it("should skip an empty allowlist but only drop an empty denylist", async () => {
      // The two empty forms mean opposite things: an empty allowlist allows no
      // tools (so the server is skipped), while an empty denylist denies nothing
      // (so only the key is dropped). Both are rejected by upstream.
      const logger = createMockLogger();
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            emptyAllow: { command: "npx", enabledTools: [] },
            emptyDeny: { command: "npx", disabledTools: [] },
          },
        }),
      });

      const mcp = await DeepagentsMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp, logger });

      expect(mcp.getJson().mcpServers).toEqual({ emptyDeny: { command: "npx" } });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("emptyAllow"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("emptyDeny"));
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert deepagents mcp config to rulesync format", () => {
      const mcp = new DeepagentsMcp({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "test-server": { command: "npx", args: ["-y", "test-server"] },
          },
          extra: true,
        }),
      });

      const rulesyncMcp = mcp.toRulesyncMcp();

      expect(rulesyncMcp.getMcpServers()).toEqual({
        "test-server": { command: "npx", args: ["-y", "test-server"] },
      });
    });

    it("should lift allowedTools and the streamable_http alias back to canonical", () => {
      const mcp = new DeepagentsMcp({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            filtered: { command: "npx", allowedTools: ["read_*"] },
            denied: { command: "npx", disabledTools: ["delete"] },
            snake: { type: "streamable_http", url: "https://example.com/mcp" },
            kebab: { transport: "streamable-http", url: "https://example.com/mcp" },
          },
        }),
      });

      expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
        filtered: { command: "npx", enabledTools: ["read_*"] },
        // Already the canonical spelling, so it survives untouched.
        denied: { command: "npx", disabledTools: ["delete"] },
        snake: { type: "http", url: "https://example.com/mcp" },
        kebab: { transport: "http", url: "https://example.com/mcp" },
      });
    });
  });

  describe("forDeletion", () => {
    it("should create a placeholder file for deletion", () => {
      const mcp = DeepagentsMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".deepagents",
        relativeFilePath: ".mcp.json",
      });

      expect(mcp.getRelativeDirPath()).toBe(".deepagents");
      expect(mcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(mcp.getFileContent()).toBe("{}");
    });
  });
});
