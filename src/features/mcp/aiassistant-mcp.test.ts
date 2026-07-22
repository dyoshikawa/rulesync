import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AiassistantMcp } from "./aiassistant-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("AiassistantMcp", () => {
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

      const aiassistantMcp = new AiassistantMcp({
        relativeDirPath: ".ai/mcp",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(aiassistantMcp).toBeInstanceOf(AiassistantMcp);
      expect(aiassistantMcp.getRelativeDirPath()).toBe(".ai/mcp");
      expect(aiassistantMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(aiassistantMcp.getJson()).toEqual(JSON.parse(validJsonContent));
    });
  });

  describe("fromFile", () => {
    it("reads .ai/mcp/mcp.json from disk", async () => {
      const dir = join(testDir, ".ai/mcp");
      await ensureDir(dir);
      const filePath = join(dir, "mcp.json");
      const content = JSON.stringify({ mcpServers: { A: { command: "echo" } } }, null, 2);
      await writeFileContent(filePath, content);

      const aiassistant = await AiassistantMcp.fromFile({ outputRoot: testDir, validate: true });

      expect(aiassistant.getFilePath()).toBe(filePath);
      expect(aiassistant.getFileContent()).toBe(content);
      expect(aiassistant.getJson()).toEqual(JSON.parse(content));
    });
  });

  describe("getSettablePaths", () => {
    describe("getSettablePaths", () => {
      it("returns the same .ai/mcp/mcp.json path for project and global mode", () => {
        const projectPaths = AiassistantMcp.getSettablePaths({ global: false });
        const globalPaths = AiassistantMcp.getSettablePaths({ global: true });
        const expected = { relativeDirPath: join(".ai", "mcp"), relativeFilePath: "mcp.json" };
        expect(projectPaths).toEqual(expected);
        expect(globalPaths).toEqual(expected);
      });
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
        fileContent: rulesyncContent,
      });

      const aiassistant = AiassistantMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp: rulesync,
      });

      expect(aiassistant.getRelativeDirPath()).toBe(".ai/mcp");
      expect(aiassistant.getRelativeFilePath()).toBe("mcp.json");
      expect(aiassistant.getFileContent()).toBe(rulesyncContent);
    });
  });

  describe("toRulesyncMcp", () => {
    it("maps back to a RulesyncMcp with same content", () => {
      const content = JSON.stringify({ mcpServers: { X: { command: "echo" } } }, null, 2);
      const aiassistant = new AiassistantMcp({
        outputRoot: testDir,
        relativeDirPath: ".ai/mcp",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      const rulesync = aiassistant.toRulesyncMcp();
      expect(rulesync).toBeInstanceOf(RulesyncMcp);
      expect(rulesync.getRelativeDirPath()).toBe(RULESYNC_RELATIVE_DIR_PATH);
      expect(rulesync.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rulesync.getFileContent())).toEqual({
        $schema: RULESYNC_MCP_SCHEMA_URL,
        ...JSON.parse(content),
      });
    });
  });
});
