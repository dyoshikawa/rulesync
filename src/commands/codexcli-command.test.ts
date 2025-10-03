import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  SimulatedCommandFrontmatter,
  SimulatedCommandFrontmatterSchema,
} from "./simulated-command.js";

describe("CodexcliCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
description: Test codexcli command description
---

This is the body of the codexcli command.
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
    it("should return correct paths for codexcli commands", () => {
      const paths = CodexcliCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".codex/prompts",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body of the codexcli command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
      expect(command.getBody()).toBe(
        "This is the body of the codexcli command.\nIt can be multiline.",
      );
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "Test body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test body");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create CodexcliCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["codexcli"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(codexcliCommand).toBeInstanceOf(CodexcliCommand);
      expect(codexcliCommand.getBody()).toBe("Test command content");
      expect(codexcliCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
      });
      expect(codexcliCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(codexcliCommand.getRelativeDirPath()).toBe(".codex/commands");
    });

    it("should handle RulesyncCommand with different file extensions", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "complex-command.txt",
        frontmatter: {
          targets: ["codexcli"],
          description: "Complex command",
        },
        body: "Complex content",
        fileContent: "",
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(codexcliCommand.getRelativeFilePath()).toBe("complex-command.txt");
    });

    it("should handle empty description", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["codexcli"],
          description: "",
        },
        body: "Test content",
        fileContent: "",
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(codexcliCommand.getFrontmatter()).toEqual({
        description: "",
      });
    });
  });

  describe("fromFile", () => {
    it("should load CodexcliCommand from file", async () => {
      const commandsDir = join(testDir, ".codex", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CodexcliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
      expect(command.getBody()).toBe(
        "This is the body of the codexcli command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test codexcli command description",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.md");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".codex", "commands", "subdir");
      const filePath = join(commandsDir, "nested-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CodexcliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CodexcliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".codex", "commands");
      const filePath = join(commandsDir, "invalid-command.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        CodexcliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file without frontmatter", async () => {
      const commandsDir = join(testDir, ".codex", "commands");
      const filePath = join(commandsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      await expect(
        CodexcliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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

  describe("SimulatedCommandFrontmatterSchema", () => {
    it("should validate valid frontmatter with description", () => {
      const validFrontmatter = {
        description: "Test description",
      };

      const result = SimulatedCommandFrontmatterSchema.parse(validFrontmatter);
      expect(result).toEqual(validFrontmatter);
    });

    it("should throw error for frontmatter without description", () => {
      const invalidFrontmatter = {};

      expect(() => SimulatedCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
      };

      expect(() => SimulatedCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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

      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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

      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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

      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(command).toBeInstanceOf(CodexcliCommand);
      expect(command.getRelativeDirPath()).toBe(".codex/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const command = new CodexcliCommand({
        baseDir: customBaseDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with codexcli target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["codexcli"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with codexcli and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "codexcli", "claudecode"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
