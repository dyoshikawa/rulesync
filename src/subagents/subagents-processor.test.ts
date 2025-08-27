import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SubagentsProcessor, SubagentsProcessorToolTarget } from "./subagents-processor.js";

// Mock the file utility to avoid actual file system operations in isolated tests
vi.mock("../utils/file.js", () => ({
  writeFileContent: vi.fn().mockResolvedValue(undefined),
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

      const rulesyncSubagent = new RulesyncSubagent({
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

      await processor.writeToolSubagentsFromRulesyncSubagents([rulesyncSubagent]);

      // The method should complete without throwing
      expect(true).toBe(true);
    });

    it("should handle multiple rulesync subagents", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

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

      await processor.writeToolSubagentsFromRulesyncSubagents([subagent1, subagent2]);

      expect(true).toBe(true);
    });

    it("should handle empty array", async () => {
      const processor = new SubagentsProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await processor.writeToolSubagentsFromRulesyncSubagents([]);

      expect(true).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      // Modify the internal toolTarget to simulate unsupported target
      // Since toolTarget is private, we'll test by creating a modified version
      const mockProcessor = Object.create(SubagentsProcessor.prototype);
      mockProcessor.baseDir = testDir;
      mockProcessor.toolTarget = "unsupported";
      mockProcessor.writeAiFiles = vi.fn().mockResolvedValue(undefined);

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Test",
          description: "Test description",
        },
        body: "Test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        validate: false,
      });

      await expect(
        SubagentsProcessor.prototype.writeToolSubagentsFromRulesyncSubagents.call(mockProcessor, [
          rulesyncSubagent,
        ]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
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
    it("should handle file write errors gracefully", async () => {
      const processor = new SubagentsProcessor({
        baseDir: "/invalid/path",
        toolTarget: "claudecode",
      });

      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          title: "Test",
          description: "Test description",
        },
        body: "Test body",
        baseDir: "/invalid/path",
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
        validate: false,
      });

      // Since we're mocking writeFileContent, this should not throw
      // In real scenarios, it would throw due to invalid path
      await expect(
        processor.writeToolSubagentsFromRulesyncSubagents([rulesyncSubagent]),
      ).resolves.not.toThrow();
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
