import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { writeFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { RooCommand, RooCommandFrontmatter, RooCommandFrontmatterSchema } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("RooCommand", () => {
  describe("constructor", () => {
    it("should create a RooCommand with valid frontmatter", () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Test command",
      };
      const body = "This is a test command body";

      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
      expect(command.getRelativeDirPath()).toBe(".roo/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should create a RooCommand with argument-hint in frontmatter", () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Test command with argument hint",
        "argument-hint": "Enter a filename",
      };
      const body = "Command with argument hint";

      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test-with-hint.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should validate frontmatter when validation is enabled", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid: should be string
      };

      expect(() => {
        new RooCommand({
          baseDir: ".",
          relativeDirPath: ".roo/commands",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter as any,
          body: "test body",
          fileContent: "test content",
          validate: true,
        });
      }).toThrow();
    });

    it("should skip validation when validation is disabled", () => {
      const invalidFrontmatter = {
        description: 123, // Invalid: should be string
      };

      expect(() => {
        new RooCommand({
          baseDir: ".",
          relativeDirPath: ".roo/commands",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter as any,
          body: "test body",
          fileContent: "test content",
          validate: false,
        });
      }).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Valid command",
      };

      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "test body",
        fileContent: stringifyFrontmatter("test body", frontmatter),
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 } as any,
        body: "test body",
        fileContent: "test content",
        validate: false, // Skip validation in constructor
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return success when frontmatter is undefined", () => {
      // Create a command with undefined frontmatter by manipulating the private field
      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "test" },
        body: "test body",
        fileContent: "test content",
        validate: false,
      });

      // Set frontmatter to undefined via type assertion for testing
      (command as any).frontmatter = undefined;

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert RooCommand to RulesyncCommand", () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Test command for conversion",
      };
      const body = "This command will be converted";

      const rooCommand = new RooCommand({
        baseDir: "/test/base",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "convert-test.md",
        frontmatter,
        body,
        fileContent: stringifyFrontmatter(body, frontmatter),
      });

      const rulesyncCommand = rooCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe(body);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["roo"],
        description: frontmatter.description,
      });
      expect(rulesyncCommand.getRelativeDirPath()).toBe(".rulesync/commands");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("convert-test.md");
      expect(rulesyncCommand.getBaseDir()).toBe(".");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create RooCommand from RulesyncCommand", () => {
      const rulesyncFrontmatter = {
        targets: ["roo" as const],
        description: "Converted from rulesync",
      };
      const body = "Command converted from rulesync";

      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "from-rulesync.md",
        frontmatter: rulesyncFrontmatter,
        body,
        fileContent: stringifyFrontmatter(body, rulesyncFrontmatter),
      });

      const rooCommand = RooCommand.fromRulesyncCommand({
        baseDir: "/converted/base",
        rulesyncCommand,
        validate: true,
      });

      expect(rooCommand).toBeInstanceOf(RooCommand);
      expect(rooCommand.getBody()).toBe(body);
      expect(rooCommand.getFrontmatter()).toEqual({
        description: rulesyncFrontmatter.description,
      });
      expect(rooCommand.getRelativeDirPath()).toBe(".roo/commands");
      expect(rooCommand.getRelativeFilePath()).toBe("from-rulesync.md");
      expect(rooCommand.getBaseDir()).toBe("/converted/base");
    });

    it("should use default baseDir when not provided", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["roo" as const], description: "test" },
        body: "test body",
        fileContent: "test content",
      });

      const rooCommand = RooCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(rooCommand.getBaseDir()).toBe(".");
    });

    it("should handle validation parameter", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: "/test/base",
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["roo" as const], description: "test" },
        body: "test body",
        fileContent: "test content",
      });

      const rooCommand = RooCommand.fromRulesyncCommand({
        rulesyncCommand,
        validate: false,
      });

      expect(rooCommand).toBeInstanceOf(RooCommand);
    });
  });

  describe("fromFile", () => {
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

    it("should create RooCommand from file", async () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Command loaded from file",
        "argument-hint": "Enter value",
      };
      const body = "This command was loaded from a file";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      // Write the test file
      const commandsDir = join(testDir, ".roo", "commands");
      const filePath = join(commandsDir, "from-file.md");
      await writeFileContent(filePath, fileContent);

      const command = await RooCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "from-file.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(RooCommand);
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
      expect(command.getRelativeDirPath()).toBe(".roo/commands");
      expect(command.getRelativeFilePath()).toBe("from-file.md");
      expect(command.getBaseDir()).toBe(testDir);
    });

    it("should use testDir as baseDir when provided", async () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Command with explicit baseDir",
      };
      const body = "Test body";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      // Write the test file in test directory
      const commandsDir = join(testDir, ".roo", "commands");
      const filePath = join(commandsDir, "basedir-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await RooCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "basedir-test.md",
      });

      expect(command.getBaseDir()).toBe(testDir);
    });

    it("should handle validation parameter", async () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Command with validation disabled",
      };
      const body = "Test body";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      const commandsDir = join(testDir, ".roo", "commands");
      const filePath = join(commandsDir, "no-validation.md");
      await writeFileContent(filePath, fileContent);

      const command = await RooCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-validation.md",
        validate: false,
      });

      expect(command).toBeInstanceOf(RooCommand);
    });

    it("should throw error for invalid frontmatter", async () => {
      const invalidFileContent = `---
description: 123
---
This file has invalid frontmatter`;

      const commandsDir = join(testDir, ".roo", "commands");
      const filePath = join(commandsDir, "invalid.md");
      await writeFileContent(filePath, invalidFileContent);

      await expect(
        RooCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "invalid.md",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should handle nested file paths", async () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Nested command",
      };
      const body = "Command in subfolder";
      const fileContent = stringifyFrontmatter(body, frontmatter);

      const commandsDir = join(testDir, ".roo", "commands");
      const filePath = join(commandsDir, "subfolder", "nested.md");
      await writeFileContent(filePath, fileContent);

      const command = await RooCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subfolder/nested.md",
      });

      expect(command.getRelativeFilePath()).toBe("nested.md");
      expect(command.getBody()).toBe(body);
    });
  });

  describe("RooCommandFrontmatterSchema", () => {
    it("should validate valid frontmatter", () => {
      const validFrontmatter = {
        description: "Valid description",
        "argument-hint": "Optional hint",
      };

      const result = RooCommandFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should validate frontmatter without argument-hint", () => {
      const frontmatter = {
        description: "Description only",
      };

      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(frontmatter);
      }
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {
        "argument-hint": "Missing description",
      };

      const result = RooCommandFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with invalid description type", () => {
      const invalidFrontmatter = {
        description: 123,
      };

      const result = RooCommandFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter with invalid argument-hint type", () => {
      const invalidFrontmatter = {
        description: "Valid description",
        "argument-hint": 456,
      };

      const result = RooCommandFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should allow frontmatter with extra properties", () => {
      const frontmatter = {
        description: "Valid description",
        "argument-hint": "Valid hint",
        extraProperty: "Allowed but ignored",
      };

      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBe("Valid description");
        expect(result.data["argument-hint"]).toBe("Valid hint");
        expect((result.data as any).extraProperty).toBeUndefined();
      }
    });
  });

  describe("getters", () => {
    it("should return correct body", () => {
      const body = "Test command body content";
      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "test" },
        body,
        fileContent: "test content",
      });

      expect(command.getBody()).toBe(body);
    });

    it("should return correct frontmatter", () => {
      const frontmatter: RooCommandFrontmatter = {
        description: "Test description",
        "argument-hint": "Test hint",
      };
      const command = new RooCommand({
        baseDir: ".",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "test body",
        fileContent: "test content",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("integration with ToolCommand", () => {
    it("should inherit ToolCommand functionality", () => {
      const frontmatter = { description: "Integration test" };
      const body = "Integration test body";
      const expectedFileContent = stringifyFrontmatter(body, frontmatter);

      const command = new RooCommand({
        baseDir: "/test/base",
        relativeDirPath: ".roo/commands",
        relativeFilePath: "integration.md",
        frontmatter,
        body,
        fileContent: expectedFileContent,
      });

      // Test inherited methods
      expect(command.getBaseDir()).toBe("/test/base");
      expect(command.getRelativeDirPath()).toBe(".roo/commands");
      expect(command.getRelativeFilePath()).toBe("integration.md");
      expect(command.getFileContent()).toBe(expectedFileContent);
      expect(command.getFilePath()).toBe("/test/base/.roo/commands/integration.md");
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

      const result = RooCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with roo target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["roo"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = RooCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with roo and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "roo", "cline"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = RooCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = RooCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = RooCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
