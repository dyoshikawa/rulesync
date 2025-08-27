import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { McpProcessor, McpProcessorToolTargetSchema } from "./mcp-processor.js";

describe("McpProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should throw error with invalid tool target", () => {
      expect(() => {
        return new McpProcessor({
          baseDir: testDir,
          toolTarget: "invalid-tool" as any,
        });
      }).toThrow();
    });

    it("should validate all tool targets from schema", () => {
      const validTargets = [
        "amazonqcli",
        "augmentcode",
        "claudecode",
        "cline",
        "codexcli",
        "copilot",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "windsurf",
      ];

      for (const target of validTargets) {
        expect(() => {
          McpProcessorToolTargetSchema.parse(target);
        }).not.toThrow();
      }
    });
  });

  describe("loadRulesyncMcpConfigs", () => {
    it("should load MCP configs from .rulesync/mcp/ directory", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      // Create test MCP markdown file
      const mcpContent = `---
name: test-server
description: Test MCP server for testing
servers:
  test-server:
    command: test-command
    args:
      - --test
    env:
      TEST_VAR: test-value
tools:
  - name: test-tool
    description: Test tool
---

# Test MCP Configuration

This is a test MCP server configuration for testing purposes.
`;

      await writeFile(join(mcpDir, "test-mcp.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadRulesyncMcpConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0]?.getFrontmatter().name).toBe("test-server");
      expect(configs[0]?.getFrontmatter().description).toBe("Test MCP server for testing");
    });

    it("should throw error if .rulesync/mcp directory does not exist", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.loadRulesyncMcpConfigs()).rejects.toThrow(
        `Rulesync MCP directory not found: ${join(testDir, ".rulesync", "mcp")}`,
      );
    });

    it("should throw error if no markdown files found", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      // Create non-markdown file
      await writeFile(join(mcpDir, "not-markdown.txt"), "not a markdown file");

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.loadRulesyncMcpConfigs()).rejects.toThrow(
        `No markdown files found in rulesync MCP directory: ${mcpDir}`,
      );
    });

    it("should handle invalid MCP files gracefully", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      // Create valid file
      const validContent = `---
name: valid-server
description: Valid server
servers:
  valid-server:
    command: test
tools: []
---

Valid content`;

      // Create invalid file
      const invalidContent = "Invalid content without frontmatter";

      await writeFile(join(mcpDir, "valid.md"), validContent);
      await writeFile(join(mcpDir, "invalid.md"), invalidContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadRulesyncMcpConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0]?.getFrontmatter().name).toBe("valid-server");
    });
  });

  describe("writeToolMcpFromRulesyncMcp", () => {
    it("should write Claude Code MCP configuration", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      // Create test MCP file
      const mcpContent = `---
name: test-server
description: Test MCP server
servers:
  test-server:
    command: npx
    args:
      - test-mcp-server
    env:
      API_KEY: test-key
tools:
  - name: test-tool
    description: Test tool
---

# Test Configuration`;

      await writeFile(join(mcpDir, "test.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncConfigs = await processor.loadRulesyncMcpConfigs();
      await processor.writeToolMcpFromRulesyncMcp(rulesyncConfigs);

      // Verify the file was written
      const mcpFile = join(testDir, ".mcp.json");
      const fs = await import("node:fs/promises");
      const exists = await fs
        .access(mcpFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should write Cursor MCP configuration", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const mcpContent = `---
name: cursor-server
description: Cursor MCP server
servers:
  cursor-server:
    command: node
    args:
      - server.js
tools: []
---

# Cursor Configuration`;

      await writeFile(join(mcpDir, "cursor.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const rulesyncConfigs = await processor.loadRulesyncMcpConfigs();
      await processor.writeToolMcpFromRulesyncMcp(rulesyncConfigs);

      // Verify the file was written
      const mcpFile = join(testDir, ".cursor", "mcp.json");
      const fs = await import("node:fs/promises");
      const exists = await fs
        .access(mcpFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const mcpContent = `---
name: test-server
description: Test server
servers:
  test-server:
    command: test
tools: []
---

Test content`;

      await writeFile(join(mcpDir, "test.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock an unsupported tool target
      (processor as any).toolTarget = "unsupported";

      const rulesyncConfigs = await processor.loadRulesyncMcpConfigs();

      await expect(processor.writeToolMcpFromRulesyncMcp(rulesyncConfigs)).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });

    it("should throw error for copilot tool target", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const mcpContent = `---
name: test-server
description: Test server
servers:
  test-server:
    command: test
tools: []
---

Test content`;

      await writeFile(join(mcpDir, "test.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
      });

      const rulesyncConfigs = await processor.loadRulesyncMcpConfigs();

      await expect(processor.writeToolMcpFromRulesyncMcp(rulesyncConfigs)).rejects.toThrow(
        "Copilot MCP conversion from rulesync format is not supported due to multiple format variants",
      );
    });

    it("should throw error for opencode tool target", async () => {
      const mcpDir = join(testDir, ".rulesync", "mcp");
      await mkdir(mcpDir, { recursive: true });

      const mcpContent = `---
name: test-server
description: Test server
servers:
  test-server:
    command: test
tools: []
---

Test content`;

      await writeFile(join(mcpDir, "test.md"), mcpContent);

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const rulesyncConfigs = await processor.loadRulesyncMcpConfigs();

      await expect(processor.writeToolMcpFromRulesyncMcp(rulesyncConfigs)).rejects.toThrow(
        "OpenCode MCP conversion from rulesync format is not supported",
      );
    });
  });

  describe("loadToolMcpConfigs", () => {
    it("should load Claude Code MCP config", async () => {
      // Create .mcp.json file
      const mcpConfig = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["test-server"],
          },
        },
      };

      await writeFile(join(testDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadToolMcpConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0]?.getFileName()).toBe(".mcp.json");
    });

    it("should load Cursor MCP config", async () => {
      const cursorDir = join(testDir, ".cursor");
      await mkdir(cursorDir, { recursive: true });

      const mcpConfig = {
        mcpServers: {
          "cursor-server": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      await writeFile(join(cursorDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
      });

      const configs = await processor.loadToolMcpConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0]?.getFileName()).toBe(".cursor/mcp.json");
    });

    it("should return empty array if no config file exists", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadToolMcpConfigs();

      expect(configs).toHaveLength(0);
    });

    it("should handle invalid config files gracefully", async () => {
      // Create invalid JSON file
      await writeFile(join(testDir, ".mcp.json"), "invalid json content");

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadToolMcpConfigs();

      expect(configs).toHaveLength(0);
    });
  });

  describe("writeRulesyncMcpFromToolMcp", () => {
    it("should throw error as conversion is not yet implemented", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(
        processor
          .loadToolMcpConfigs()
          .then((configs) => processor.writeRulesyncMcpFromToolMcp(configs)),
      ).rejects.toThrow(
        "Converting tool-specific MCP configurations to rulesync format is not yet implemented",
      );
    });
  });

  describe("integration with various tool targets", () => {
    it("should work with Amazon Q CLI", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "amazonqcli",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should work with AugmentCode", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "augmentcode",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should work with Cline", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "cline",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });

    it("should work with Windsurf", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "windsurf",
      });

      expect(processor).toBeInstanceOf(McpProcessor);
    });
  });

  describe("error handling", () => {
    it("should handle missing directories gracefully in loadToolMcpConfigs", async () => {
      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Should not throw, just return empty array
      const configs = await processor.loadToolMcpConfigs();
      expect(configs).toHaveLength(0);
    });

    it("should handle file read errors gracefully", async () => {
      // Create a directory where a file should be (to cause read error)
      const mcpPath = join(testDir, ".mcp.json");
      await mkdir(mcpPath, { recursive: true });

      const processor = new McpProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const configs = await processor.loadToolMcpConfigs();
      expect(configs).toHaveLength(0);
    });
  });

  describe("McpProcessorToolTargetSchema", () => {
    it("should validate all supported tool targets", () => {
      const validTargets = [
        "amazonqcli",
        "augmentcode",
        "claudecode",
        "cline",
        "codexcli",
        "copilot",
        "cursor",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "windsurf",
      ];

      for (const target of validTargets) {
        expect(() => McpProcessorToolTargetSchema.parse(target)).not.toThrow();
      }
    });

    it("should reject invalid tool targets", () => {
      const invalidTargets = ["invalid", "unknown", "", null, undefined];

      for (const target of invalidTargets) {
        expect(() => McpProcessorToolTargetSchema.parse(target)).toThrow();
      }
    });
  });
});
