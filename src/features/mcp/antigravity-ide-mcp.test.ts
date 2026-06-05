import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AntigravityIdeMcp } from "./antigravity-ide-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AntigravityIdeMcp", () => {
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
    it("should return correct paths for local (project) mode", () => {
      const paths = AntigravityIdeMcp.getSettablePaths();

      expect(paths.relativeDirPath).toBe(".agents");
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });

    it("should return correct paths for global mode", () => {
      const paths = AntigravityIdeMcp.getSettablePaths({ global: true });

      expect(paths.relativeDirPath).toBe(join(".gemini", "config"));
      expect(paths.relativeFilePath).toBe("mcp_config.json");
    });
  });

  describe("getJson", () => {
    it("should return the parsed object", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const antigravityIdeMcp = new AntigravityIdeMcp({
        relativeDirPath: ".agents",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      expect(antigravityIdeMcp.getJson()).toEqual(jsonData);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should write mcpServers at the top level equal to rulesyncMcp.getMcpServers()", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const antigravityIdeMcp = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(antigravityIdeMcp).toBeInstanceOf(AntigravityIdeMcp);
      const parsed = JSON.parse(antigravityIdeMcp.getFileContent());
      expect(parsed.mcpServers).toEqual(rulesyncMcp.getMcpServers());
      expect(parsed.mcpServers).toEqual(jsonData.mcpServers);
      expect(antigravityIdeMcp.getRelativeDirPath()).toBe(".agents");
      expect(antigravityIdeMcp.getRelativeFilePath()).toBe("mcp_config.json");
    });

    it("should initialize the file if it does not exist", async () => {
      const jsonData = {
        mcpServers: {
          "init-server": {
            command: "node",
            args: ["init.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const antigravityIdeMcp = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(antigravityIdeMcp.getJson()).toEqual(jsonData);
    });

    it("should handle an empty mcpServers object", async () => {
      const jsonData = {
        mcpServers: {},
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const antigravityIdeMcp = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(antigravityIdeMcp.getJson()).toEqual({ mcpServers: {} });
    });

    it("should create instance in global mode", async () => {
      const jsonData = {
        mcpServers: {
          "global-server": {
            command: "node",
            args: ["global.js"],
          },
        },
      };
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify(jsonData),
      });

      const antigravityIdeMcp = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(antigravityIdeMcp.getJson()).toEqual(jsonData);
      expect(antigravityIdeMcp.getRelativeDirPath()).toBe(join(".gemini", "config"));
      expect(antigravityIdeMcp.getRelativeFilePath()).toBe("mcp_config.json");
    });
  });

  describe("fromFile", () => {
    it("should create instance from an existing file", async () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".agents"));
      await writeFileContent(
        join(testDir, ".agents/mcp_config.json"),
        JSON.stringify(jsonData, null, 2),
      );

      const antigravityIdeMcp = await AntigravityIdeMcp.fromFile({
        outputRoot: testDir,
      });

      expect(antigravityIdeMcp).toBeInstanceOf(AntigravityIdeMcp);
      expect(antigravityIdeMcp.getJson()).toEqual(jsonData);
      expect(antigravityIdeMcp.getFilePath()).toBe(join(testDir, ".agents/mcp_config.json"));
    });

    it("should initialize empty mcpServers if the file does not exist", async () => {
      const antigravityIdeMcp = await AntigravityIdeMcp.fromFile({
        outputRoot: testDir,
      });

      expect(antigravityIdeMcp.getJson()).toEqual({ mcpServers: {} });
      expect(antigravityIdeMcp.getFilePath()).toBe(join(testDir, ".agents/mcp_config.json"));
    });
  });

  describe("toRulesyncMcp", () => {
    it("should round-trip with mcpServers present in the resulting content", () => {
      const jsonData = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };
      const antigravityIdeMcp = new AntigravityIdeMcp({
        relativeDirPath: ".agents",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify(jsonData),
      });

      const rulesyncMcp = antigravityIdeMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      const parsed = JSON.parse(rulesyncMcp.getFileContent());
      expect(parsed.mcpServers).toEqual(jsonData.mcpServers);
    });

    it("should use an empty mcpServers object when none is present", () => {
      const antigravityIdeMcp = new AntigravityIdeMcp({
        relativeDirPath: ".agents",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({}),
      });

      const rulesyncMcp = antigravityIdeMcp.toRulesyncMcp();

      const parsed = JSON.parse(rulesyncMcp.getFileContent());
      expect(parsed.mcpServers).toEqual({});
    });
  });

  describe("serverUrl transform", () => {
    it("should rename canonical `url` to Antigravity's `serverUrl` when generating", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "http-server": {
              type: "http",
              url: "https://example.com/mcp",
              disabledTools: ["danger"],
            },
          },
        }),
      });

      const antigravityIdeMcp = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      const server = antigravityIdeMcp.getJson().mcpServers as Record<
        string,
        Record<string, unknown>
      >;
      expect(server["http-server"]).toEqual({
        type: "http",
        serverUrl: "https://example.com/mcp",
        disabledTools: ["danger"],
      });
      expect(server["http-server"]).not.toHaveProperty("url");
    });

    it("should rename `serverUrl` back to canonical `url` when importing", () => {
      const antigravityIdeMcp = new AntigravityIdeMcp({
        relativeDirPath: ".agents",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({
          mcpServers: {
            "http-server": {
              type: "http",
              serverUrl: "https://example.com/mcp",
            },
          },
        }),
      });

      const parsed = JSON.parse(antigravityIdeMcp.toRulesyncMcp().getFileContent());
      expect(parsed.mcpServers["http-server"]).toEqual({
        type: "http",
        url: "https://example.com/mcp",
      });
    });
  });

  describe("validate", () => {
    it("should return a successful validation result", () => {
      const antigravityIdeMcp = new AntigravityIdeMcp({
        relativeDirPath: ".agents",
        relativeFilePath: "mcp_config.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: false,
      });

      const result = antigravityIdeMcp.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("integration", () => {
    it("should handle a complete workflow: fromFile -> toRulesyncMcp -> fromRulesyncMcp", async () => {
      const originalJsonData = {
        mcpServers: {
          "workflow-server": {
            command: "node",
            args: ["workflow-server.js"],
          },
        },
      };
      await ensureDir(join(testDir, ".agents"));
      await writeFileContent(
        join(testDir, ".agents/mcp_config.json"),
        JSON.stringify(originalJsonData, null, 2),
      );

      const original = await AntigravityIdeMcp.fromFile({ outputRoot: testDir });
      const rulesyncMcp = original.toRulesyncMcp();
      const regenerated = await AntigravityIdeMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
      });

      expect(regenerated.getJson()).toEqual(originalJsonData);
      expect(regenerated.getFilePath()).toBe(join(testDir, ".agents/mcp_config.json"));
    });
  });
});
