import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { ClaudecodeCommand, ClaudecodeCommandFrontmatterSchema } from "./claudecode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import type {
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

describe("ClaudecodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await setupTestDirectory();
    testDir = result.testDir;
    cleanup = result.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create a valid ClaudecodeCommand instance", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new ClaudecodeCommand({
          baseDir: testDir,
          relativeDirPath: ".claude/commands",
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("This is a test command body");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Test command");
      expect(fileContent).toContain("This is a test command body");
    });
  });

  describe("getBody", () => {
    it("should return the command body", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Command body content",
      });

      expect(command.getBody()).toBe("Command body content");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const frontmatter = { description: "Test command description" };
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Command body",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid description" },
        body: "Command body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success when frontmatter is undefined", () => {
      // Create command with validation disabled to avoid constructor validation
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: {} as any,
        body: "Command body",
        validate: false,
      });

      // Manually set frontmatter to undefined to test the condition
      (command as any).frontmatter = undefined;

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "Command body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Command body content",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Command body content");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test command",
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(".rulesync/commands");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test.md");
    });

    it("should generate proper file content for RulesyncCommand", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "example.md",
        frontmatter: { description: "Example command" },
        body: "Example body",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      const fileContent = rulesyncCommand.getFileContent();

      expect(fileContent).toContain("targets:");
      expect(fileContent).toContain("- '*'");
      expect(fileContent).toContain("description: Example command");
      expect(fileContent).toContain("Example body");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create ClaudecodeCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "sync-test.md",
        frontmatter: {
          targets: ["*"],
          description: "Sync test command",
        },
        body: "Sync command body",
        fileContent: "",
      });

      const claudecodeCommand = ClaudecodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(claudecodeCommand).toBeInstanceOf(ClaudecodeCommand);
      expect(claudecodeCommand.getBody()).toBe("Sync command body");
      expect(claudecodeCommand.getFrontmatter()).toEqual({
        description: "Sync test command",
      });
      expect(claudecodeCommand.getRelativeDirPath()).toBe(".claude/commands");
      expect(claudecodeCommand.getRelativeFilePath()).toBe("sync-test.md");
      expect(claudecodeCommand.getBaseDir()).toBe(testDir);
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          description: "Test command",
        },
        body: "Test body",
        fileContent: "",
      });

      const claudecodeCommand = ClaudecodeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(claudecodeCommand.getBaseDir()).toBe(".");
    });

    it("should disable validation when specified", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          description: "Test command",
        },
        body: "Test body",
        fileContent: "",
        validate: false,
      });

      const claudecodeCommand = ClaudecodeCommand.fromRulesyncCommand({
        rulesyncCommand,
        validate: false,
      });

      expect(claudecodeCommand).toBeInstanceOf(ClaudecodeCommand);
    });
  });

  describe("fromFile", () => {
    it("should load ClaudecodeCommand from file", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: File test command
---
This is the command body from file`;

      const filePath = join(commandsDir, "file-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ClaudecodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
      expect(command.getBody()).toBe("This is the command body from file");
      expect(command.getFrontmatter()).toEqual({
        description: "File test command",
      });
      expect(command.getRelativeFilePath()).toBe("file-test.md");
      expect(command.getRelativeDirPath()).toBe(".claude/commands");
      expect(command.getBaseDir()).toBe(testDir);
    });

    it("should use default baseDir when not provided", async () => {
      const commandsDir = join(".", ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Default dir test
---
Command body`;

      const filePath = join(commandsDir, "default-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ClaudecodeCommand.fromFile({
        relativeFilePath: "default-test.md",
      });

      expect(command.getBaseDir()).toBe(".");
    });

    it("should throw error for invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: 123
invalid: field
---
Command body`;

      const filePath = join(commandsDir, "invalid-test.md");
      await writeFileContent(filePath, fileContent);

      await expect(
        ClaudecodeCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid-test.md",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should handle files with complex frontmatter", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: "Complex command with quotes and special chars: @#$%"
---

This is a multi-line command body.

It has several paragraphs and formatting.
`;

      const filePath = join(commandsDir, "complex-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ClaudecodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "complex-test.md",
      });

      expect(command.getFrontmatter().description).toBe(
        "Complex command with quotes and special chars: @#$%",
      );
      expect(command.getBody()).toContain("This is a multi-line command body.");
      expect(command.getBody()).toContain("It has several paragraphs and formatting.");
    });

    it("should trim whitespace from body", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Whitespace test
---

   
   Body with leading and trailing whitespace   
   

`;

      const filePath = join(commandsDir, "whitespace-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ClaudecodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "whitespace-test.md",
      });

      expect(command.getBody()).toBe("Body with leading and trailing whitespace");
    });

    it("should disable validation when specified", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Test command
---
Command body`;

      const filePath = join(commandsDir, "validation-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ClaudecodeCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(command).toBeInstanceOf(ClaudecodeCommand);
    });
  });

  describe("ClaudecodeCommandFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const validFrontmatter = { description: "Valid description" };
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(validFrontmatter);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {};
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with non-string description", () => {
      const invalidFrontmatter = { description: 123 };
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(invalidFrontmatter);

      expect(result.success).toBe(false);
    });

    it("should allow additional properties", () => {
      const frontmatterWithExtra = {
        description: "Valid description",
        extra: "property",
      };
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatterWithExtra);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Valid description");
      }
    });
  });

  describe("integration with ToolCommand", () => {
    it("should inherit from ToolCommand", () => {
      const command = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Command body",
      });

      expect(command.getRelativeDirPath()).toBe(".claude/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBaseDir()).toBe(testDir);
      expect(typeof command.getFilePath).toBe("function");
      expect(typeof command.validate).toBe("function");
    });

    it("should support round-trip conversion with RulesyncCommand", () => {
      const originalCommand = new ClaudecodeCommand({
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "roundtrip.md",
        frontmatter: { description: "Round trip test" },
        body: "Original command body",
      });

      const rulesyncCommand = originalCommand.toRulesyncCommand();
      const convertedCommand = ClaudecodeCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(convertedCommand.getBody()).toBe("Original command body");
      expect(convertedCommand.getFrontmatter()).toEqual({
        description: "Round trip test",
      });
      expect(convertedCommand.getRelativeFilePath()).toBe("roundtrip.md");
    });
  });

  describe("error handling", () => {
    it("should handle file reading errors gracefully", async () => {
      await expect(
        ClaudecodeCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent.md",
        }),
      ).rejects.toThrow();
    });

    it("should throw validation errors with helpful messages", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: 42
---
Body`;

      const filePath = join(commandsDir, "error-test.md");
      await writeFileContent(filePath, fileContent);

      await expect(
        ClaudecodeCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "error-test.md",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("type definitions", () => {
    it("should have proper ClaudecodeCommandParams type", () => {
      const params = {
        baseDir: testDir,
        relativeDirPath: ".claude/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test" },
        body: "Body",
      };

      const command = new ClaudecodeCommand(params);
      expect(command).toBeInstanceOf(ClaudecodeCommand);
    });

    it("should work with ToolCommandFromFileParams", async () => {
      const commandsDir = join(testDir, ".claude", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Type test
---
Body`;

      const filePath = join(commandsDir, "type-test.md");
      await writeFileContent(filePath, fileContent);

      const params: ToolCommandFromFileParams = {
        baseDir: testDir,
        relativeFilePath: "type-test.md",
      };

      const command = await ClaudecodeCommand.fromFile(params);
      expect(command).toBeInstanceOf(ClaudecodeCommand);
    });

    it("should work with ToolCommandFromRulesyncCommandParams", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "type-test.md",
        frontmatter: { targets: ["*"], description: "Type test" },
        body: "Body",
        fileContent: "",
      });

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: testDir,
        rulesyncCommand,
      };

      const command = ClaudecodeCommand.fromRulesyncCommand(params);
      expect(command).toBeInstanceOf(ClaudecodeCommand);
    });
  });
});
