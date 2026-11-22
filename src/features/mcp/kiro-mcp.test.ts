import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiroMcp } from "./kiro-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("KiroMcp", () => {
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
    it("should return project path", () => {
      expect(KiroMcp.getSettablePaths()).toEqual({
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert exposed servers for project mode", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            exposedServer: {
              command: "node",
              args: ["server.js"],
              exposed: true,
              disabledTools: ["delete"],
            },
            hiddenServer: { command: "python", args: ["hidden.py"] },
          },
        }),
        validate: true,
      });

      const kiroMcp = await KiroMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(kiroMcp.getRelativeDirPath()).toBe(join(".kiro", "settings"));
      expect(kiroMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: {
          exposedServer: {
            command: "node",
            args: ["server.js"],
            disabledTools: ["delete"],
          },
          hiddenServer: { command: "python", args: ["hidden.py"] },
        },
      });
    });

    it("should translate kiroAutoApprove and kiroAutoBlock onto Kiro's native keys", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: {
              command: "node",
              kiroAutoApprove: ["read_file", "list_dir"],
              kiroAutoBlock: ["delete_file"],
            },
          },
        }),
        validate: true,
      });

      const kiroMcp = await KiroMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: {
          api: {
            command: "node",
            autoApprove: ["read_file", "list_dir"],
            disabledTools: ["delete_file"],
          },
        },
      });
    });

    it("should union the translated lists with natively spelled ones", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: {
              command: "node",
              autoApprove: ["read_file"],
              kiroAutoApprove: ["read_file", "list_dir"],
              disabledTools: ["delete_file"],
              kiroAutoBlock: ["drop_table"],
            },
          },
        }),
        validate: true,
      });

      const kiroMcp = await KiroMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: {
          api: {
            command: "node",
            autoApprove: ["read_file", "list_dir"],
            disabledTools: ["delete_file", "drop_table"],
          },
        },
      });
    });

    it("should keep an explicitly authored empty list so generate stays idempotent", async () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { api: { command: "node", disabledTools: [] } },
        }),
        validate: true,
      });

      const kiroMcp = await KiroMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: { api: { command: "node", disabledTools: [] } },
      });
    });
  });

  describe("fromFile", () => {
    it("should initialize missing project file", async () => {
      const kiroMcp = await KiroMcp.fromFile({ outputRoot: testDir });

      expect(kiroMcp.getFilePath()).toBe(join(testDir, ".kiro", "settings", "mcp.json"));
      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to Rulesync format", () => {
      const kiroMcp = new KiroMcp({
        outputRoot: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: {
              command: "node",
              args: ["server.js"],
              disabledTools: ["delete", "write"],
            },
          },
        }),
        validate: true,
      });

      const rulesyncMcp = kiroMcp.toRulesyncMcp();

      expect(rulesyncMcp.getFilePath()).toBe(join(testDir, ".rulesync", "mcp.jsonc"));
      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: {
          command: "node",
          args: ["server.js"],
          disabledTools: ["delete", "write"],
        },
      });
    });

    it("should translate autoApprove back to kiroAutoApprove and round-trip", async () => {
      const kiroMcp = new KiroMcp({
        outputRoot: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: {
              command: "node",
              autoApprove: ["read_file"],
              disabledTools: ["delete_file"],
            },
          },
        }),
        validate: true,
      });

      const rulesyncMcp = kiroMcp.toRulesyncMcp();

      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: {
          command: "node",
          kiroAutoApprove: ["read_file"],
          disabledTools: ["delete_file"],
        },
      });

      // Regenerating reproduces the file it was imported from.
      const regenerated = await KiroMcp.fromRulesyncMcp({ rulesyncMcp });
      expect(JSON.parse(regenerated.getFileContent())).toEqual({
        mcpServers: {
          api: {
            command: "node",
            autoApprove: ["read_file"],
            disabledTools: ["delete_file"],
          },
        },
      });
    });

    it("should leave a non-array autoApprove alone so the import stays parseable", () => {
      const kiroMcp = new KiroMcp({
        outputRoot: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { api: { command: "node", autoApprove: "all" } },
        }),
        validate: true,
      });

      const rulesyncMcp = kiroMcp.toRulesyncMcp();

      // `kiroAutoApprove` is typed as a string array, so renaming a bare string
      // onto it would produce a rulesync file the next generate cannot parse.
      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: { command: "node", autoApprove: "all" },
      });
    });
  });

  describe("fromRulesyncMcp in global mode", () => {
    const makeRulesyncMcp = () =>
      new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: { api: { command: "node" } } }),
        validate: true,
      });

    it("should keep the user's identityProvider block and other top-level keys", async () => {
      await writeFileContent(
        join(testDir, ".kiro", "settings", "mcp.json"),
        JSON.stringify({
          identityProvider: { issuer: "https://idp.example.com", clientId: "kiro" },
          futureKey: true,
          mcpServers: { stale: { command: "old" } },
        }),
      );

      const kiroMcp = await KiroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp(),
        global: true,
      });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        identityProvider: { issuer: "https://idp.example.com", clientId: "kiro" },
        futureKey: true,
        mcpServers: { api: { command: "node" } },
      });
    });

    it("should write only mcpServers when no user-level file exists", async () => {
      const kiroMcp = await KiroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp(),
        global: true,
      });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: { api: { command: "node" } },
      });
    });

    it("should refuse to overwrite an unparseable user-level file", async () => {
      await writeFileContent(join(testDir, ".kiro", "settings", "mcp.json"), "{ not json");

      await expect(
        KiroMcp.fromRulesyncMcp({
          outputRoot: testDir,
          rulesyncMcp: makeRulesyncMcp(),
          global: true,
        }),
      ).rejects.toThrow(/Failed to parse Kiro MCP config/);
    });

    it("should not merge an existing file in project mode", async () => {
      await writeFileContent(
        join(testDir, ".kiro", "settings", "mcp.json"),
        JSON.stringify({
          identityProvider: { issuer: "https://idp.example.com", clientId: "kiro" },
        }),
      );

      const kiroMcp = await KiroMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: makeRulesyncMcp(),
      });

      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: { api: { command: "node" } },
      });
    });
  });

  describe("forDeletion", () => {
    it("should not be deletable in global mode", () => {
      const kiroMcp = KiroMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        global: true,
      });

      expect(kiroMcp.isDeletable()).toBe(false);
    });

    it("should create deletable placeholder", () => {
      const kiroMcp = KiroMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "obsolete.json",
      });

      expect(kiroMcp.isDeletable()).toBe(true);
      expect(kiroMcp.getFileContent()).toBe("{}");
    });
  });
});
