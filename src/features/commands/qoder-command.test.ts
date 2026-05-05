import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QoderCommand } from "./qoder-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("QoderCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

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
    it("should return correct paths for qoder commands", () => {
      const paths = QoderCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".qoder", "commands"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content and frontmatter", () => {
      const command = new QoderCommand({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test description" },
        body: "This is the body of the qoder command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(QoderCommand);
      expect(command.getBody()).toBe(
        "This is the body of the qoder command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
    });

    it("should create instance with empty frontmatter", () => {
      const command = new QoderCommand({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {},
        body: "Body content",
        validate: true,
      });

      expect(command).toBeInstanceOf(QoderCommand);
      expect(command.getBody()).toBe("Body content");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new QoderCommand({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test qoder command" },
        body: "This is a test command body",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Test qoder command");
      expect(fileContent).toContain("This is a test command body");
    });
  });

  describe("fromFile", () => {
    it("should create instance from valid file", async () => {
      const commandsDir = join(testDir, ".qoder", "commands");
      await ensureDir(commandsDir);
      const content = `---
description: Test command from file
---

This is a test command from file.`;
      await writeFileContent(join(commandsDir, "test-command.md"), content);

      const command = await QoderCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test-command.md",
      });

      expect(command).toBeInstanceOf(QoderCommand);
      expect(command.getBody()).toBe("This is a test command from file.");
      expect(command.getFrontmatter()).toEqual({ description: "Test command from file" });
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        QoderCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new QoderCommand({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test description" },
        body: "Test command body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(rulesyncCommand.getBody()).toBe("Test command body");
      expect(rulesyncCommand.getFrontmatter().description).toBe("Test description");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create QoderCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        frontmatter: {
          targets: ["*"],
          description: "Rulesync command description",
        },
        body: "Rulesync command body",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-command.md",
        fileContent: "",
        validate: false,
      });

      const command = QoderCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(QoderCommand);
      expect(command.getBody()).toBe("Rulesync command body");
      expect(command.getFrontmatter()).toEqual({
        description: "Rulesync command description",
      });
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for commands targeting qoder", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        frontmatter: { targets: ["qoder"], description: "test" },
        body: "Test",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        fileContent: "",
        validate: false,
      });

      expect(QoderCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for commands targeting all (*)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        frontmatter: { targets: ["*"], description: "test" },
        body: "Test",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        fileContent: "",
        validate: false,
      });

      expect(QoderCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false for commands not targeting qoder", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        frontmatter: { targets: ["cursor"], description: "test" },
        body: "Test",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        fileContent: "",
        validate: false,
      });

      expect(QoderCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return successful validation for valid frontmatter", () => {
      const command = new QoderCommand({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid command" },
        body: "Test body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create a QoderCommand instance for deletion", () => {
      const command = QoderCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".qoder/commands",
        relativeFilePath: "to-delete.md",
      });

      expect(command).toBeInstanceOf(QoderCommand);
    });
  });
});
