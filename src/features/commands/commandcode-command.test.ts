import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CommandcodeCommand } from "./commandcode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("CommandcodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validContent = "# Sample prompt\n\nFollow these steps.";

  const markdownWithFrontmatter = `---
title: Example
---

# Prompt
Step 1`;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return commands path for project mode", () => {
      const paths = CommandcodeCommand.getSettablePaths();

      expect(paths).toEqual({ relativeDirPath: join(".commandcode", "commands") });
    });

    it("should use the same path in global mode", () => {
      const paths = CommandcodeCommand.getSettablePaths({ global: true });

      expect(paths).toEqual({ relativeDirPath: join(".commandcode", "commands") });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with default frontmatter", () => {
      const commandcodeCommand = new CommandcodeCommand({
        outputRoot: testDir,
        relativeDirPath: ".commandcode/commands",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      const rulesyncCommand = commandcodeCommand.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getFrontmatter()).toEqual({ targets: ["*"] });
      expect(rulesyncCommand.getBody()).toBe(validContent);
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create CommandcodeCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["commandcode"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      const commandcodeCommand = CommandcodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(commandcodeCommand).toBeInstanceOf(CommandcodeCommand);
      expect(commandcodeCommand.getRelativeDirPath()).toBe(join(".commandcode", "commands"));
      expect(commandcodeCommand.getFileContent()).toBe(validContent);
    });
  });

  describe("validate", () => {
    it("should always succeed", () => {
      const command = new CommandcodeCommand({
        outputRoot: testDir,
        relativeDirPath: ".commandcode/commands",
        relativeFilePath: "test.md",
        fileContent: validContent,
        validate: true,
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("fromFile", () => {
    it("should load and strip frontmatter", async () => {
      const commandsDir = join(testDir, ".commandcode", "commands");
      const filePath = join(commandsDir, "prompt.md");
      await writeFileContent(filePath, markdownWithFrontmatter);

      const command = await CommandcodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "prompt.md",
      });

      expect(command).toBeInstanceOf(CommandcodeCommand);
      expect(command.getRelativeDirPath()).toBe(join(".commandcode", "commands"));
      expect(command.getFileContent()).toBe("# Prompt\nStep 1");
    });

    it("should support global commands", async () => {
      const commandsDir = join(testDir, ".commandcode", "commands");
      const filePath = join(commandsDir, "global.md");
      await writeFileContent(filePath, validContent);

      const command = await CommandcodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global.md",
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".commandcode", "commands"));
      expect(command.getFileContent()).toBe(validContent);
    });

    it("should load a command from a namespacing subdirectory", async () => {
      const commandsDir = join(testDir, ".commandcode", "commands");
      await writeFileContent(join(commandsDir, "frontend", "component.md"), validContent);

      const command = await CommandcodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("frontend", "component.md"),
      });

      expect(command.getRelativeFilePath()).toBe(join("frontend", "component.md"));
      expect(command.getFileContent()).toBe(validContent);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true when rulesync targets include commandcode", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["commandcode"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(CommandcodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false when commandcode is not targeted", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "prompt.md",
        frontmatter: { targets: ["cursor"], description: "" },
        body: validContent,
        fileContent: validContent,
        validate: true,
      });

      expect(CommandcodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable command placeholder", () => {
      const command = CommandcodeCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".commandcode/commands",
        relativeFilePath: "obsolete.md",
      });

      expect(command.isDeletable()).toBe(true);
      expect(command.getFileContent()).toBe("");
    });
  });
});
