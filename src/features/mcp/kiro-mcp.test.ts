import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
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
    it("should convert exposed servers for project mode", () => {
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

      const kiroMcp = KiroMcp.fromRulesyncMcp({ rulesyncMcp });

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

    it("should translate kiroAutoApprove and kiroAutoBlock onto Kiro's native keys", () => {
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

      const kiroMcp = KiroMcp.fromRulesyncMcp({ rulesyncMcp });

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

    it("should union the translated lists with natively spelled ones", () => {
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

      const kiroMcp = KiroMcp.fromRulesyncMcp({ rulesyncMcp });

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

    it("should keep an explicitly authored empty list so generate stays idempotent", () => {
      const rulesyncMcp = new RulesyncMcp({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { api: { command: "node", disabledTools: [] } },
        }),
        validate: true,
      });

      const kiroMcp = KiroMcp.fromRulesyncMcp({ rulesyncMcp });

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

    it("should translate autoApprove back to kiroAutoApprove and round-trip", () => {
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
      const regenerated = KiroMcp.fromRulesyncMcp({ rulesyncMcp });
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

  describe("forDeletion", () => {
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
