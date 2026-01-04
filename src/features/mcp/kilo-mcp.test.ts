import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KiloMcp } from "./kilo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("KiloMcp", () => {
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
      expect(KiloMcp.getSettablePaths()).toEqual({
        relativeDirPath: ".kilocode",
        relativeFilePath: "mcp.json",
      });
    });

    it("should return global path", () => {
      expect(KiloMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "mcp_settings.json",
      });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert exposed servers for project mode", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            exposedServer: { command: "node", args: ["server.js"], exposed: true },
            hiddenServer: { command: "python", args: ["hidden.py"] },
          },
        }),
        validate: true,
      });

      const kiloMcp = KiloMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(kiloMcp.getRelativeDirPath()).toBe(".kilocode");
      expect(kiloMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(kiloMcp.getFileContent())).toEqual({
        mcpServers: {
          exposedServer: { command: "node", args: ["server.js"] },
          hiddenServer: { command: "python", args: ["hidden.py"] },
        },
      });
    });

    it("should use global path when requested", () => {
      const rulesyncMcp = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: JSON.stringify({ mcpServers: {} }),
        validate: true,
      });

      const kiloMcp = KiloMcp.fromRulesyncMcp({
        rulesyncMcp,
        baseDir: testDir,
        global: true,
      });

      expect(kiloMcp.getRelativeDirPath()).toBe(".");
      expect(kiloMcp.getRelativeFilePath()).toBe("mcp_settings.json");
    });
  });

  describe("fromFile", () => {
    it("should initialize missing project file", async () => {
      const kiloMcp = await KiloMcp.fromFile({ baseDir: testDir });

      expect(kiloMcp.getFilePath()).toBe(join(testDir, ".kilocode", "mcp.json"));
      expect(JSON.parse(kiloMcp.getFileContent())).toEqual({ mcpServers: {} });
    });

    it("should read existing global file", async () => {
      const globalPath = join(testDir, "mcp_settings.json");
      await writeFileContent(
        globalPath,
        JSON.stringify({ mcpServers: { api: { command: "go" } } }, null, 2),
      );

      const kiloMcp = await KiloMcp.fromFile({ baseDir: testDir, global: true });

      expect(kiloMcp.getFilePath()).toBe(globalPath);
      expect(JSON.parse(kiloMcp.getFileContent())).toEqual({
        mcpServers: { api: { command: "go" } },
      });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to Rulesync format", () => {
      const kiloMcp = new KiloMcp({
        baseDir: testDir,
        relativeDirPath: ".kilocode",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: { command: "node", args: ["server.js"] },
          },
        }),
        validate: true,
      });

      const rulesyncMcp = kiloMcp.toRulesyncMcp();

      expect(rulesyncMcp.getFilePath()).toBe(join(testDir, ".rulesync", ".mcp.json"));
      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: { command: "node", args: ["server.js"] },
      });
    });
  });

  describe("forDeletion", () => {
    it("should create deletable placeholder", () => {
      const kiloMcp = KiloMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kilocode",
        relativeFilePath: "obsolete.json",
      });

      expect(kiloMcp.isDeletable()).toBe(true);
      expect(kiloMcp.getFileContent()).toBe("{}");
    });
  });
});
