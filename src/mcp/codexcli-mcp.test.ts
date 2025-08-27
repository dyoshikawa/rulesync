import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { CodexcliMcp, CodexcliMcpConfig } from "./codexcli-mcp.js";
import { RulesyncMcp, RulesyncMcpFrontmatter } from "./rulesync-mcp.js";

describe("CodexcliMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  describe("constructor", () => {
    it("should create an instance with valid local (STDIO) configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "python-tools": {
              type: "local",
              command: ["python", "-m", "my_mcp_server"],
              args: ["--port", "8080"],
              environment: {
                OPENAI_API_KEY: "sk-test",
                CODEX_DEFAULT_MODEL: "gpt-4o-mini",
              },
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with valid remote configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "remote-server": {
              type: "remote",
              url: "https://mcp.example.com/codex",
              headers: {
                Authorization: "Bearer test-token",
              },
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should create an instance with Docker-based configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "docker-server": {
              type: "local",
              command: ["docker", "run", "-i", "--rm", "codex-mcp:latest"],
              environment: {
                OPENAI_API_KEY: "${OPENAI_API_KEY}",
                DATABASE_URL: "${DATABASE_URL}",
              },
              cwd: "/workspace",
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid configuration when validation enabled", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          mcp: {
            "invalid-server": {
              // Missing both command and url
              args: ["arg1"],
            },
          },
        };

        // Create instance with validation disabled first
        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(invalidConfig, null, 2),
          config: invalidConfig as CodexcliMcpConfig,
          validate: false,
        });

        // Validation should fail when called explicitly
        const validationResult = codexcliMcp.validate();
        expect(validationResult.success).toBe(false);
        expect(validationResult.error?.message).toContain(
          "must have either 'command' (for local) or 'url' (for remote)",
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe("getFileName", () => {
    it("should return 'opencode.json'", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            test: { type: "local", command: "test" },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        expect(codexcliMcp.getFileName()).toBe("opencode.json");
      } finally {
        await cleanup();
      }
    });
  });

  describe("generateContent", () => {
    it("should generate valid JSON content", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "node-server": {
              type: "local",
              command: ["node", "server.js"],
              args: ["--verbose"],
              environment: {
                NODE_ENV: "development",
              },
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: "",
          config,
        });

        const content = await codexcliMcp.generateContent();
        const parsedContent = JSON.parse(content);
        expect(parsedContent).toEqual(config);
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromRulesyncMcp", () => {
    it("should convert RulesyncMcp to CodexcliMcp correctly", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          command: "python",
          args: ["-m", "test_server"],
          env: {
            API_KEY: "test-key",
          },
        };

        const rulesyncFrontmatter: RulesyncMcpFrontmatter = {
          name: "Test MCP Server",
          description: "Test MCP server configuration",
          targets: ["codexcli"],
          servers: {
            "test-server": rulesyncServer,
          },
        };

        const rulesyncContent = `---
targets:
  - codexcli
---

## MCP Server Configuration

\`\`\`json
{
  "mcpServers": {
    "test-server": ${JSON.stringify(rulesyncServer, null, 2)}
  }
}
\`\`\`
`;

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.md",
          fileContent: rulesyncContent,
          body: rulesyncContent,
          frontmatter: rulesyncFrontmatter,
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getFileName()).toBe("opencode.json");

        const config = codexcliMcp.getConfig();
        expect(config["$schema"]).toBe("https://opencode.ai/config.json");
        const server = config.mcp["test-server"];
        expect(server).toBeDefined();
        expect(server?.type).toBe("local");
        expect(server?.command).toEqual(["python"]);
        expect(server?.args).toEqual(["-m", "test_server"]);
        expect(server?.environment).toEqual({ API_KEY: "test-key" });
        expect(server?.enabled).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it("should convert remote server configuration correctly", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          url: "https://api.example.com/mcp",
          headers: {
            Authorization: "Bearer token",
            "X-Custom-Header": "value",
          },
        };

        const rulesyncFrontmatter: RulesyncMcpFrontmatter = {
          name: "Remote MCP Server",
          description: "Remote MCP server configuration",
          targets: ["codexcli"],
          servers: {
            "remote-api": rulesyncServer,
          },
        };

        const rulesyncContent = `---
targets:
  - codexcli
---

## MCP Server Configuration

\`\`\`json
{
  "mcpServers": {
    "remote-api": ${JSON.stringify(rulesyncServer, null, 2)}
  }
}
\`\`\`
`;

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.md",
          fileContent: rulesyncContent,
          body: rulesyncContent,
          frontmatter: rulesyncFrontmatter,
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");
        const config = codexcliMcp.getConfig();

        const server = config.mcp["remote-api"];
        expect(server).toBeDefined();
        expect(server?.type).toBe("remote");
        expect(server?.url).toBe("https://api.example.com/mcp");
        expect(server?.headers).toEqual({
          Authorization: "Bearer token",
          "X-Custom-Header": "value",
        });
        expect(server?.enabled).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it("should handle disabled servers correctly", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const rulesyncServer: RulesyncMcpServer = {
          command: "test",
          disabled: true,
        };

        const rulesyncFrontmatter: RulesyncMcpFrontmatter = {
          name: "Disabled MCP Server",
          description: "Disabled MCP server configuration",
          targets: ["codexcli"],
          servers: {
            "disabled-server": rulesyncServer,
          },
        };

        const rulesyncContent = `---
targets:
  - codexcli
---

## MCP Server Configuration

\`\`\`json
{
  "mcpServers": {
    "disabled-server": ${JSON.stringify(rulesyncServer, null, 2)}
  }
}
\`\`\`
`;

        const rulesyncMcp = new RulesyncMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "mcp.md",
          fileContent: rulesyncContent,
          body: rulesyncContent,
          frontmatter: rulesyncFrontmatter,
        });

        const codexcliMcp = CodexcliMcp.fromRulesyncMcp(rulesyncMcp, testDir, ".");
        const config = codexcliMcp.getConfig();

        const server = config.mcp["disabled-server"];
        expect(server?.enabled).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });

  describe("validate", () => {
    it("should pass validation for valid configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "valid-server": {
              type: "local",
              command: "python",
              args: ["-m", "server"],
              enabled: true,
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for empty server configuration", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {},
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("At least one MCP server must be defined");
      } finally {
        await cleanup();
      }
    });

    it("should fail validation for server with both local and remote config", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          mcp: {
            "invalid-server": {
              command: "python",
              url: "https://example.com",
            },
          },
        };

        const codexcliMcp = new CodexcliMcp({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          fileContent: JSON.stringify(config, null, 2),
          config,
          validate: false,
        });

        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("cannot have both local ('command') and remote");
      } finally {
        await cleanup();
      }
    });
  });

  describe("fromFilePath", () => {
    it("should load configuration from file path", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const config: CodexcliMcpConfig = {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "file-server": {
              type: "local",
              command: ["python", "-m", "server"],
              environment: {
                API_KEY: "test",
              },
              enabled: true,
            },
          },
        };

        const filePath = join(testDir, "opencode.json");
        await writeFile(filePath, JSON.stringify(config, null, 2));

        const codexcliMcp = await CodexcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          filePath,
        });

        expect(codexcliMcp).toBeDefined();
        expect(codexcliMcp.getConfig()).toEqual(config);
      } finally {
        await cleanup();
      }
    });

    it("should handle full opencode.json file with MCP section", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const fullConfig = {
          $schema: "https://opencode.ai/config.json",
          instructions: ["CONTRIBUTING.md", "docs/*-guidelines.md"],
          provider: "openai",
          model: "gpt-4",
          mcp: {
            "test-server": {
              type: "local",
              command: "test",
              enabled: true,
            },
          },
        };

        const filePath = join(testDir, "opencode.json");
        await writeFile(filePath, JSON.stringify(fullConfig, null, 2));

        const codexcliMcp = await CodexcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          filePath,
        });

        const config = codexcliMcp.getConfig();
        expect(config["$schema"]).toBe("https://opencode.ai/config.json");
        const server = config.mcp["test-server"];
        expect(server).toBeDefined();
        expect(server?.type).toBe("local");
      } finally {
        await cleanup();
      }
    });

    it("should throw error for invalid configuration file", async () => {
      ({ testDir, cleanup } = await setupTestDirectory());

      try {
        const invalidConfig = {
          mcp: {
            invalid: {
              // Missing required fields
            },
          },
        };

        const filePath = join(testDir, "opencode.json");
        await writeFile(filePath, JSON.stringify(invalidConfig, null, 2));

        // Create instance with validation disabled first
        const codexcliMcp = await CodexcliMcp.fromFilePath({
          baseDir: testDir,
          relativeDirPath: ".",
          relativeFilePath: "opencode.json",
          filePath,
          validate: false,
        });

        // Validation should fail
        const result = codexcliMcp.validate();
        expect(result.success).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });
});
