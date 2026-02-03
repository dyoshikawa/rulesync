import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FactorydroidCommand } from "./factorydroid-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("FactorydroidCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
description: Test factorydroid command description
---

This is the body of the factorydroid command.
It can be multiline.`;

  const invalidMarkdownContent = `---
# Missing required fields
invalid: true
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
        relativeDirPath: ".factorydroid/commands",
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create FactorydroidCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
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
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      }) as FactorydroidCommand;

      expect(factorydroidCommand).toBeInstanceOf(FactorydroidCommand);
      expect(factorydroidCommand.getBody()).toBe("Test command content");
      expect(factorydroidCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
      });
      expect(factorydroidCommand.getRelativeFilePath()).toBe("test-command.md");
    });
  });

  describe("fromFile", () => {
    it("should load FactorydroidCommand from file", async () => {
      const commandsDir = join(testDir, ".factorydroid", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await FactorydroidCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(FactorydroidCommand);
      expect(command.getBody()).toBe(
        "This is the body of the factorydroid command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test factorydroid command description",
      });
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        FactorydroidCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should throw error when file contains invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".factorydroid", "commands");
      const filePath = join(commandsDir, "invalid-command.md");

      await writeFileContent(filePath, invalidMarkdownContent);

      await expect(
        FactorydroidCommand.fromFile({
          baseDir: testDir,
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

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const command = FactorydroidCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".factorydroid/commands",
        relativeFilePath: "to-delete.md",
      });

      expect(command).toBeInstanceOf(FactorydroidCommand);
      expect(command.getRelativeFilePath()).toBe("to-delete.md");
    });
  });
});
