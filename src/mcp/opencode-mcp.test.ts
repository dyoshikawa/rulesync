import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { setupTestDirectory } from "../test-utils/index.js";
import type { McpConfig } from "../types/mcp.js";
import { OpencodeMcp } from "./opencode-mcp.js";

describe("OpencodeMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("basic functionality", () => {
    it("should return correct filename", () => {
      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
      });

      expect(mcp.getFileName()).toBe("opencode.json");
    });

    it("should generate default configuration", async () => {
      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
      });

      const content = await mcp.generateContent();
      const config = JSON.parse(content);

      expect(config).toHaveProperty("$schema", "https://opencode.ai/config.json");
      expect(config).toHaveProperty("mcp");
      expect(config.mcp).toHaveProperty("filesystem-tools");
      expect(config.mcp).toHaveProperty("github-integration");
    });

    it("should validate successfully with required fields", () => {
      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: true,
      });

      const result = mcp.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("local server configuration", () => {
    it("should configure local STDIO server", async () => {
      const config: McpConfig = {
        mcpServers: {
          filesystem: {
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
            disabled: false,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp.filesystem).toEqual({
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
        enabled: true,
      });
    });

    it("should configure server with environment variables", async () => {
      const config: McpConfig = {
        mcpServers: {
          github: {
            command: ["node", "server.js"],
            env: {
              GITHUB_TOKEN: "${GITHUB_TOKEN}",
              API_KEY: "${API_KEY}",
            },
            disabled: false,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp.github).toEqual({
        type: "local",
        command: ["node", "server.js"],
        enabled: true,
        environment: {
          GITHUB_TOKEN: "${GITHUB_TOKEN}",
          API_KEY: "${API_KEY}",
        },
      });
    });

    it("should configure server with working directory", async () => {
      const config: McpConfig = {
        mcpServers: {
          "custom-server": {
            command: ["python", "-m", "server"],
            cwd: "/workspace/tools",
            disabled: false,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp["custom-server"]).toEqual({
        type: "local",
        command: ["python", "-m", "server"],
        enabled: true,
        cwd: "/workspace/tools",
      });
    });
  });

  describe("remote server configuration", () => {
    it("should configure remote server", async () => {
      const config: McpConfig = {
        mcpServers: {
          "external-api": {
            url: "https://api.example.com/mcp",
            disabled: false,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp["external-api"]).toEqual({
        type: "remote",
        url: "https://api.example.com/mcp",
        enabled: true,
      });
    });

    it("should configure remote server with authentication headers", async () => {
      const config: McpConfig = {
        mcpServers: {
          "api-server": {
            url: "https://api.company.com/mcp",
            env: {
              API_TOKEN: "${COMPANY_API_TOKEN}",
              CUSTOM_VAR: "${CUSTOM_SETTING}",
            },
            disabled: false,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp["api-server"]).toEqual({
        type: "remote",
        url: "https://api.company.com/mcp",
        enabled: true,
        headers: {
          Authorization: "Bearer ${COMPANY_API_TOKEN}",
          "X-CUSTOM-VAR": "${CUSTOM_SETTING}",
        },
      });
    });
  });

  describe("fromFilePath", () => {
    it("should load valid OpenCode configuration", async () => {
      const configData = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
            enabled: true,
          },
        },
      };

      const configPath = join(testDir, "opencode.json");
      await writeFile(configPath, JSON.stringify(configData, null, 2));

      const mcp = await OpencodeMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        filePath: configPath,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp.filesystem).toBeDefined();
      expect(parsed.mcp.filesystem.command).toEqual([
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
        ".",
      ]);
    });

    it("should handle configuration without schema", async () => {
      const configData = {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          "simple-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
      };

      const configPath = join(testDir, "opencode.json");
      await writeFile(configPath, JSON.stringify(configData, null, 2));

      const mcp = await OpencodeMcp.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        filePath: configPath,
      });

      expect(mcp).toBeInstanceOf(OpencodeMcp);
    });
  });

  describe("disabled server handling", () => {
    it("should handle disabled servers", async () => {
      const config: McpConfig = {
        mcpServers: {
          "disabled-server": {
            command: ["node", "server.js"],
            disabled: true,
          },
        },
      };

      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
        config,
      });

      const content = await mcp.generateContent();
      const parsed = JSON.parse(content);

      expect(parsed.mcp["disabled-server"]).toEqual({
        type: "local",
        command: ["node", "server.js"],
        enabled: false,
      });
    });
  });

  describe("JSON formatting", () => {
    it("should produce properly formatted JSON", async () => {
      const mcp = new OpencodeMcp({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "",
        validate: false,
      });

      const content = await mcp.generateContent();

      // Check that JSON is formatted with 2-space indentation
      expect(content).toContain('{\n  "$schema"');
      expect(content).toContain('  "mcp": {');
      
      // Verify it's valid JSON
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });
});