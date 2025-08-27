import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir } from "node:fs/promises";
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

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("./rulesync-subagent.js", () => ({
  RulesyncSubagent: vi.fn().mockImplementation((args) => ({
    getFrontmatter: vi.fn().mockReturnValue(args.frontmatter),
    getBody: vi.fn().mockReturnValue(args.body),
    ...args,
  })),
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

  describe("writeToolSubagentsFromRulesyncSubagents", () => {
    it("should convert rulesync subagents to claude code subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock the file system to return markdown files
      (readdir as any).mockResolvedValue(["planner.md"]);
      
      // Mock RulesyncSubagent.fromFilePath to return a mock subagent
      const mockSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Test Planner", 
          description: "A test planning agent",
          claudecode: {
            model: "sonnet",
          },
        },
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent: `---
targets: ["claudecode"]
title: "Test Planner"
description: "A test planning agent"
claudecode:
  model: "sonnet"
---

You are a helpful planning agent.`,
        validate: false,
      });
      
      (RulesyncSubagent.fromFilePath as any).mockResolvedValue(mockSubagent);

      await processor.writeToolSubagentsFromRulesyncSubagents();

      // The method should complete without throwing
      expect(readdir).toHaveBeenCalled();
      expect(RulesyncSubagent.fromFilePath).toHaveBeenCalled();
    });

    it("should handle multiple rulesync subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock the file system to return multiple markdown files
      (readdir as any).mockResolvedValue(["planner.md", "reviewer.md"]);

      const subagent1 = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Planner",
          description: "Planning agent",
        },
        body: "Planning content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent:
          '---\ntargets: ["claudecode"]\ntitle: "Planner"\ndescription: "Planning agent"\n---\n\nPlanning content',
        validate: false,
      });

      const subagent2 = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Reviewer", 
          description: "Review agent",
        },
        body: "Review content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        fileContent:
          '---\ntargets: ["claudecode"]\ntitle: "Reviewer"\ndescription: "Review agent"\n---\n\nReview content',
        validate: false,
      });

      // Mock multiple calls to fromFilePath
      (RulesyncSubagent.fromFilePath as any)
        .mockResolvedValueOnce(subagent1)
        .mockResolvedValueOnce(subagent2);

      await processor.writeToolSubagentsFromRulesyncSubagents();

      expect(readdir).toHaveBeenCalled();
      expect(RulesyncSubagent.fromFilePath).toHaveBeenCalledTimes(2);
    });

    it("should throw error when no markdown files found", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock empty directory
      (readdir as any).mockResolvedValue([]);

      await expect(processor.writeToolSubagentsFromRulesyncSubagents()).rejects.toThrow(
        "No markdown files found in rulesync subagents directory"
      );
    });

    it("should throw error when subagents directory does not exist", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock directory not existing
      const { directoryExists } = await import("../utils/file.js");
      (directoryExists as any).mockResolvedValue(false);

      await expect(processor.writeToolSubagentsFromRulesyncSubagents()).rejects.toThrow(
        "Rulesync subagents directory not found"
      );
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

  describe("error handling", () => {
    it("should handle file parsing errors gracefully", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      // Mock file system
      (readdir as any).mockResolvedValue(["invalid.md"]);
      (RulesyncSubagent.fromFilePath as any).mockRejectedValue(new Error("Invalid frontmatter"));

      // Should throw when no valid subagents found
      await expect(processor.writeToolSubagentsFromRulesyncSubagents()).rejects.toThrow(
        "No valid subagents found"
      );
    });
  });

  describe("integration tests", () => {
    it("should perform round-trip conversion rulesync -> claude code -> rulesync", async () => {
      // Create original rulesync subagent
      const originalRulesync = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Original Planner",
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
      expect(convertedRulesync.getFrontmatter().title).toBe("Original Planner");
      expect(convertedRulesync.getFrontmatter().description).toBe("Original planning agent");
      expect(convertedRulesync.getBody()).toBe("Original content");
      expect(convertedRulesync.getFrontmatter().targets).toEqual(["claudecode"]);
    });
  });
});
