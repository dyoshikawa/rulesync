import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("RooMcp", () => {
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
    it("should create instance with default parameters", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with custom baseDir", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {},
      });

      const rooMcp = new RooMcp({
        baseDir: "/custom/path",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getBaseDir()).toBe("/custom/path");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with validation enabled", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });

    it("should create instance with validation disabled", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getFileContent()).toBe(validJsonContent);
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file with default parameters", async () => {
      const rooDir = join(testDir, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent, null, 2));

      const rooMcp = await RooMcp.fromFile({
        baseDir: testDir,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getBaseDir()).toBe(testDir);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from existing file with validation disabled", async () => {
      const rooDir = join(testDir, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["-m", "server.main"],
          },
        },
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent, null, 2));

      const rooMcp = await RooMcp.fromFile({
        baseDir: testDir,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getBaseDir()).toBe(testDir);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        RooMcp.fromFile({
          baseDir: testDir,
        }),
      ).rejects.toThrow();
    });

    it("should create instance with custom baseDir parameter", async () => {
      const customBaseDir = join(testDir, "custom");
      const rooDir = join(customBaseDir, ".roo");
      const mcpFilePath = join(rooDir, "mcp.json");

      const mcpContent = {
        mcpServers: {},
      };

      await ensureDir(rooDir);
      await writeFileContent(mcpFilePath, JSON.stringify(mcpContent));

      const rooMcp = await RooMcp.fromFile({
        baseDir: customBaseDir,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should create instance from RulesyncMcp with default parameters", () => {
      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getBaseDir()).toBe(testDir);
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with custom baseDir", () => {
      const mcpContent = {
        mcpServers: {
          "custom-server": {
            command: "python",
            args: ["-m", "server.main"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        baseDir: "/custom/base",
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(rooMcp.getBaseDir()).toBe("/custom/base");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with validation enabled", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: true,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should create instance from RulesyncMcp with validation disabled", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
        validate: false,
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
        validate: false,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should handle empty mcpServers object", () => {
      const mcpContent = {
        mcpServers: {},
      };

      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rooMcp = RooMcp.fromRulesyncMcp({
        rulesyncMcp,
      });

      expect(rooMcp).toBeInstanceOf(RooMcp);
      expect(JSON.parse(rooMcp.getFileContent())).toEqual(mcpContent);
    });
  });

  describe("toRulesyncMcp", () => {
    it("should convert to RulesyncMcp", () => {
      const mcpContent = {
        mcpServers: {
          "@anthropic-ai/mcp-server-git": {
            command: "node",
            args: ["path/to/git-server.js"],
          },
        },
      };

      const rooMcp = new RooMcp({
        baseDir: "/test/path",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      expect(rulesyncMcp).toBeInstanceOf(RulesyncMcp);
      expect(rulesyncMcp.getBaseDir()).toBe("/test/path");
      expect(rulesyncMcp.getRelativeDirPath()).toBe(".rulesync");
      expect(rulesyncMcp.getRelativeFilePath()).toBe(".mcp.json");
      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(mcpContent);
    });

    it("should preserve content when converting to RulesyncMcp", () => {
      const complexMcpContent = {
        mcpServers: {
          "server-1": {
            command: "node",
            args: ["server1.js"],
            env: {
              NODE_ENV: "production",
            },
          },
          "server-2": {
            command: "python",
            args: ["-m", "server2.main"],
            cwd: "/path/to/server2",
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(complexMcpContent),
      });

      const rulesyncMcp = rooMcp.toRulesyncMcp();

      expect(JSON.parse(rulesyncMcp.getFileContent())).toEqual(complexMcpContent);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const validJsonContent = JSON.stringify({
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: validJsonContent,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });

    it("should return success with minimal valid JSON", () => {
      const minimalContent = JSON.stringify({ mcpServers: {} });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: minimalContent,
        validate: false,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });

    it("should return success with complex configuration", () => {
      const complexContent = JSON.stringify({
        mcpServers: {
          "server-1": {
            command: "node",
            args: ["server1.js"],
            env: { NODE_ENV: "production" },
          },
          "server-2": {
            command: "python",
            args: ["-m", "server2.main"],
          },
        },
      });

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: complexContent,
        validate: false,
      });

      const result = rooMcp.validate();

      expect(result).toEqual({
        success: true,
        error: null,
      });
    });
  });

  describe("inherited methods from ToolMcp", () => {
    it("should have access to getJson method", () => {
      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify(mcpContent),
      });

      const json = rooMcp.getJson();
      expect(json).toEqual(mcpContent);
    });

    it("should have access to base directory methods", () => {
      const rooMcp = new RooMcp({
        baseDir: "/test/base",
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: "{}",
      });

      expect(rooMcp.getBaseDir()).toBe("/test/base");
      expect(rooMcp.getRelativeDirPath()).toBe(".roo");
      expect(rooMcp.getRelativeFilePath()).toBe("mcp.json");
    });

    it("should have access to file content methods", () => {
      const content = JSON.stringify({ mcpServers: {} });
      const rooMcp = new RooMcp({
        relativeDirPath: ".roo",
        relativeFilePath: "mcp.json",
        fileContent: content,
      });

      expect(rooMcp.getFileContent()).toBe(content);
    });
  });
});
