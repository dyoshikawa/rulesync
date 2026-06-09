import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import {
  FactorydroidCommand,
  FactorydroidCommandFrontmatterSchema,
} from "./factorydroid-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("FactorydroidCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
description: Test factorydroid command description
argument-hint: "[pr-number]"
---

This is the body of the factorydroid command.
It can be multiline.`;

  const invalidMarkdownContent = `---
description: 123
---

Body content`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for factorydroid commands", () => {
      const paths = FactorydroidCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "commands"),
      });
    });

    it("should return the same relative path in global mode", () => {
      const paths = FactorydroidCommand.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "commands"),
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create FactorydroidCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["factorydroid"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "",
        validate: true,
      });

      const factorydroidCommand = FactorydroidCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(factorydroidCommand).toBeInstanceOf(FactorydroidCommand);
      expect(factorydroidCommand.getBody()).toBe("Test command content");
      expect(factorydroidCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
      });
      expect(factorydroidCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(factorydroidCommand.getRelativeDirPath()).toBe(join(".factory", "commands"));
    });

    it("should merge factorydroid section fields (argument-hint, allowed-tools)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          targets: ["factorydroid"],
          description: "Review a PR",
          factorydroid: {
            "argument-hint": "[pr-number]",
            "allowed-tools": ["Read", "Bash"],
          },
        },
        body: "Review $ARGUMENTS",
        fileContent: "",
        validate: true,
      });

      const factorydroidCommand = FactorydroidCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(factorydroidCommand.getFrontmatter()).toEqual({
        description: "Review a PR",
        "argument-hint": "[pr-number]",
        "allowed-tools": ["Read", "Bash"],
      });
      expect(factorydroidCommand.getFileContent()).toContain("argument-hint");
    });

    it("should generate into the same relative path in global mode", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "global.md",
        frontmatter: { targets: ["factorydroid"], description: "Global command" },
        body: "Global body",
        fileContent: "",
        validate: true,
      });

      const factorydroidCommand = FactorydroidCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(factorydroidCommand.getRelativeDirPath()).toBe(join(".factory", "commands"));
      expect(factorydroidCommand.getBody()).toBe("Global body");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should round-trip native frontmatter including argument-hint", () => {
      const command = new FactorydroidCommand({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "commands"),
        relativeFilePath: "review.md",
        frontmatter: {
          description: "Review a PR",
          "argument-hint": "[pr-number]",
        },
        body: "Review $ARGUMENTS",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review a PR",
        factorydroid: {
          "argument-hint": "[pr-number]",
        },
      });
      expect(rulesyncCommand.getBody()).toBe("Review $ARGUMENTS");
    });

    it("should not emit a factorydroid section when only description is present", () => {
      const command = new FactorydroidCommand({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "commands"),
        relativeFilePath: "simple.md",
        frontmatter: { description: "Simple" },
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Simple",
      });
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidCommand from file", async () => {
      const commandsDir = join(testDir, ".factory", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await FactorydroidCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(FactorydroidCommand);
      expect(command.getBody()).toBe(
        "This is the body of the factorydroid command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test factorydroid command description",
        "argument-hint": "[pr-number]",
      });
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".factory", "commands");
      const filePath = join(commandsDir, "invalid-command.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        FactorydroidCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for rulesync command with wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = FactorydroidCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with factorydroid target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["factorydroid"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = FactorydroidCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return false for rulesync command with different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = FactorydroidCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new FactorydroidCommand({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "commands"),
        relativeFilePath: "valid.md",
        frontmatter: { description: "Valid" },
        body: "Body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("FactorydroidCommandFrontmatterSchema", () => {
    it("should accept description, argument-hint and allowed-tools", () => {
      const result = FactorydroidCommandFrontmatterSchema.safeParse({
        description: "Test",
        "argument-hint": "[arg]",
        "allowed-tools": "Read",
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-string description", () => {
      const result = FactorydroidCommandFrontmatterSchema.safeParse({ description: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const command = FactorydroidCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "commands"),
        relativeFilePath: "to-delete.md",
      });

      expect(command).toBeInstanceOf(FactorydroidCommand);
      expect(command.getRelativeFilePath()).toBe("to-delete.md");
      expect(command.isDeletable()).toBe(true);
    });
  });
});
