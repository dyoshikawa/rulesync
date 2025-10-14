import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  CopilotCommand,
  CopilotCommandFrontmatter,
  CopilotCommandFrontmatterSchema,
} from "./copilot-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("CopilotCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
mode: agent
description: Test copilot command description
---

This is the body of the copilot command.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required mode field
description: Test
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
    it("should return correct paths for copilot commands", () => {
      const paths = CopilotCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".github", "prompts"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test copilot command description",
        },
        body: "This is the body of the copilot command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CopilotCommand);
      expect(command.getBody()).toBe(
        "This is the body of the copilot command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        mode: "agent",
        description: "Test copilot command description",
      });
    });

    it("should create instance with empty description", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "",
        },
        body: "This is a copilot command without description.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is a copilot command without description.");
      expect(command.getFrontmatter()).toEqual({
        mode: "agent",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CopilotCommand);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new CopilotCommand({
            baseDir: testDir,
            relativeDirPath: join(".github", "prompts"),
            relativeFilePath: "invalid-command.prompt.md",
            frontmatter: {
              // Missing required mode and description field
            } as CopilotCommandFrontmatter,
            body: "Body content",
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test description",
        },
        body: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with mode and description", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test copilot command",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = command.getFrontmatter();
      expect(frontmatter).toEqual({
        mode: "agent",
        description: "Test copilot command",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert CopilotCommand to RulesyncCommand", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test-command.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test body");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test description",
      });
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.prompt.md");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create CopilotCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["copilot"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const copilotCommand = CopilotCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(copilotCommand).toBeInstanceOf(CopilotCommand);
      expect(copilotCommand.getBody()).toBe("Test command content");
      expect(copilotCommand.getFrontmatter()).toEqual({
        mode: "agent",
        description: "Test description from rulesync",
      });
      expect(copilotCommand.getRelativeFilePath()).toBe("test-command.prompt.md");
      expect(copilotCommand.getRelativeDirPath()).toBe(join(".github", "prompts"));
    });

    it("should convert .md extension to .prompt.md", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "complex-command.md",
        frontmatter: {
          targets: ["copilot"],
          description: "Complex command",
        },
        body: "Complex content",
        fileContent: "",
        validate: true,
      });

      const copilotCommand = CopilotCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(copilotCommand.getRelativeFilePath()).toBe("complex-command.prompt.md");
    });

    it("should handle empty description", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["copilot"],
          description: "",
        },
        body: "Test content",
        fileContent: "",
        validate: true,
      });

      const copilotCommand = CopilotCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(copilotCommand.getFrontmatter()).toEqual({
        mode: "agent",
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load CopilotCommand from file", async () => {
      const commandsDir = join(testDir, ".github", "prompts");
      const filePath = join(commandsDir, "test-file-command.prompt.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CopilotCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.prompt.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(CopilotCommand);
      expect(command.getBody()).toBe(
        "This is the body of the copilot command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        mode: "agent",
        description: "Test copilot command description",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.prompt.md");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".github", "prompts", "subdir");
      const filePath = join(commandsDir, "nested-command.prompt.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CopilotCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.prompt.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.prompt.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CopilotCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.prompt.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".github", "prompts");
      const filePath = join(commandsDir, "invalid-command.prompt.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        CopilotCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-command.prompt.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const commandsDir = join(testDir, ".github", "prompts");
      const filePath = join(commandsDir, "no-frontmatter.prompt.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        CopilotCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.prompt.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "valid-command.prompt.md",
        frontmatter: {
          mode: "agent",
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
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "command-with-extras.prompt.md",
        frontmatter: {
          mode: "agent",
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

  describe("CopilotCommandFrontmatterSchema", () => {
    it("should validate valid frontmatter with mode and description", () => {
      const validFrontmatter = {
        mode: "agent" as const,
        description: "Test description",
      };

      const result = CopilotCommandFrontmatterSchema.parse(validFrontmatter);
      expect(result).toEqual(validFrontmatter);
    });

    it("should throw error for frontmatter without mode", () => {
      const invalidFrontmatter = {
        description: "Test",
      };

      expect(() => CopilotCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter without description", () => {
      const invalidFrontmatter = {
        mode: "agent",
      };

      expect(() => CopilotCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid mode", () => {
      const invalidFrontmatter = {
        mode: "invalid", // Should be 'agent'
        description: "Test",
      };

      expect(() => CopilotCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        mode: "agent",
        description: 123, // Should be string
      };

      expect(() => CopilotCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "empty-body.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Command with empty body",
        },
        body: "",
        validate: true,
      });

      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({
        mode: "agent",
        description: "Command with empty body",
      });
    });

    it("should handle special characters in content", () => {
      const specialContent =
        "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";

      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "special-char.prompt.md",
        frontmatter: {
          mode: "agent",
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

      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "long-content.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Long content test",
        },
        body: longContent,
        validate: true,
      });

      expect(command.getBody()).toBe(longContent);
      expect(command.getBody().length).toBe(10000);
    });

    it("should handle multi-line description", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "multiline-desc.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "This is a multi-line\ndescription with\nmultiple lines",
        },
        body: "Test body",
        validate: true,
      });

      expect(command.getFrontmatter()).toEqual({
        mode: "agent",
        description: "This is a multi-line\ndescription with\nmultiple lines",
      });
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "windows-lines.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Windows line endings test",
        },
        body: windowsContent,
        validate: true,
      });

      expect(command.getBody()).toBe(windowsContent);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from ToolCommand", () => {
      const command = new CopilotCommand({
        baseDir: testDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(command).toBeInstanceOf(CopilotCommand);
      expect(command.getRelativeDirPath()).toBe(join(".github", "prompts"));
      expect(command.getRelativeFilePath()).toBe("test.prompt.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const command = new CopilotCommand({
        baseDir: customBaseDir,
        relativeDirPath: join(".github", "prompts"),
        relativeFilePath: "test.prompt.md",
        frontmatter: {
          mode: "agent",
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(command).toBeInstanceOf(CopilotCommand);
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

      const result = CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with copilot target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["copilot"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with copilot and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "copilot", "cline"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
