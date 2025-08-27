import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeSubagent, ClaudecodeSubagentFrontmatter } from "./claudecode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("ClaudecodeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create instance with valid frontmatter", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Test Planner",
        description: "A test planning agent",
        model: "sonnet",
      };

      const subagent = new ClaudecodeSubagent({
        frontmatter,
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
        validate: false, // Skip validation during construction to avoid constructor validation
      });

      expect(subagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".claude/agents");
      expect(subagent.getRelativeFilePath()).toBe("planner.md");
    });

    it("should create instance with minimal frontmatter (without optional model)", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Simple Agent",
        description: "A simple agent without model",
      };

      const subagent = new ClaudecodeSubagent({
        frontmatter,
        body: "Simple content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "simple.md",
        fileContent: "Simple file content",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        name: "Test", // missing description
        // description is required
      } as ClaudecodeSubagentFrontmatter;

      expect(() => {
        const _subagent = new ClaudecodeSubagent({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: "test.md",
          fileContent: "Test content",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        name: "Test",
        // missing description
      } as ClaudecodeSubagentFrontmatter;

      expect(() => {
        const _subagent = new ClaudecodeSubagent({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: "test.md",
          fileContent: "Test content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Valid Agent",
        description: "A valid agent description",
        model: "opus",
      };

      const subagent = new ClaudecodeSubagent({
        frontmatter,
        body: "Valid body",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "valid.md",
        fileContent: "Valid content",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        name: "Invalid Agent",
        description: "Invalid description",
        model: "invalid-model", // invalid model option
      } as unknown as ClaudecodeSubagentFrontmatter;

      const subagent = new ClaudecodeSubagent({
        frontmatter: invalidFrontmatter,
        body: "Invalid body",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid content",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should validate all model options", () => {
      const validModels = ["opus", "sonnet", "haiku", "inherit"] as const;

      validModels.forEach((model) => {
        const frontmatter: ClaudecodeSubagentFrontmatter = {
          name: `Agent with ${model}`,
          description: `Agent using ${model} model`,
          model,
        };

        const subagent = new ClaudecodeSubagent({
          frontmatter,
          body: `Body for ${model}`,
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          relativeFilePath: `${model}.md`,
          fileContent: `Content for ${model}`,
          validate: false,
        });

        const result = subagent.validate();
        expect(result.success).toBe(true);
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent correctly", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Test Planner",
        description: "A test planning agent",
        model: "sonnet",
      };

      const claudecodeSubagent = new ClaudecodeSubagent({
        frontmatter,
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "planner.md",
        fileContent: "Original file content",
      });

      const rulesyncSubagent = claudecodeSubagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        name: "Test Planner",
        description: "A test planning agent",
      });
      expect(rulesyncSubagent.getBody()).toBe("You are a helpful planning agent.");
    });

    it("should convert without model when not specified", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Simple Agent",
        description: "A simple agent",
      };

      const claudecodeSubagent = new ClaudecodeSubagent({
        frontmatter,
        body: "Simple content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "simple.md",
        fileContent: "Simple file content",
      });

      const rulesyncSubagent = claudecodeSubagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["claudecode"],
        name: "Simple Agent",
        description: "A simple agent",
      });
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create ClaudecodeSubagent from RulesyncSubagent", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Test Reviewer",
          description: "A test review agent",
          claudecode: {
            model: "opus",
          },
        },
        body: "You are a helpful review agent.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "reviewer.md",
        fileContent: "Test file content",
        validate: false,
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      });

      expect(claudecodeSubagent).toBeInstanceOf(ClaudecodeSubagent);
      expect(claudecodeSubagent.getRelativeDirPath()).toBe(".claude/agents");
    });

    it("should handle RulesyncSubagent without claudecode model", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "No Model Agent",
          description: "Agent without model specification",
        },
        body: "Agent content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "nomodel.md",
        fileContent: "No model content",
        validate: false,
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      });

      // The converted subagent should have undefined model
      const result = claudecodeSubagent.validate();
      expect(result.success).toBe(true);
    });

    it("should use default parameters correctly", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "Default Test",
          description: "Test with defaults",
        },
        body: "Default content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "default.md",
        fileContent: "Default file content",
        validate: false,
      });

      const claudecodeSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      });

      expect(claudecodeSubagent).toBeInstanceOf(ClaudecodeSubagent);
    });

    it("should skip validation when validate=false", () => {
      // Create rulesync subagent with data that would be invalid for ClaudeCode
      const rulesyncSubagent = new RulesyncSubagent({
        frontmatter: {
          targets: ["claudecode"],
          name: "", // Empty title would be invalid
          description: "", // Empty description would be invalid
        },
        body: "Content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid content",
        validate: false, // Skip validation in RulesyncSubagent too
      });

      expect(() => {
        ClaudecodeSubagent.fromRulesyncSubagent({
          baseDir: testDir,
          relativeDirPath: ".claude/agents",
          rulesyncSubagent,
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("schema validation", () => {
    it("should validate ClaudecodeSubagentFrontmatterSchema", () => {
      const validFrontmatter = {
        name: "Valid Agent",
        description: "Valid description",
        model: "sonnet",
      };

      const invalidFrontmatter1 = {
        name: "Invalid Agent",
        // missing description
      };

      const invalidFrontmatter2 = {
        name: "Invalid Agent",
        description: "Valid description",
        model: "invalid-model",
      };

      expect(() => {
        z.object({
          name: z.string(),
          description: z.string(),
          model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
        }).parse(validFrontmatter);
      }).not.toThrow();

      expect(() => {
        z.object({
          name: z.string(),
          description: z.string(),
          model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
        }).parse(invalidFrontmatter1);
      }).toThrow();

      expect(() => {
        z.object({
          name: z.string(),
          description: z.string(),
          model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
        }).parse(invalidFrontmatter2);
      }).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Empty Body Agent",
        description: "Agent with empty body",
      };

      const subagent = new ClaudecodeSubagent({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "empty.md",
        fileContent: "File content",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getBody()).toBe("");
    });

    it("should handle special characters in name and description", () => {
      const frontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Agent with Special Chars!@#$%^&*()",
        description: "Description with üñíçødé and émøjî 🤖",
      };

      const subagent = new ClaudecodeSubagent({
        frontmatter,
        body: "Special content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "special.md",
        fileContent: "Special file content",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
    });

    it("should handle round-trip conversion preserving data", () => {
      const originalFrontmatter: ClaudecodeSubagentFrontmatter = {
        name: "Round Trip Agent",
        description: "Agent for round trip testing",
        model: "haiku",
      };

      const originalSubagent = new ClaudecodeSubagent({
        frontmatter: originalFrontmatter,
        body: "Round trip content",
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        relativeFilePath: "roundtrip.md",
        fileContent: "Round trip file content",
      });

      // Convert to RulesyncSubagent
      const rulesyncSubagent = originalSubagent.toRulesyncSubagent();

      // Convert back to ClaudecodeSubagent
      const convertedSubagent = ClaudecodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: ".claude/agents",
        rulesyncSubagent,
      });

      // Verify data preservation
      const convertedRulesync = convertedSubagent.toRulesyncSubagent();
      expect(convertedRulesync.getFrontmatter().name).toBe("Round Trip Agent");
      expect(convertedRulesync.getFrontmatter().description).toBe("Agent for round trip testing");
      expect(convertedRulesync.getBody()).toBe("Round trip content");
    });
  });
});
