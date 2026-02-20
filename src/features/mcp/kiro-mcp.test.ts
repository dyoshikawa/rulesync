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

      const kiroMcp = KiroMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(kiroMcp.getRelativeDirPath()).toBe(join(".kiro", "settings"));
      expect(kiroMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({
        mcpServers: {
          exposedServer: { command: "node", args: ["server.js"] },
          hiddenServer: { command: "python", args: ["hidden.py"] },
        },
      });
    });
  });

  describe("fromFile", () => {
    it("should initialize missing project file", async () => {
      const kiroMcp = await KiroMcp.fromFile({ baseDir: testDir });

      expect(kiroMcp.getFilePath()).toBe(join(testDir, ".kiro", "settings", "mcp.json"));
      expect(JSON.parse(kiroMcp.getFileContent())).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to Rulesync format", () => {
      const kiroMcp = new KiroMcp({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: {
            api: { command: "node", args: ["server.js"] },
          },
        }),
        validate: true,
      });

      const rulesyncMcp = kiroMcp.toRulesyncMcp();

      expect(rulesyncMcp.getFilePath()).toBe(join(testDir, ".rulesync", ".mcp.json"));
      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: { command: "node", args: ["server.js"] },
      });
    });
  });

  describe("forDeletion", () => {
    it("should create deletable placeholder", () => {
      const kiroMcp = KiroMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "obsolete.json",
      });

      expect(kiroMcp.isDeletable()).toBe(true);
      expect(kiroMcp.getFileContent()).toBe("{}");
    });
  });
});
