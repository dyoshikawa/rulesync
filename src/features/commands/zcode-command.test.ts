import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ZcodeCommand } from "./zcode-command.js";

const buildCommand = (targets: RulesyncTargets): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: { targets, description: "Test" },
    body: "Body",
    fileContent: "",
  });

describe("ZcodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const commandsDir = join(".zcode", "commands");

  describe("constructor", () => {
    it("should create a valid ZcodeCommand instance", () => {
      const command = new ZcodeCommand({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new ZcodeCommand({
          outputRoot: testDir,
          relativeDirPath: commandsDir,
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as unknown as string },
          body: "body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new ZcodeCommand({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as unknown as string },
        body: "body",
        validate: false,
      });

      expect(command).toBeInstanceOf(ZcodeCommand);
    });

    it("should serialize frontmatter and body into the file content", () => {
      const command = new ZcodeCommand({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command", "argument-hint": "[focus-area]" },
        body: "Review the staged diff. Focus on $ARGUMENTS.",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("description: Test command");
      expect(fileContent).toContain("argument-hint");
      expect(fileContent).toContain("[focus-area]");
      expect(fileContent).toContain("Review the staged diff. Focus on $ARGUMENTS.");
    });
  });

  describe("getSettablePaths", () => {
    it("should return .zcode/commands for both scopes", () => {
      expect(ZcodeCommand.getSettablePaths({ global: false }).relativeDirPath).toBe(commandsDir);
      expect(ZcodeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(commandsDir);
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to a RulesyncCommand", () => {
      const command = new ZcodeCommand({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
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
      expect(rulesyncCommand.getRelativeDirPath()).toBe(RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test.md");
    });

    it("should stash extra fields under the zcode section", () => {
      const command = new ZcodeCommand({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test command",
          "argument-hint": "[branch]",
          model: "glm-4.6",
        },
        body: "Command body content",
      });

      expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test command",
        zcode: { "argument-hint": "[branch]", model: "glm-4.6" },
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should restore the zcode section onto the tool frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          targets: ["*"],
          description: "Review the diff",
          zcode: { "argument-hint": "[branch]" },
        },
        body: "Review body",
        fileContent: "",
        validate: false,
      });

      const command = ZcodeCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

      expect(command.getRelativeDirPath()).toBe(commandsDir);
      expect(command.getRelativeFilePath()).toBe("review.md");
      expect(command.getFrontmatter()).toEqual({
        description: "Review the diff",
        "argument-hint": "[branch]",
      });
      expect(command.getBody()).toBe("Review body");
    });

    it("should use the same directory in global mode", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: { targets: ["*"], description: "Review the diff" },
        body: "Review body",
        fileContent: "",
        validate: false,
      });

      const command = ZcodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(commandsDir);
    });
  });

  describe("fromFile", () => {
    it("should read a command file from .zcode/commands", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "deploy.md"),
        `---\ndescription: Deploy the app\nargument-hint: "[env]"\n---\n\nDeploy to $ARGUMENTS.\n`,
      );

      const command = await ZcodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "deploy.md",
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Deploy the app",
        "argument-hint": "[env]",
      });
      expect(command.getBody()).toBe("Deploy to $ARGUMENTS.");
    });

    it("should throw for frontmatter that does not match the schema", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "broken.md"),
        `---\ndescription: 123\n---\n\nBody\n`,
      );

      await expect(
        ZcodeCommand.fromFile({ outputRoot: testDir, relativeFilePath: "broken.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should target zcode for wildcard and explicit targets, not others", () => {
      expect(ZcodeCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
      expect(ZcodeCommand.isTargetedByRulesyncCommand(buildCommand(["zcode"]))).toBe(true);
      expect(ZcodeCommand.isTargetedByRulesyncCommand(buildCommand(["claudecode"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should build an empty command instance", () => {
      const command = ZcodeCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "old.md",
      });

      expect(command.getRelativeFilePath()).toBe("old.md");
      expect(command.getBody()).toBe("");
    });
  });
});
