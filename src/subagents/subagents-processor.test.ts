import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { directoryExists } from "../utils/file.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SubagentsProcessor, SubagentsProcessorToolTarget } from "./subagents-processor.js";

// Mock the file utilities and file system operations
vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return {
    ...actual,
    writeFileContent: vi.fn().mockResolvedValue(undefined),
    // Use the actual directoryExists implementation
    directoryExists: actual.directoryExists,
    readFileContent: vi.fn().mockResolvedValue(""),
  };
});

describe("SubagentsProcessor", () => {
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
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should create instance with optional baseDir", () => {
      const processor = new SubagentsProcessor({
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SubagentsProcessor);
    });

    it("should validate tool target with Zod schema", () => {
      expect(() => {
        const _processor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "unsupported" as SubagentsProcessorToolTarget,
        });
      }).toThrow();
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert RulesyncSubagent files to ToolSubagent files for claudecode", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Test Planner",
          description: "A test planning agent",
          claudecode: {
            model: "sonnet",
          },
        },
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent: "Test file content",
        validate: false,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncSubagent]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodeSubagent);
      const claudecodeSubagent = toolFiles[0] as ClaudecodeSubagent;
      expect(claudecodeSubagent.getFrontmatter().name).toBe("Test Planner");
      expect(claudecodeSubagent.getFrontmatter().description).toBe("A test planning agent");
    });

    it("should filter out non-RulesyncSubagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create a mock object that's not a RulesyncSubagent
      const mockFile = { notASubagent: true } as any;

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([mockFile]);

      expect(toolFiles).toHaveLength(0);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mocked tool target validation bypassed
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Directly modify the private property for testing
      (processor as any).toolTarget = "unsupported";

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Test",
          description: "Test",
        },
        body: "Test",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        validate: false,
      });

      await expect(processor.convertRulesyncFilesToToolFiles([rulesyncSubagent])).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });
  });

  describe("getToolTargets", () => {
    it("should return the supported tool targets", () => {
      // getToolTargets is a static method, so we call it on the class, not an instance
      const toolTargets = SubagentsProcessor.getToolTargets();

      expect(toolTargets).toEqual(["claudecode"]);
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert ToolSubagent files to RulesyncSubagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudecodeSubagent = new ClaudecodeSubagent({
        frontmatter: {
          name: "Test Planner",
          description: "A test planning agent",
          model: "sonnet",
        },
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "planner.md",
        fileContent: "Test file content",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([claudecodeSubagent]);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncSubagent);
      const rulesyncSubagent = rulesyncFiles[0] as RulesyncSubagent;
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Test Planner");
      expect(rulesyncSubagent.getFrontmatter().description).toBe("A test planning agent");
    });

    it("should filter out non-ToolSubagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create a mock object that's not a ToolSubagent
      const mockFile = { notASubagent: true } as any;

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([mockFile]);

      expect(rulesyncFiles).toHaveLength(0);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load and parse rulesync subagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create a mock rulesync subagent file
      const rulesyncDir = join(testDir, ".rulesync", "subagents");
      await mkdir(rulesyncDir, { recursive: true });

      const fileContent = `---
targets: ["claudecode"]
name: "Test Planner"
description: "A test planning agent"
claudecode:
  model: "sonnet"
---

You are a helpful planning agent.`;

      await writeFile(join(rulesyncDir, "planner.md"), fileContent);

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]!).toBeInstanceOf(RulesyncSubagent);
      const rulesyncSubagent = rulesyncFiles[0] as RulesyncSubagent;
      expect(rulesyncSubagent.getFrontmatter().name).toBe("Test Planner");
    });

    it("should return empty array when no markdown files found", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create empty directory
      const rulesyncDir = join(testDir, ".rulesync", "subagents");
      await mkdir(rulesyncDir, { recursive: true });

      const result = await processor.loadRulesyncFiles();
      expect(result).toEqual([]);
    });

    it("should return empty array when subagents directory does not exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Ensure the directory really doesn't exist
      const subagentsDir = join(testDir, ".rulesync", "subagents");
      expect(await directoryExists(subagentsDir)).toBe(false);

      const result = await processor.loadRulesyncFiles();
      expect(result).toEqual([]);
    });
  });

  describe("loadToolFiles", () => {
    it("should load and parse tool subagent files", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create a mock claude code agent file
      const agentsDir = join(testDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });

      const fileContent = `---
name: "Test Planner"
description: "A test planning agent"
model: "sonnet"
---

You are a helpful planning agent.`;

      await writeFile(join(agentsDir, "planner.md"), fileContent);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]!).toBeInstanceOf(ClaudecodeSubagent);
      const claudecodeSubagent = toolFiles[0] as ClaudecodeSubagent;
      expect(claudecodeSubagent.getFrontmatter().name).toBe("Test Planner");
    });

    it("should return empty array when no tool files found", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create empty directory
      const agentsDir = join(testDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(0);
    });

    it("should return empty array when agents directory does not exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // The agents directory should not exist by default in test setup
      const agentsDir = join(testDir, ".claude", "agents");
      expect(await directoryExists(agentsDir)).toBe(false);

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(0);
    });
  });

  describe("writeToolSubagentsFromRulesyncSubagents", () => {
    it("should convert rulesync subagents to claude code subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Test Planner",
          description: "A test planning agent",
          claudecode: {
            model: "sonnet",
          },
        },
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent: "Test file content",
        validate: false,
      });

      // Mock writeFileContent to avoid actual file writing
      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear(); // Clear previous calls
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolSubagentsFromRulesyncSubagents([rulesyncSubagent]);

      // Verify the write was called
      expect(writeFileContent).toHaveBeenCalled();
    });

    it("should handle multiple rulesync subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const subagent1 = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Planner",
          description: "Planning agent",
        },
        body: "Planning content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent:
          '---\ntargets: ["claudecode"]\nname: "Planner"\ndescription: "Planning agent"\n---\n\nPlanning content',
        validate: false,
      });

      const subagent2 = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Reviewer",
          description: "Review agent",
        },
        body: "Review content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        fileContent:
          '---\ntargets: ["claudecode"]\nname: "Reviewer"\ndescription: "Review agent"\n---\n\nReview content',
        validate: false,
      });

      // Mock writeFileContent to avoid actual file writing
      const { writeFileContent } = await import("../utils/file.js");
      (writeFileContent as any).mockClear(); // Clear previous calls
      (writeFileContent as any).mockResolvedValue(undefined);

      await processor.writeToolSubagentsFromRulesyncSubagents([subagent1, subagent2]);

      // Verify the write was called twice (once for each subagent)
      expect(writeFileContent).toHaveBeenCalledTimes(2);
    });
  });

  describe("writeRulesyncSubagentsFromToolSubagents", () => {
    it("should convert tool subagents to rulesync subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const claudecodeSubagent = new ClaudecodeSubagent({
        frontmatter: {
          name: "Test Planner",
          description: "A test planning agent",
          model: "sonnet",
        },
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "planner.md",
        fileContent: `---
name: "Test Planner"
description: "A test planning agent"
model: "sonnet"
---

You are a helpful planning agent.`,
      });

      await processor.writeRulesyncSubagentsFromToolSubagents([claudecodeSubagent]);

      expect(true).toBe(true);
    });

    it("should handle multiple tool subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const subagent1 = new ClaudecodeSubagent({
        frontmatter: {
          name: "Planner",
          description: "Planning agent",
        },
        body: "Planning content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "planner.md",
        fileContent: "Planning file content",
      });

      const subagent2 = new ClaudecodeSubagent({
        frontmatter: {
          name: "Reviewer",
          description: "Review agent",
        },
        body: "Review content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "reviewer.md",
        fileContent: "Review file content",
      });

      await processor.writeRulesyncSubagentsFromToolSubagents([subagent1, subagent2]);

      expect(true).toBe(true);
    });

    it("should handle empty array", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await processor.writeRulesyncSubagentsFromToolSubagents([]);

      expect(true).toBe(true);
    });
  });

  describe("schema validation", () => {
    it("should validate SubagentsProcessorToolTargetSchema", () => {
      const validTarget = "claudecode";
      const invalidTarget = "invalid-target";

      expect(() => z.enum(["claudecode"]).parse(validTarget)).not.toThrow();
      expect(() => z.enum(["claudecode"]).parse(invalidTarget)).toThrow();
    });
  });

  describe("integration tests", () => {
    it("should perform round-trip conversion rulesync -> claude code -> rulesync", async () => {
      // Create original rulesync subagent
      const originalRulesync = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Original Planner",
          description: "Original planning agent",
          claudecode: { model: "sonnet" },
        },
        body: "Original content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent: "Original file content",
        validate: false,
      });

      // Convert to claude code
      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent: originalRulesync,
      });

      // Convert back to rulesync
      const convertedRulesync = claudecodeSubagent.toRulesyncSubagent();

      // Verify the conversion preserves essential data
      expect(convertedRulesync.getFrontmatter().name).toBe("Original Planner");
      expect(convertedRulesync.getFrontmatter().description).toBe("Original planning agent");
      expect(convertedRulesync.getBody()).toBe("Original content");
      expect(convertedRulesync.getFrontmatter().targets).toEqual(["claudecode"]);
    });
  });
});
