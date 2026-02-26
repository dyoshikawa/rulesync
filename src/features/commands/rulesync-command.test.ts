import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  RulesyncCommand,
  RulesyncCommandFrontmatter,
  RulesyncCommandFrontmatterSchema,
  RulesyncCommandParams,
} from "./rulesync-command.js";

describe("RulesyncCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let validParams: RulesyncCommandParams;

  const validFrontmatter: RulesyncCommandFrontmatter = {
    targets: ["cursor"],
    description: "Test command description",
  };

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    validParams = {
      baseDir: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "test-command.md",
      frontmatter: validFrontmatter,
      body: "This is the command body content",
      fileContent: "", // This will be overridden by constructor
    };
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with valid parameters", () => {
      const command = new RulesyncCommand(validParams);

      expect(command).toBeInstanceOf(RulesyncCommand);
      expect(command.getFrontmatter()).toEqual(validFrontmatter);
      expect(command.getBody()).toBe("This is the command body content");
      expect(command.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(command.getRelativeFilePath()).toBe("test-command.md");
    });

    it("should create instance without validation when validate is false", () => {
      const invalidFrontmatter = {
        targets: "invalid", // Should be array
        description: 123, // Should be string
      };

      const paramsWithInvalidData: RulesyncCommandParams = {
        ...validParams,
        frontmatter: invalidFrontmatter as any,
        validate: false,
      };

      expect(() => new RulesyncCommand(paramsWithInvalidData)).not.toThrow();
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      const invalidFrontmatter = {
        targets: "invalid", // Should be array
        description: 123, // Should be string
      };

      const paramsWithInvalidData: RulesyncCommandParams = {
        ...validParams,
        frontmatter: invalidFrontmatter as any,
        validate: true, // Enable validation
      };

      expect(() => new RulesyncCommand(paramsWithInvalidData)).toThrow();
    });

    it("should throw error for missing required frontmatter fields", () => {
      const incompleteFrontmatter = {
        targets: ["cursor"],
        // Missing description
      };

      const paramsWithIncompleteData: RulesyncCommandParams = {
        ...validParams,
        frontmatter: incompleteFrontmatter as any,
        validate: true, // Enable validation
      };

      expect(() => new RulesyncCommand(paramsWithIncompleteData)).toThrow();
    });

    it("should generate correct file content from frontmatter and body", () => {
      const command = new RulesyncCommand(validParams);
      const fileContent = command.getFileContent();

      expect(fileContent).toContain("---");
      expect(fileContent).toContain("targets:");
      expect(fileContent).toContain("- cursor");
      expect(fileContent).toContain("description: Test command description");
      expect(fileContent).toContain("This is the command body content");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const command = new RulesyncCommand(validParams);
      const frontmatter = command.getFrontmatter();

      expect(frontmatter).toEqual(validFrontmatter);
      expect(frontmatter.targets).toEqual(["cursor"]);
      expect(frontmatter.description).toBe("Test command description");
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const command = new RulesyncCommand(validParams);
      const body = command.getBody();

      expect(body).toBe("This is the command body content");
    });

    it("should return empty string if body is empty", () => {
      const paramsWithEmptyBody: RulesyncCommandParams = {
        ...validParams,
        body: "",
      };

      const command = new RulesyncCommand(paramsWithEmptyBody);
      expect(command.getBody()).toBe("");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new RulesyncCommand(validParams);
      const result = command.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success if frontmatter is undefined during validate call", () => {
      // Create a command normally, but test the validate method's handling of undefined frontmatter
      const command = new RulesyncCommand(validParams);

      // Manually set frontmatter to undefined to test the validate method logic
      (command as any).frontmatter = undefined;

      const result = command.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return failure for invalid frontmatter", () => {
      const invalidFrontmatter = {
        targets: "invalid", // Should be array
        description: 123, // Should be string
      };

      const command = new RulesyncCommand({
        ...validParams,
        frontmatter: invalidFrontmatter as any,
        validate: false,
      });

      const result = command.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return failure for missing required fields", () => {
      const incompleteFrontmatter = {
        targets: ["cursor"],
        // Missing description
      };

      const command = new RulesyncCommand({
        ...validParams,
        frontmatter: incompleteFrontmatter as any,
        validate: false,
      });

      const result = command.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("RulesyncCommandFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const validData = {
        targets: ["cursor"],
        description: "Valid description",
      };

      const result = RulesyncCommandFrontmatterSchema.safeParse(validData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targets).toEqual(["cursor"]);
        expect(result.data.description).toBe("Valid description");
      }
    });

    it("should reject invalid targets", () => {
      const invalidData = {
        targets: "invalid_string",
        description: "Valid description",
      };

      const result = RulesyncCommandFrontmatterSchema.safeParse(invalidData);

      expect(result.success).toBe(false);
    });

    it("should reject missing description", () => {
      const invalidData = {
        targets: ["cursor"],
      };

      const result = RulesyncCommandFrontmatterSchema.safeParse(invalidData);

      expect(result.success).toBe(false);
    });

    it("should reject non-string description", () => {
      const invalidData = {
        targets: ["cursor"],
        description: 123,
      };

      const result = RulesyncCommandFrontmatterSchema.safeParse(invalidData);

      expect(result.success).toBe(false);
    });

    it("should use default targets when omitted", () => {
      const dataWithoutTargets = {
        description: "Valid description",
      };

      const result = RulesyncCommandFrontmatterSchema.safeParse(dataWithoutTargets);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targets).toEqual(["*"]);
      }
    });
  });

  describe("integration with RulesyncFile", () => {
    it("should inherit all RulesyncFile functionality", () => {
      const command = new RulesyncCommand(validParams);

      // Should have all RulesyncFile methods
      expect(command.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getBaseDir()).toBe(testDir);
      expect(typeof command.getFilePath).toBe("function");
      expect(typeof command.getFileContent).toBe("function");
      expect(typeof command.validate).toBe("function");
    });

    it("should support basic file operations", async () => {
      const command = new RulesyncCommand(validParams);

      // Check that we have the expected methods and content
      expect(typeof command.getFilePath).toBe("function");
      expect(typeof command.getFileContent).toBe("function");
      expect(command.getFileContent()).toContain("Test command description");
      expect(command.getFileContent()).toContain("This is the command body content");
    });
  });

  describe("edge cases", () => {
    it("should handle empty body", () => {
      const paramsWithEmptyBody: RulesyncCommandParams = {
        ...validParams,
        body: "",
      };

      const command = new RulesyncCommand(paramsWithEmptyBody);

      expect(command.getBody()).toBe("");
      expect(command.getFileContent()).toContain("---");
    });

    it("should handle complex target configurations", () => {
      const complexFrontmatter: RulesyncCommandFrontmatter = {
        targets: ["cursor", "copilot", "cline", "warp"],
        description: "Command for multiple editors",
      };

      const command = new RulesyncCommand({
        ...validParams,
        frontmatter: complexFrontmatter,
      });

      expect(command.getFrontmatter().targets).toHaveLength(4);
      expect(command.getFrontmatter().targets).toContain("copilot");
      expect(command.getFrontmatter().targets).toContain("warp");
    });

    it("should handle multiline descriptions", () => {
      const frontmatterWithMultilineDesc: RulesyncCommandFrontmatter = {
        targets: ["cursor"],
        description:
          "This is a very long description that spans multiple lines and contains detailed information about what this command does.",
      };

      const command = new RulesyncCommand({
        ...validParams,
        frontmatter: frontmatterWithMultilineDesc,
      });

      expect(command.getFrontmatter().description).toContain("multiple lines");
      expect(command.validate().success).toBe(true);
    });

    it("should handle special characters in body", () => {
      const bodyWithSpecialChars = "Body with special characters: @#$%^&*(){}[]|\\:;\"'<>?.,/~`";

      const command = new RulesyncCommand({
        ...validParams,
        body: bodyWithSpecialChars,
      });

      expect(command.getBody()).toBe(bodyWithSpecialChars);
      expect(command.getFileContent()).toContain(bodyWithSpecialChars);
    });
  });

  describe("fromFile", () => {
    it("should load rulesync command from file", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      await ensureDir(commandsDir);

      const fileContent = `---
targets:
  - claudecode
description: Test command
---
Test command body`;

      await writeFileContent(join(commandsDir, "test.md"), fileContent);

      const command = await RulesyncCommand.fromFile({
        relativeFilePath: "test.md",
      });

      expect(command).toBeInstanceOf(RulesyncCommand);
      expect(command.getBody()).toBe("Test command body");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should preserve subdirectory path in relativeFilePath", async () => {
      const commandsDir = join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "pj");
      await ensureDir(commandsDir);

      const fileContent = `---
targets:
  - claudecode
description: Subdirectory command
---
Subdirectory body`;

      await writeFileContent(join(commandsDir, "sub-test.md"), fileContent);

      const command = await RulesyncCommand.fromFile({
        relativeFilePath: join("pj", "sub-test.md"),
      });

      expect(command).toBeInstanceOf(RulesyncCommand);
      expect(command.getBody()).toBe("Subdirectory body");
      expect(command.getRelativeFilePath()).toBe(join("pj", "sub-test.md"));
      expect(command.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("error handling", () => {
    it("should provide meaningful error messages for validation failures", () => {
      const invalidFrontmatter = {
        targets: null,
        description: "",
      };

      expect(
        () =>
          new RulesyncCommand({
            ...validParams,
            frontmatter: invalidFrontmatter as any,
            validate: true, // Enable validation
          }),
      ).toThrow();
    });
  });
});
