import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import {
  GeminiCliCommand,
  GeminiCliCommandFrontmatter,
  GeminiCliCommandFrontmatterSchema,
} from "./geminicli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("GeminiCliCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validTomlContent = `description = "Test command description"
prompt = """
This is a test prompt for the command.
It can be multiline.
"""`;

  const validTomlWithoutDescription = `prompt = """
This is a test prompt without description.
"""`;

  const invalidTomlContent = `description = "Test description"
# Missing required prompt field`;

  const malformedTomlContent = `description = "Test description"
prompt = "Unclosed string`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid TOML content", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      expect(command).toBeInstanceOf(GeminiCliCommand);
      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
    });

    it("should create instance with TOML content without description", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      expect(command.getBody()).toBe("This is a test prompt without description.\n");
      expect(command.getFrontmatter()).toEqual({
        description: "",
        prompt: "This is a test prompt without description.\n",
      });
    });

    it("should create instance without validation when validate is false", () => {
      expect(
        () =>
          new GeminiCliCommand({
            baseDir: testDir,
            relativeDirPath: ".gemini/commands",
            relativeFilePath: "invalid-command.toml",
            fileContent: invalidTomlContent,
            validate: false,
          }),
      ).toThrow(); // Will still throw because parseTomlContent is called in constructor
    });

    it("should throw error for invalid TOML content when validation is enabled", () => {
      expect(
        () =>
          new GeminiCliCommand({
            baseDir: testDir,
            relativeDirPath: ".gemini/commands",
            relativeFilePath: "invalid-command.toml",
            fileContent: invalidTomlContent,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });

    it("should throw error for malformed TOML content", () => {
      expect(
        () =>
          new GeminiCliCommand({
            baseDir: testDir,
            relativeDirPath: ".gemini/commands",
            relativeFilePath: "malformed-command.toml",
            fileContent: malformedTomlContent,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });
  });

  describe("parseTomlContent", () => {
    it("should parse valid TOML with all fields", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const frontmatter = command.getFrontmatter() as GeminiCliCommandFrontmatter;
      expect(frontmatter.description).toBe("Test command description");
      expect(frontmatter.prompt).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
    });

    it("should parse TOML with optional description missing", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      const frontmatter = command.getFrontmatter() as GeminiCliCommandFrontmatter;
      expect(frontmatter.description).toBe("");
      expect(frontmatter.prompt).toBe("This is a test prompt without description.\n");
    });

    it("should throw error for TOML without required prompt field", () => {
      expect(
        () =>
          new GeminiCliCommand({
            baseDir: testDir,
            relativeDirPath: ".gemini/commands",
            relativeFilePath: "invalid-command.toml",
            fileContent: `description = "Test description"`,
            validate: true,
          }),
      ).toThrow("Failed to parse TOML command file");
    });
  });

  describe("getBody", () => {
    it("should return the prompt content as body", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
    });
  });

  describe("getFrontmatter", () => {
    it("should return frontmatter with description and prompt", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const frontmatter = command.getFrontmatter();
      expect(frontmatter).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with correct frontmatter", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlContent,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["geminicli"],
        description: "Test command description",
      });
      expect(rulesyncCommand.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(rulesyncCommand.getRelativeDirPath()).toBe(".rulesync/commands");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.toml");
    });

    it("should convert to RulesyncCommand with empty description", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "test-command.toml",
        fileContent: validTomlWithoutDescription,
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["geminicli"],
        description: "",
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create GeminiCliCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Test description from rulesync",
        },
        body: "Test prompt content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const geminiCommand = GeminiCliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(geminiCommand).toBeInstanceOf(GeminiCliCommand);
      expect(geminiCommand.getBody()).toBe("Test prompt content\n");
      expect(geminiCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
        prompt: "Test prompt content\n",
      });
      expect(geminiCommand.getRelativeFilePath()).toBe("test-command.toml");
      expect(geminiCommand.getRelativeDirPath()).toBe(".gemini/commands");
    });

    it("should handle RulesyncCommand with .md extension replacement", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "complex-command.md",
        frontmatter: {
          targets: ["geminicli"],
          description: "Complex command",
        },
        body: "Complex prompt",
        fileContent: "",
        validate: true,
      });

      const geminiCommand = GeminiCliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(geminiCommand.getRelativeFilePath()).toBe("complex-command.toml");
    });
  });

  describe("fromFile", () => {
    it("should load GeminiCliCommand from file", async () => {
      const commandsDir = join(testDir, ".gemini", "commands");
      const filePath = join(commandsDir, "test-file-command.toml");

      await writeFileContent(filePath, validTomlContent);

      const command = await GeminiCliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.toml",
        validate: true,
      });

      expect(command).toBeInstanceOf(GeminiCliCommand);
      expect(command.getBody()).toBe(
        "This is a test prompt for the command.\nIt can be multiline.\n",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test command description",
        prompt: "This is a test prompt for the command.\nIt can be multiline.\n",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.toml");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".gemini", "commands", "subdir");
      const filePath = join(commandsDir, "nested-command.toml");

      await writeFileContent(filePath, validTomlContent);

      const command = await GeminiCliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.toml",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.toml");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        GeminiCliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.toml",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid TOML", async () => {
      const commandsDir = join(testDir, ".gemini", "commands");
      const filePath = join(commandsDir, "invalid-command.toml");

      await writeFileContent(filePath, invalidTomlContent);

      await expect(
        GeminiCliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-command.toml",
          validate: true,
        }),
      ).rejects.toThrow("Failed to parse TOML command file");
    });
  });

  describe("validate", () => {
    it("should return success for valid TOML content", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "valid-command.toml",
        fileContent: validTomlContent,
        validate: false, // Skip validation in constructor to test validate method
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid TOML content", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "invalid-command.toml",
        fileContent: `prompt = """
Valid prompt content
"""`,
        validate: false,
      });

      // Manually set invalid content to test validation
      (command as any).fileContent = invalidTomlContent;

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain("Failed to parse TOML command file");
    });

    it("should return error for malformed TOML content", () => {
      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "malformed-command.toml",
        fileContent: validTomlContent,
        validate: false,
      });

      // Manually set malformed content to test validation
      (command as any).fileContent = malformedTomlContent;

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("GeminiCliCommandFrontmatterSchema", () => {
    it("should validate valid frontmatter with description", () => {
      const validFrontmatter = {
        description: "Test description",
        prompt: "Test prompt",
      };

      const result = GeminiCliCommandFrontmatterSchema.parse(validFrontmatter);
      expect(result).toEqual(validFrontmatter);
    });

    it("should validate valid frontmatter without description", () => {
      const frontmatterWithoutDescription = {
        prompt: "Test prompt",
      };

      const result = GeminiCliCommandFrontmatterSchema.parse(frontmatterWithoutDescription);
      expect(result).toEqual({
        prompt: "Test prompt",
      });
    });

    it("should throw error for frontmatter without prompt", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      expect(() => GeminiCliCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });

    it("should throw error for frontmatter with invalid types", () => {
      const invalidFrontmatter = {
        description: 123, // Should be string
        prompt: true, // Should be string
      };

      expect(() => GeminiCliCommandFrontmatterSchema.parse(invalidFrontmatter)).toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle empty prompt content", () => {
      const emptyPromptToml = `description = "Empty prompt test"
prompt = ""`;

      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "empty-prompt.toml",
        fileContent: emptyPromptToml,
        validate: true,
      });

      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({
        description: "Empty prompt test",
        prompt: "",
      });
    });

    it("should handle special characters in prompt", () => {
      const specialCharToml = `description = "Special characters test"
prompt = """
This prompt contains special characters: @#$%^&*()
And unicode: 你好世界 🌍
And escaped quotes: "Hello "World""
"""`;

      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "special-char.toml",
        fileContent: specialCharToml,
        validate: true,
      });

      expect(command.getBody()).toContain("@#$%^&*()");
      expect(command.getBody()).toContain("你好世界 🌍");
      expect(command.getBody()).toContain('Hello "World"');
    });

    it("should handle very long prompt content", () => {
      const longPrompt = "A".repeat(10000);
      const longPromptToml = `description = "Long prompt test"
prompt = """
${longPrompt}
"""`;

      const command = new GeminiCliCommand({
        baseDir: testDir,
        relativeDirPath: ".gemini/commands",
        relativeFilePath: "long-prompt.toml",
        fileContent: longPromptToml,
        validate: true,
      });

      expect(command.getBody()).toBe(longPrompt + "\n");
      expect(command.getBody().length).toBe(10001);
    });
  });
});
