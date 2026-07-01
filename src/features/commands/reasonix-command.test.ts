import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReasonixCommand, ReasonixCommandFrontmatterSchema } from "./reasonix-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("ReasonixCommand", () => {
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

  describe("constructor", () => {
    it("should create a valid ReasonixCommand instance", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(ReasonixCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new ReasonixCommand({
          outputRoot: testDir,
          relativeDirPath: ".reasonix/commands",
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(ReasonixCommand);
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command", "argument-hint": "[focus-area]" },
        body: "Review the staged diff. Focus on $ARGUMENTS.",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Test command");
      expect(fileContent).toContain("argument-hint");
      expect(fileContent).toContain("[focus-area]");
      expect(fileContent).toContain("Review the staged diff. Focus on $ARGUMENTS.");
    });
  });

  describe("getSettablePaths", () => {
    it("should return .reasonix/commands for project mode", () => {
      const paths = ReasonixCommand.getSettablePaths({ global: false });
      expect(paths.relativeDirPath).toBe(join(".reasonix", "commands"));
    });

    it("should return .reasonix/commands for global mode too (home-relative outputRoot)", () => {
      const paths = ReasonixCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".reasonix", "commands"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
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

    it("should preserve extra fields (e.g. argument-hint) in the reasonix section", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command", "argument-hint": "[focus-area]" },
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      const frontmatter = rulesyncCommand.getFrontmatter();

      expect(frontmatter.reasonix).toEqual({ "argument-hint": "[focus-area]" });
    });

    it("should not include reasonix section when no extra fields", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter().reasonix).toBeUndefined();
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create ReasonixCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "sync-test.md",
        frontmatter: {
          targets: ["*"],
          description: "Sync test command",
        },
        body: "Sync command body",
        fileContent: "",
      });

      const reasonixCommand = ReasonixCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(reasonixCommand).toBeInstanceOf(ReasonixCommand);
      expect(reasonixCommand.getBody()).toBe("Sync command body");
      expect(reasonixCommand.getFrontmatter()).toEqual({
        description: "Sync test command",
      });
      expect(reasonixCommand.getRelativeDirPath()).toBe(join(".reasonix", "commands"));
      expect(reasonixCommand.getRelativeFilePath()).toBe("sync-test.md");
    });

    it("should preserve reasonix-specific fields (e.g. argument-hint)", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "passthrough-test.md",
        frontmatter: {
          targets: ["reasonix"],
          description: "Test command",
          reasonix: {
            "argument-hint": "[focus-area]",
          },
        },
        body: "Test body",
        fileContent: "",
      });

      const reasonixCommand = ReasonixCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      const frontmatter = reasonixCommand.getFrontmatter();
      expect(frontmatter.description).toBe("Test command");
      expect(frontmatter["argument-hint"]).toBe("[focus-area]");
    });

    it("should use global paths when global is true", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-test.md",
        frontmatter: {
          targets: ["*"],
          description: "Global test command",
        },
        body: "Global command body",
        fileContent: "",
      });

      const reasonixCommand = ReasonixCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(reasonixCommand.getRelativeDirPath()).toBe(join(".reasonix", "commands"));
      expect(reasonixCommand.getBody()).toBe("Global command body");
    });
  });

  describe("fromFile", () => {
    it("should load ReasonixCommand from file", async () => {
      const commandsDir = join(testDir, ".reasonix", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: File test command
argument-hint: "[message]"
---
This is the command body from file`;

      const filePath = join(commandsDir, "file-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await ReasonixCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(command).toBeInstanceOf(ReasonixCommand);
      expect(command.getBody()).toBe("This is the command body from file");
      expect(command.getFrontmatter()).toEqual({
        description: "File test command",
        "argument-hint": "[message]",
      });
      expect(command.getRelativeFilePath()).toBe("file-test.md");
    });

    it("should throw error for invalid frontmatter", async () => {
      const commandsDir = join(testDir, ".reasonix", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: 123
---
Command body`;

      const filePath = join(commandsDir, "invalid-test.md");
      await writeFileContent(filePath, fileContent);

      await expect(
        ReasonixCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-test.md",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should preserve subdirectory path (namespacing, e.g. git/commit.md)", async () => {
      const commandsDir = join(testDir, ".reasonix", "commands", "git");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Commit command
---
Commit command body`;

      const filePath = join(commandsDir, "commit.md");
      await writeFileContent(filePath, fileContent);

      const command = await ReasonixCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("git", "commit.md"),
      });

      expect(command).toBeInstanceOf(ReasonixCommand);
      expect(command.getRelativeFilePath()).toBe(join("git", "commit.md"));
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid description" },
        body: "Command body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new ReasonixCommand({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
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

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const command = ReasonixCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".reasonix/commands",
        relativeFilePath: "orphan.md",
      });

      expect(command).toBeInstanceOf(ReasonixCommand);
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

      expect(ReasonixCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for rulesync command with reasonix target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["reasonix"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      expect(ReasonixCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false for rulesync command with a different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      expect(ReasonixCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("ReasonixCommandFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const result = ReasonixCommandFrontmatterSchema.safeParse({
        description: "Valid description",
        "argument-hint": "[message]",
      });

      expect(result.success).toBe(true);
    });

    it("should reject frontmatter with non-string description", () => {
      const result = ReasonixCommandFrontmatterSchema.safeParse({ description: 123 });
      expect(result.success).toBe(false);
    });

    it("should allow additional properties (loose object)", () => {
      const result = ReasonixCommandFrontmatterSchema.safeParse({
        description: "Valid description",
        extra: "property",
      });

      expect(result.success).toBe(true);
    });
  });
});
