import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
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
  });

  describe("fromFile", () => {
    it("should initialize missing project file", async () => {
      const kiloMcp = await KiloMcp.fromFile({ baseDir: testDir });

      expect(kiloMcp.getFilePath()).toBe(join(testDir, ".kilocode", "mcp.json"));
      expect(JSON.parse(kiloMcp.getFileContent())).toEqual({ mcpServers: {} });
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
