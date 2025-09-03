import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRulesyncSubagent, createMockToolFile } from "../test-utils/mock-factories.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import * as fileUtils from "../utils/file.js";
// import { RulesyncSubagent } from "./rulesync-subagent.js"; // Now using mock factories
import { SubagentsProcessor } from "./subagents-processor.js";

// Only mock specific functions, not the entire module to avoid conflicts with setupTestDirectory
vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual("../utils/file.js");
  return {
    ...actual,
    directoryExists: vi.fn(),
    listDirectoryFiles: vi.fn(),
    findFiles: vi.fn(),
    readFileContent: vi.fn(),
  };
});
vi.mock("../utils/logger.js");

describe("SubagentsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with claudecode target", () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should use current directory as default baseDir", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should validate tool target", () => {
      expect(() => {
        void new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "invalid" as any,
        });
      }).toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return supported subagent tool targets", () => {
      const targets = SubagentsProcessor.getToolTargets();

      expect(targets).toContain("claudecode");
      expect(targets).toHaveLength(1);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync subagents to claudecode subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncSubagent = createMockRulesyncSubagent({
        testDir,
        fileName: "test-subagent.md",
        content: `# Test Subagent\n\nThis is a test subagent for Claude Code.`,
        frontmatter: {
          name: "test-subagent",
          description: "Test subagent",
        },
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncSubagent]);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".claude/agents/test-subagent.md");
    });

    it("should handle multiple subagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockSubagent1 = createMockRulesyncSubagent({
        testDir,
        fileName: "subagent1.md",
        content: "# Subagent 1",
        frontmatter: { name: "subagent1", description: "Subagent 1" },
      });

      const mockSubagent2 = createMockRulesyncSubagent({
        testDir,
        fileName: "subagent2.md",
        content: "# Subagent 2",
        frontmatter: { name: "subagent2", description: "Subagent 2" },
      });

      const result = await processor.convertRulesyncFilesToToolFiles([
        mockSubagent1,
        mockSubagent2,
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]?.getFilePath()).toContain("subagent1.md");
      expect(result[1]?.getFilePath()).toContain("subagent2.md");
    });

    it("should filter non-subagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockNonSubagent = {
        filePath: "some/other/file.md",
        content: "not a subagent",
      };

      const result = await processor.convertRulesyncFilesToToolFiles([mockNonSubagent as any]);

      expect(result).toHaveLength(0);
    });

    it("should throw error for unsupported tool target", async () => {
      // This test would require bypassing the constructor validation
      // We'll test the error handling within the switch statement
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Manually set an invalid target to test the default case
      (processor as any).toolTarget = "unsupported";

      const mockRulesyncSubagent = createMockRulesyncSubagent({
        testDir,
        fileName: "test.md",
        content: "# Test",
        frontmatter: { name: "test", description: "Test subagent" },
      });

      await expect(
        processor.convertRulesyncFilesToToolFiles([mockRulesyncSubagent]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load subagent files from .rulesync/subagents directory", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const subagentsDir = join(testDir, ".rulesync", "subagents");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["subagent1.md", "subagent2.md"]);
      vi.mocked(fileUtils.readFileContent).mockImplementation(async (path: string) => {
        if (path.includes("subagent1.md")) {
          return `---
name: subagent1
description: First subagent
---
# Subagent 1
Content`;
        }
        if (path.includes("subagent2.md")) {
          return `---
name: subagent2
description: Second subagent
---
# Subagent 2
Content`;
        }
        return "";
      });

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(2);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(subagentsDir);
    });

    it("should return empty array when subagents directory doesn't exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });

    it("should handle empty subagents directory", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue([]);

      const result = await processor.loadRulesyncFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    it("should load claudecode subagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudeAgentsDir = join(testDir, ".claude", "agents");
      vi.mocked(fileUtils.directoryExists).mockResolvedValue(true);
      vi.mocked(fileUtils.listDirectoryFiles).mockResolvedValue(["test-agent.md"]);
      vi.mocked(fileUtils.readFileContent).mockResolvedValue(
        "# Test Agent\n\nThis is a test agent.",
      );

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(1);
      expect(fileUtils.directoryExists).toHaveBeenCalledWith(claudeAgentsDir);
    });

    it("should return empty array when agents directory doesn't exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      vi.mocked(fileUtils.directoryExists).mockResolvedValue(false);

      const result = await processor.loadToolFiles();

      expect(result).toHaveLength(0);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert claudecode subagents back to rulesync format", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = [
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".claude", "agents", "test-agent.md"),
          content: `---
name: test-agent
description: Test agent
---
# Test Agent

This is a test agent.`,
        }),
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFilePath()).toContain(".rulesync/subagents/test-agent.md");
    });

    it("should handle multiple tool files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = [
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".claude", "agents", "agent1.md"),
          content: "# Agent 1",
        }),
        createMockToolFile({
          testDir,
          filePath: join(testDir, ".claude", "agents", "agent2.md"),
          content: "# Agent 2",
        }),
      ];

      const result = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(result).toHaveLength(2);
      expect(result[0]?.getFilePath()).toContain("agent1.md");
      expect(result[1]?.getFilePath()).toContain("agent2.md");
    });
  });

  describe("edge cases", () => {
    it("should handle subagents with complex frontmatter", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const mockRulesyncSubagent = createMockRulesyncSubagent({
        testDir,
        fileName: "complex-subagent.md",
        content: "# Complex Subagent\n\nThis subagent has complex frontmatter.",
        frontmatter: {
          name: "complex-subagent",
          description: "Complex subagent with multiple properties",
          version: "1.0",
          author: "Test Author",
          tags: ["ai", "assistant", "test"],
        },
      });

      const result = await processor.convertRulesyncFilesToToolFiles([mockRulesyncSubagent]);

      expect(result).toHaveLength(1);
      expect(result[0]?.getFileContent()).toContain("Complex subagent with multiple properties");
    });
  });
});
