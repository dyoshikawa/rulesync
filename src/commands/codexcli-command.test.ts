import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { CodexCliCommand } from "./codexcli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  SimulatedCommandFrontmatter,
  SimulatedCommandFrontmatterSchema,
} from "./simulated-command.js";

describe("CodexCliCommand", () => {
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
      const paths = CodexCliCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".codex/commands",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid markdown content", () => {
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test codexcli command description",
        },
        body: "This is the body of the codexcli command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexCliCommand);
      expect(command.getBody()).toBe(
        "This is the body of the codexcli command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test codexcli command description",
      });
    });

    it("should create instance with empty description", () => {
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "",
        },
        body: "This is a codexcli command without description.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is a codexcli command without description.");
      expect(command.getFrontmatter()).toEqual({
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CodexCliCommand);
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(
        () =>
          new CodexCliCommand({
            baseDir: testDir,
            relativeDirPath: ".codex/commands",
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
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          description: "Test codexcli command",
        },
        body: "Test body",
        validate: true,
      });

      const frontmatter = command.getFrontmatter();
      expect(frontmatter).toEqual({
        description: "Test codexcli command",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should throw error as it is a simulated file", () => {
      const command = new CodexCliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/commands",
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
    it("should create CodexCliCommand from RulesyncCommand", () => {
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

      const codexcliCommand = CodexCliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(codexcliCommand).toBeInstanceOf(CodexCliCommand);
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

      const codexcliCommand = CodexCliCommand.fromRulesyncCommand({
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

      const codexcliCommand = CodexCliCommand.fromRulesyncCommand({
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
    it("should load CodexCliCommand from file", async () => {
      const commandsDir = join(testDir, ".codex", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CodexCliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexCliCommand);
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

      const command = await CodexCliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CodexCliCommand.fromFile({
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
        CodexCliCommand.fromFile({
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
        CodexCliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "no-frontmatter.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new CodexCliCommand({
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
      const command = new CodexCliCommand({
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
      const command = new CodexCliCommand({
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

      const command = new CodexCliCommand({
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

      const command = new CodexCliCommand({
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
      const command = new CodexCliCommand({
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

      const command = new CodexCliCommand({
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
      const command = new CodexCliCommand({
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
      expect(command).toBeInstanceOf(CodexCliCommand);
      expect(command.getRelativeDirPath()).toBe(".codex/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const command = new CodexCliCommand({
        baseDir: customBaseDir,
        relativeDirPath: ".codex/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
        },
        body: "Body",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexCliCommand);
    });
  });
});
