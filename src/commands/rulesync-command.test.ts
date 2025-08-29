import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { setupTestDirectory } from "../test-utils/index.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";

describe("RulesyncCommand", () => {
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
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "A test command",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Please analyze the following code and provide suggestions.",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: `---
targets: ["claudecode"]
name: "test-command"
description: "A test command"
---

Please analyze the following code and provide suggestions.`,
      });

      expect(command).toBeInstanceOf(RulesyncCommand);
      expect(command.getRelativeDirPath()).toBe(".rulesync/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBody()).toBe("Please analyze the following code and provide suggestions.");
    });

    it("should create instance with multiple targets", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode", "cursor", "cline"],
        description: "Command for multiple tools",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Multi-target command content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "multitarget.md",
        fileContent: "Multi-target file content",
      });

      expect(command.getFrontmatter().targets).toEqual(["claudecode", "cursor", "cline"]);
    });

    it("should create instance with argument-hint", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Command with argument hint",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Command content with hint",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "with-hint.md",
        fileContent: "With hint file content",
      });

      expect(command.getFrontmatter().description).toBe("Command with argument hint");
    });

    it("should create instance with claudecode options", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Command with Claude Code specific options",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Command content with options",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "withoptions.md",
        fileContent: "With options file content",
      });

      expect(command.getFrontmatter().description).toBe(
        "Command with Claude Code specific options",
      );
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"], // not a valid target
        description: "Command with invalid target",
      } as unknown as RulesyncCommandFrontmatter;

      expect(() => {
        const _command = new RulesyncCommand({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/commands",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
        });
      }).toThrow();
    });

    it("should skip validation when validate=false", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"],
        description: "Command with invalid target",
      } as unknown as RulesyncCommandFrontmatter;

      expect(() => {
        const _command = new RulesyncCommand({
          frontmatter: invalidFrontmatter,
          body: "Test body",
          baseDir: testDir,
          relativeDirPath: ".rulesync/commands",
          relativeFilePath: "invalid.md",
          fileContent: "Invalid content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode", "cursor"],
        description: "Test command description",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Test body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "Test content",
      });

      const retrievedFrontmatter = command.getFrontmatter();
      expect(retrievedFrontmatter).toEqual(frontmatter);
      expect(retrievedFrontmatter.targets).toEqual(["claudecode", "cursor"]);
      expect(retrievedFrontmatter.description).toBe("Test command description");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Valid command description",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Valid body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "valid.md",
        fileContent: "Valid content",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        targets: ["invalid-target"],
        description: "Invalid command description",
      } as unknown as RulesyncCommandFrontmatter;

      const command = new RulesyncCommand({
        frontmatter: invalidFrontmatter,
        body: "Invalid body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "invalid.md",
        fileContent: "Invalid content",
        validate: false,
      });

      const result = command.validate();
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
        const frontmatter: RulesyncCommandFrontmatter = {
          targets: [target as any],
          description: `Command targeting ${target}`,
        };

        const command = new RulesyncCommand({
          frontmatter,
          body: `Body for ${target}`,
          baseDir: testDir,
          relativeDirPath: ".rulesync/commands",
          relativeFilePath: `${target}.md`,
          fileContent: `Content for ${target}`,
          validate: false,
        });

        const result = command.validate();
        expect(result.success).toBe(true);
      });
    });
  });

  describe("schema validation", () => {
    it("should validate RulesyncCommandFrontmatterSchema with required fields", () => {
      const validFrontmatter = {
        targets: ["claudecode"],
        description: "Valid description",
      };

      const invalidFrontmatter1 = {
        // missing targets
        description: "Invalid description",
      };

      const invalidFrontmatter2 = {
        targets: ["claudecode"],
        // missing description
      };

      const invalidFrontmatter3 = {
        targets: ["claudecode"],
        name: "invalid-command",
        // missing description
      };

      // Valid case should not throw
      expect(() => {
        z.object({
          targets: z.array(z.string()),
          description: z.string(),
        }).parse(validFrontmatter);
      }).not.toThrow();

      // Invalid cases should throw
      [invalidFrontmatter1, invalidFrontmatter2, invalidFrontmatter3].forEach((invalid, index) => {
        expect(
          () => {
            z.object({
              targets: z.array(z.string()),
              description: z.string(),
            }).parse(invalid);
          },
          `Invalid frontmatter ${index + 1} should throw`,
        ).toThrow();
      });
    });

    it("should validate basic schema", () => {
      const validCommand = {
        targets: ["claudecode"],
        description: "Valid description",
      };

      expect(() => {
        z.object({
          targets: z.array(z.string()),
          description: z.string(),
        }).parse(validCommand);
      }).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Command with empty body",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "empty.md",
        fileContent: "File content",
      });

      expect(command.getBody()).toBe("");
    });

    it("should handle empty targets array", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: [],
        description: "Command with no targets",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "No targets content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "notargets.md",
        fileContent: "No targets file content",
        validate: false,
      });

      expect(command.getFrontmatter().targets).toEqual([]);
    });

    it("should handle special characters in description", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Description with üñíçødé and émøjî 🤖",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Special content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "special.md",
        fileContent: "Special file content",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(command.getFrontmatter().description).toBe("Description with üñíçødé and émøjî 🤖");
    });

    it("should handle long descriptions", () => {
      const longDescription =
        "This is a very long description that might include various formatting options like [--verbose] [--output-format json|yaml|xml] [--include-metadata] [--exclude pattern]";
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: longDescription,
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Long description content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "long-desc.md",
        fileContent: "Long description file content",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(command.getFrontmatter().description).toBe(longDescription);
    });

    it("should handle commands targeting multiple tools", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode", "cursor", "cline"],
        description: "Command that targets multiple tools",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Multi-target command content",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "multitarget.md",
        fileContent: "Multi-target file content",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(command.getFrontmatter().targets).toEqual(["claudecode", "cursor", "cline"]);
    });
  });

  describe("inheritance from RulesyncFile", () => {
    it("should properly extend RulesyncFile", () => {
      const frontmatter: RulesyncCommandFrontmatter = {
        targets: ["claudecode"],
        description: "Testing inheritance",
      };

      const command = new RulesyncCommand({
        frontmatter,
        body: "Inheritance body",
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "inheritance.md",
        fileContent: "Inheritance file content",
      });

      // Test inherited methods
      expect(command.getBody()).toBe("Inheritance body");
      expect(command.getRelativeDirPath()).toBe(".rulesync/commands");
      expect(command.getRelativeFilePath()).toBe("inheritance.md");
      expect(command.getFileContent()).toBe("Inheritance file content");
    });
  });
});
