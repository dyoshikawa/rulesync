import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("CodexcliCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `---
description: Test codexcli command description
---

This is the body of the codexcli command.
It can be multiline.`;

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

  describe("getSettablePaths with global flag", () => {
    it("should return correct paths for codexcli commands in global mode", () => {
      const paths = CodexcliCommand.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: ".codex/prompts",
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body of the codexcli command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
      expect(command.getBody()).toBe(
        "This is the body of the codexcli command.\nIt can be multiline.",
      );
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "test-command.md",
        fileContent: "Test body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test body");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create CodexcliCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["codexcli"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
        global: true,
      });

      expect(codexcliCommand).toBeInstanceOf(CodexcliCommand);
      expect(codexcliCommand.getBody()).toBe("Test command content");
      expect(codexcliCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(codexcliCommand.getRelativeDirPath()).toBe(".codex/prompts");
    });

    it("should handle RulesyncCommand with different file extensions", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "complex-command.txt",
        frontmatter: {
          targets: ["codexcli"],
          description: "Complex command",
        },
        body: "Complex content",
        fileContent: "",
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
        global: true,
      });

      expect(codexcliCommand.getRelativeFilePath()).toBe("complex-command.txt");
    });

    it("should handle empty body", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["codexcli"],
          description: "",
        },
        body: "",
        fileContent: "",
        validate: true,
      });

      const codexcliCommand = CodexcliCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
        global: true,
      });

      expect(codexcliCommand.getBody()).toBe("");
    });
  });

  describe("fromFile", () => {
    it("should load CodexcliCommand from file", async () => {
      const commandsDir = join(testDir, ".codex", "prompts");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CodexcliCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
        global: true,
      });

      expect(command).toBeInstanceOf(CodexcliCommand);
      expect(command.getBody()).toBe(
        "This is the body of the codexcli command.\nIt can be multiline.",
      );
      expect(command.getRelativeFilePath()).toBe("test-file-command.md");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CodexcliCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
          global: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return success", () => {
      const command = new CodexcliCommand({
        baseDir: testDir,
        relativeDirPath: ".codex/prompts",
        relativeFilePath: "valid-command.md",
        fileContent: "Valid body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with codexcli target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["codexcli"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with codexcli and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor", "codexcli", "claudecode"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
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

      const result = CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
