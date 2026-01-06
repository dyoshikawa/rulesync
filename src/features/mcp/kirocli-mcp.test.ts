import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { KiroCliMcp } from "./kirocli-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("KiroCliMcp", () => {
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
      expect(KiroCliMcp.getSettablePaths()).toEqual({
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
      });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert exposed servers for project mode", async () => {
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

      const kiroCliMcp = await KiroCliMcp.fromRulesyncMcp({ rulesyncMcp });

      expect(kiroCliMcp.getRelativeDirPath()).toBe(join(".kiro", "settings"));
      expect(kiroCliMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(kiroCliMcp.getFileContent())).toEqual({
        mcpServers: {
          exposedServer: { command: "node", args: ["server.js"] },
          hiddenServer: { command: "python", args: ["hidden.py"] },
        },
      });
    });
  });

  describe("fromFile", () => {
    it("should initialize missing project file", async () => {
      const kiroCliMcp = await KiroCliMcp.fromFile({ baseDir: testDir });

      expect(kiroCliMcp.getFilePath()).toBe(join(testDir, ".kiro", "settings", "mcp.json"));
      expect(JSON.parse(kiroCliMcp.getFileContent())).toEqual({ mcpServers: {} });
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to Rulesync format", () => {
      const kiroCliMcp = new KiroCliMcp({
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

      const rulesyncMcp = kiroCliMcp.toRulesyncMcp();

      expect(rulesyncMcp.getFilePath()).toBe(join(testDir, ".rulesync", ".mcp.json"));
      expect(rulesyncMcp.getMcpServers()).toEqual({
        api: { command: "node", args: ["server.js"] },
      });
    });
  });

  describe("forDeletion", () => {
    it("should create deletable placeholder", () => {
      const kiroCliMcp = KiroCliMcp.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "obsolete.json",
      });

      expect(kiroCliMcp.isDeletable()).toBe(true);
      expect(kiroCliMcp.getFileContent()).toBe("{}");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const kiroCliMcp = new KiroCliMcp({
        baseDir: testDir,
        relativeDirPath: join(".kiro", "settings"),
        relativeFilePath: "mcp.json",
        fileContent: "{}",
        validate: true,
      });

      const result = kiroCliMcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
