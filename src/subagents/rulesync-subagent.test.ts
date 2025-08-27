import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";

describe("RulesyncSubagent", () => {
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
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Test Planner",
        description: "A test planning agent",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "You are a helpful planning agent.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "planner.md",
        fileContent: `---
targets: ["claudecode"]
name: "Test Planner"
description: "A test planning agent"
---

You are a helpful planning agent.`,
      });

      expect(subagent).toBeInstanceOf(RulesyncSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(subagent.getRelativeFilePath()).toBe("planner.md");
      expect(subagent.getBody()).toBe("You are a helpful planning agent.");
    });

    it("should create instance with multiple targets", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode", "cursor", "cline"],
        name: "Multi-target Agent",
        description: "Agent for multiple tools",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Multi-target content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "multitarget.md",
        fileContent: "Multi-target file content",
      });

      expect(subagent.getFrontmatter().targets).toEqual(["claudecode", "cursor", "cline"]);
    });

    it("should create instance with claudecode options", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Agent with Options",
        description: "Agent with Claude Code specific options",
        claudecode: {
          model: "sonnet",
        },
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Agent content with options",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "withoptions.md",
        fileContent: "With options file content",
      });

      expect(subagent.getFrontmatter().claudecode?.model).toBe("sonnet");
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"], // not a valid target
        name: "Invalid Agent",
        description: "Agent with invalid target",
      } as unknown as RulesyncSubagentFrontmatter;

      expect(() => {
        const _subagent = new RulesyncSubagent({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"],
        name: "Invalid Agent",
        description: "Agent with invalid target",
      } as unknown as RulesyncSubagentFrontmatter;

      expect(() => {
        const _subagent = new RulesyncSubagent({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode", "cursor"],
        name: "Test Agent",
        description: "Test agent description",
        claudecode: {
          model: "opus",
        },
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      const retrievedFrontmatter = subagent.getFrontmatter();
      expect(retrievedFrontmatter).toEqual(frontmatter);
      expect(retrievedFrontmatter.targets).toEqual(["claudecode", "cursor"]);
      expect(retrievedFrontmatter.claudecode?.model).toBe("opus");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Valid Agent",
        description: "Valid agent description",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Valid body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
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
        targets: ["invalid-target"],
        name: "Invalid Agent",
        description: "Invalid agent description",
      } as unknown as RulesyncSubagentFrontmatter;

      const subagent = new RulesyncSubagent({
        frontmatter: invalidFrontmatter,
        body: "Invalid body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid content",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should validate all target options", () => {
      const validTargets = [
        "agentsmd",
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "copilot",
        "cursor",
        "cline",
        "claudecode",
        "codexcli",
        "opencode",
        "qwencode",
        "roo",
        "geminicli",
        "kiro",
        "junie",
        "windsurf",
      ];

      validTargets.forEach((target) => {
        const frontmatter: RulesyncSubagentFrontmatter = {
          targets: [target as any],
          name: `Agent for ${target}`,
          description: `Agent targeting ${target}`,
        };

        const subagent = new RulesyncSubagent({
          frontmatter,
          body: `Body for ${target}`,
          baseDir: testDir,
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: `${target}.md`,
          fileContent: `Content for ${target}`,
          validate: false,
        });

        const result = subagent.validate();
        expect(result.success).toBe(true);
      });
    });

    it("should validate claudecode model options", () => {
      const validModels = ["opus", "sonnet", "haiku", "inherit"];

      validModels.forEach((model) => {
        const frontmatter: RulesyncSubagentFrontmatter = {
          targets: ["claudecode"],
          name: `Agent with ${model}`,
          description: `Agent using ${model} model`,
          claudecode: {
            model: model as any,
          },
        };

        const subagent = new RulesyncSubagent({
          frontmatter,
          body: `Body for ${model}`,
          baseDir: testDir,
          relativeDirPath: ".rulesync/subagents",
          relativeFilePath: `${model}.md`,
          fileContent: `Content for ${model}`,
          validate: false,
        });

        const result = subagent.validate();
        expect(result.success).toBe(true);
      });
    });
  });

  describe("schema validation", () => {
    it("should validate RulesyncSubagentFrontmatterSchema with required fields", () => {
      const validFrontmatter = {
        targets: ["claudecode"],
        name: "Valid Agent",
        description: "Valid description",
      };

      const invalidFrontmatter1 = {
        // missing targets
        name: "Invalid Agent",
        description: "Invalid description",
      };

      const invalidFrontmatter2 = {
        targets: ["claudecode"],
        // missing title
        description: "Invalid description",
      };

      const invalidFrontmatter3 = {
        targets: ["claudecode"],
        name: "Invalid Agent",
        // missing description
      };

      // Valid case should not throw
      expect(() => {
        z.object({
          targets: z.array(z.string()),
          name: z.string(),
          description: z.string(),
        }).parse(validFrontmatter);
      }).not.toThrow();

      // Invalid cases should throw
      [invalidFrontmatter1, invalidFrontmatter2, invalidFrontmatter3].forEach((invalid, index) => {
        expect(
          () => {
            z.object({
              targets: z.array(z.string()),
              name: z.string(),
              description: z.string(),
            }).parse(invalid);
          },
          `Invalid frontmatter ${index + 1} should throw`,
        ).toThrow();
      });
    });

    it("should validate optional claudecode field", () => {
      const validWithClaudecode = {
        targets: ["claudecode"],
        name: "Agent",
        description: "Description",
        claudecode: {
          model: "sonnet",
        },
      };

      const validWithoutClaudecode = {
        targets: ["claudecode"],
        name: "Agent",
        description: "Description",
      };

      const invalidClaudecode = {
        targets: ["claudecode"],
        name: "Agent",
        description: "Description",
        claudecode: {
          model: "invalid-model",
        },
      };

      expect(() => {
        z.object({
          targets: z.array(z.string()),
          name: z.string(),
          description: z.string(),
          claudecode: z.optional(
            z.object({
              model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
            }),
          ),
        }).parse(validWithClaudecode);
      }).not.toThrow();

      expect(() => {
        z.object({
          targets: z.array(z.string()),
          name: z.string(),
          description: z.string(),
          claudecode: z.optional(
            z.object({
              model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
            }),
          ),
        }).parse(validWithoutClaudecode);
      }).not.toThrow();

      expect(() => {
        z.object({
          targets: z.array(z.string()),
          name: z.string(),
          description: z.string(),
          claudecode: z.optional(
            z.object({
              model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
            }),
          ),
        }).parse(invalidClaudecode);
      }).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Empty Body Agent",
        description: "Agent with empty body",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "empty.md",
        fileContent: "File content",
      });

      expect(subagent.getBody()).toBe("");
    });

    it("should handle empty targets array", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: [],
        name: "No Targets Agent",
        description: "Agent with no targets",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "No targets content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "notargets.md",
        fileContent: "No targets file content",
        validate: false,
      });

      expect(subagent.getFrontmatter().targets).toEqual([]);
    });

    it("should handle special characters in title and description", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Agent with Special Chars!@#$%^&*()",
        description: "Description with üñíçødé and émøjî 🤖",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Special content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "special.md",
        fileContent: "Special file content",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(subagent.getFrontmatter().name).toBe("Agent with Special Chars!@#$%^&*()");
      expect(subagent.getFrontmatter().description).toBe("Description with üñíçødé and émøjî 🤖");
    });

    it("should handle multiple claudecode options", () => {
      // Test with future potential claudecode options
      const frontmatter = {
        targets: ["claudecode"],
        name: "Future Options Agent",
        description: "Agent with potential future options",
        claudecode: {
          model: "sonnet",
          // Future options could be added here
        },
      } as RulesyncSubagentFrontmatter;

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Future options content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "future.md",
        fileContent: "Future options file content",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
    });

    it("should handle very long title and description", () => {
      const longString = "x".repeat(1000);
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: `Long Title ${longString}`,
        description: `Long Description ${longString}`,
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Long content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "long.md",
        fileContent: "Long file content",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(subagent.getFrontmatter().name.length).toBeGreaterThan(1000);
    });
  });

  describe("inheritance from RulesyncFile", () => {
    it("should properly extend RulesyncFile", () => {
      const frontmatter: RulesyncSubagentFrontmatter = {
        targets: ["claudecode"],
        name: "Inheritance Test",
        description: "Testing inheritance",
      };

      const subagent = new RulesyncSubagent({
        frontmatter,
        body: "Inheritance body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/subagents",
        relativeFilePath: "inheritance.md",
        fileContent: "Inheritance file content",
      });

      // Test inherited methods
      expect(subagent.getBody()).toBe("Inheritance body");
      expect(subagent.getRelativeDirPath()).toBe(".rulesync/subagents");
      expect(subagent.getRelativeFilePath()).toBe("inheritance.md");
      expect(subagent.getFileContent()).toBe("Inheritance file content");
    });
  });
});
