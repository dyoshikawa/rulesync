import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieMcp } from "./junie-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("JunieMcp", () => {
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

  describe("constructor", () => {
    it("creates an instance and parses JSON", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": { command: "node", args: ["server.js"] },
        },
      });

      const junieMcp = new JunieMcp({
        relativeDirPath: ".junie/mcp",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(junieMcp).toBeInstanceOf(JunieMcp);
      expect(junieMcp.getRelativeDirPath()).toBe(".junie/mcp");
      expect(junieMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(junieMcp.getJson()).toEqual(JSON.parse(validJsonContent));
    });
  });

  describe("fromFile", () => {
    it("reads .junie/mcp/mcp.json from disk", async () => {
      const dir = join(testDir, ".junie/mcp");
      await ensureDir(dir);
      const filePath = join(dir, "mcp.json");
      const content = JSON.stringify({ mcpServers: { A: { command: "echo" } } }, null, 2);
      await writeFileContent(filePath, content);

      const junie = await JunieMcp.fromFile({ baseDir: testDir, validate: true });

      expect(junie.getFilePath()).toBe(filePath);
      expect(junie.getFileContent()).toBe(content);
      expect(junie.getJson()).toEqual(JSON.parse(content));
    });
  });

  describe("fromRulesyncMcp", () => {
    it("copies content from .rulesync/.mcp.json", async () => {
      const rulesyncContent = JSON.stringify(
        { mcpServers: { B: { command: "node", args: ["b.js"] } } },
        null,
        2,
      );
      const rulesync = new RulesyncMcp({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: rulesyncContent,
      });

      const junie = JunieMcp.fromRulesyncMcp({ baseDir: testDir, rulesyncMcp: rulesync });

      expect(junie.getRelativeDirPath()).toBe(".junie/mcp");
      expect(junie.getRelativeFilePath()).toBe("mcp.json");
      expect(junie.getFileContent()).toBe(rulesyncContent);
    });
  });

  describe("toRulesyncMcp", () => {
    it("maps back to a RulesyncMcp with same content", () => {
      const content = JSON.stringify({ mcpServers: { X: { command: "echo" } } }, null, 2);
      const junie = new JunieMcp({
        baseDir: testDir,
        relativeDirPath: ".junie/mcp",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      const rulesync = junie.toRulesyncMcp();
      expect(rulesync).toBeInstanceOf(RulesyncMcp);
      expect(rulesync.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesync.getRelativeFilePath()).toBe(".mcp.json");
      expect(rulesync.getFileContent()).toBe(content);
    });
  });
});
