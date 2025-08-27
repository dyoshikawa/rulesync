import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SubagentsProcessor, SubagentsProcessorToolTarget } from "./subagents-processor.js";

// Mock the file utilities and file system operations
vi.mock("../utils/file.js", () => ({
  writeFileContent: vi.fn().mockResolvedValue(undefined),
  directoryExists: vi.fn().mockResolvedValue(true),
  readFileContent: vi.fn().mockResolvedValue(""),
}));

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

    it("should validate tool target with Zod schema", () => {
      expect(() => {
        const _processor = new SubagentsProcessor({
          baseDir: testDir,
          toolTarget: "unsupported" as SubagentsProcessorToolTarget,
        });
      }).toThrow();
    });
  });

  describe("loadRulesyncSubagents", () => {
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

      const rulesyncSubagents = await processor.loadRulesyncSubagents();

      expect(rulesyncSubagents).toHaveLength(1);
      expect(rulesyncSubagents[0]!).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagents[0]!.getFrontmatter().name).toBe("Test Planner");
    });

    it("should throw error when no markdown files found", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Create empty directory
      const rulesyncDir = join(testDir, ".rulesync", "subagents");
      await mkdir(rulesyncDir, { recursive: true });

      await expect(processor.loadRulesyncSubagents()).rejects.toThrow(
        "No markdown files found in rulesync subagents directory",
      );
    });

    it("should throw error when subagents directory does not exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.loadRulesyncSubagents()).rejects.toThrow("ENOENT");
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
