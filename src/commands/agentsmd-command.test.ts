import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { AgentsmdCommand } from "./agentsmd-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { SimulatedCommandFrontmatter } from "./simulated-command.js";

describe("AgentsmdCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
description: Test agentsmd command description
---

This is the body of the agentsmd command.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required description field
invalid: true
---

Body content`;

  const markdownWithoutFrontmatter = `This is just plain content without frontmatter.`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for agentsmd commands", () => {
      const paths = AgentsmdCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".agents/commands",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test agentsmd command description",
        },
        body: "This is the body of the agentsmd command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(AgentsmdCommand);
      expect(command.getBody()).toBe(
        "This is the body of the agentsmd command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test agentsmd command description",
      });
    });

    it("should create instance with empty description", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "",
        },
        body: "This is an agentsmd command without description.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is an agentsmd command without description.");
      expect(command.getFrontmatter()).toEqual({
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(AgentsmdCommand);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new AgentsmdCommand({
            baseDir: testDir,
            relativeDirPath: ".agents/commands",
            relativeFilePath: "invalid-command.md",
            frontmatter: {
              // Missing required description field
            } as SimulatedCommandFrontmatter,
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test description",
        },
        body: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with description", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test agentsmd command",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = command.getFrontmatter();
      expect(frontmatter).toEqual({
        description: "Test agentsmd command",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should throw error as it is a simulated file", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      expect(() => command.toRulesyncCommand()).toThrow(
        "Not implemented because it is a SIMULATED file.",
      );
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create AgentsmdCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["agentsmd"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const agentsmdCommand = AgentsmdCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(agentsmdCommand).toBeInstanceOf(AgentsmdCommand);
      expect(agentsmdCommand.getBody()).toBe("Test command content");
      expect(agentsmdCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
      });
      expect(agentsmdCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(agentsmdCommand.getRelativeDirPath()).toBe(".agents/commands");
    });

    it("should handle RulesyncCommand with different file extensions", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "complex-command.txt",
        frontmatter: {
          targets: ["agentsmd"],
          description: "Complex command",
        },
        body: "Complex content",
        fileContent: "",
        validate: true,
      });

      const agentsmdCommand = AgentsmdCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(agentsmdCommand.getRelativeFilePath()).toBe("complex-command.txt");
    });

    it("should handle empty description", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["agentsmd"],
          description: "",
        },
        body: "Test content",
        fileContent: "",
        validate: true,
      });

      const agentsmdCommand = AgentsmdCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(agentsmdCommand.getFrontmatter()).toEqual({
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load AgentsmdCommand from file", async () => {
      const commandsDir = join(testDir, ".agents", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await AgentsmdCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(AgentsmdCommand);
      expect(command.getBody()).toBe(
        "This is the body of the agentsmd command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test agentsmd command description",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.md");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".agents", "commands", "subdir");
      const filePath = join(commandsDir, "nested-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await AgentsmdCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AgentsmdCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".agents", "commands");
      const filePath = join(commandsDir, "invalid-command.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        AgentsmdCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const commandsDir = join(testDir, ".agents", "commands");
      const filePath = join(commandsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        AgentsmdCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "valid-command.md",
        frontmatter: {
          description: "Valid description",
        },
        body: "Valid body",
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should handle frontmatter with additional properties", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "command-with-extras.md",
        frontmatter: {
          description: "Command with extra properties",
          // Additional properties should be allowed but not validated
          extra: "property",
        } as any,
        body: "Body content",
        validate: false,
      });

      const result = command.validate();
      // The validation should pass as long as required fields are present
      expect(result.success).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "empty-body.md",
        frontmatter: {
          description: "Command with empty body",
        },
        body: "",
        validate: true,
      });

      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({
        description: "Command with empty body",
      });
    });

    it("should handle special characters in content", () => {
      const specialContent =
        "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";

      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "special-char.md",
        frontmatter: {
          description: "Special characters test",
        },
        body: specialContent,
        validate: true,
      });

      expect(command.getBody()).toBe(specialContent);
      expect(command.getBody()).toContain("@#$%^&*()");
      expect(command.getBody()).toContain("你好世界 🌍");
      expect(command.getBody()).toContain("\"Hello 'World'\"");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);

      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "long-content.md",
        frontmatter: {
          description: "Long content test",
        },
        body: longContent,
        validate: true,
      });

      expect(command.getBody()).toBe(longContent);
      expect(command.getBody().length).toBe(10000);
    });

    it("should handle multi-line description", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "multiline-desc.md",
        frontmatter: {
          description: "This is a multi-line\ndescription with\nmultiple lines",
        },
        body: "Test body",
        validate: true,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "This is a multi-line\ndescription with\nmultiple lines",
      });
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "windows-lines.md",
        frontmatter: {
          description: "Windows line endings test",
        },
        body: windowsContent,
        validate: true,
      });

      expect(command.getBody()).toBe(windowsContent);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from SimulatedCommand", () => {
      const command = new AgentsmdCommand({
        baseDir: testDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(command).toBeInstanceOf(AgentsmdCommand);
      expect(command.getRelativeDirPath()).toBe(".agents/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const command = new AgentsmdCommand({
        baseDir: customBaseDir,
        relativeDirPath: ".agents/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(command).toBeInstanceOf(AgentsmdCommand);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for rulesync command with wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with agentsmd target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["agentsmd"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with agentsmd and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "agentsmd", "cline"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return false for rulesync command with different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(false);
    });

    it("should return true for rulesync command with no targets specified", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined, description: "Test" } as any,
        body: "Body",
        fileContent: "",
      });

      const result = AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
