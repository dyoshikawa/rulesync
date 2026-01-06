import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CursorCommand } from "./cursor-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("CursorCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validMarkdownContent = `This is the body of the cursor command.
It can be multiline.`;

  const markdownContentWithFrontmatter = `---
description: Test cursor command description
---

This is the body of the cursor command.
It can be multiline.`;

  const markdownWithoutFrontmatter = `This is just plain content without frontmatter.`;

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
    it("should return correct paths for cursor commands", () => {
      const paths = CursorCommand.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".cursor", "commands"),
      });
    });

    it("should return global paths when global is true", () => {
      const paths = CursorCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".cursor", "commands"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body of the cursor command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getFileContent()).toBe(
        "This is the body of the cursor command.\nIt can be multiline.",
      );
    });

    it("should create instance with empty content", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "",
        validate: true,
      });

      expect(command.getFileContent()).toBe("");
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CursorCommand);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getFileContent()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getBody", () => {
    it("should return the same as getFileContent", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "This is the body content.\nWith multiple lines.",
        validate: true,
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
      expect(command.getBody()).toBe(command.getFileContent());
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        fileContent: "Test body content",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test body content");
      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncCommand.getFrontmatter().description).toBe("");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(rulesyncCommand.getFileContent()).toContain("Test body content");
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create CursorCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test description from rulesync",
        },
        body: "Test command content",
        fileContent: "", // Will be generated
        validate: true,
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(cursorCommand).toBeInstanceOf(CursorCommand);
      expect(cursorCommand.getFileContent()).toBe("Test command content");
      expect(cursorCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(cursorCommand.getRelativeDirPath()).toBe(".cursor/commands");
    });

    it("should handle RulesyncCommand with different file extensions", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "complex-command.txt",
        frontmatter: {
          targets: ["cursor"],
          description: "Complex command",
        },
        body: "Complex content",
        fileContent: "",
        validate: true,
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(cursorCommand.getRelativeFilePath()).toBe("complex-command.txt");
    });

    it("should handle empty description", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-command.md",
        frontmatter: {
          targets: ["cursor"],
          description: "",
        },
        body: "Test content",
        fileContent: "",
        validate: true,
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(cursorCommand.getFileContent()).toBe("Test content");
    });

    it("should use global paths when global is true", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "global-test.md",
        frontmatter: {
          targets: ["*"],
          description: "Global test command",
        },
        body: "Global command body",
        fileContent: "",
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(cursorCommand).toBeInstanceOf(CursorCommand);
      expect(cursorCommand.getRelativeDirPath()).toBe(join(".cursor", "commands"));
      expect(cursorCommand.getBody()).toBe("Global command body");
    });

    it("should use local paths when global is false", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "local-test.md",
        frontmatter: {
          targets: ["*"],
          description: "Local test command",
        },
        body: "Local command body",
        fileContent: "",
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        global: false,
      });

      expect(cursorCommand).toBeInstanceOf(CursorCommand);
      expect(cursorCommand.getRelativeDirPath()).toBe(join(".cursor", "commands"));
      expect(cursorCommand.getBody()).toBe("Local command body");
    });
  });

  describe("fromFile", () => {
    it("should load CursorCommand from file", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "test-file-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getFileContent()).toBe(
        "This is the body of the cursor command.\nIt can be multiline.",
      );
      expect(command.getRelativeFilePath()).toBe("test-file-command.md");
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".cursor", "commands", "subdir");
      const filePath = join(commandsDir, "nested-command.md");

      await writeFileContent(filePath, validMarkdownContent);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("nested-command.md");
      expect(command.getRelativeDirPath()).toBe(".cursor/commands");
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CursorCommand.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent-command.md",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should handle file with frontmatter (stripping it)", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "with-frontmatter.md");

      await writeFileContent(filePath, markdownContentWithFrontmatter);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "with-frontmatter.md",
        validate: true,
      });

      expect(command.getFileContent()).toBe(
        "This is the body of the cursor command.\nIt can be multiline.",
      );
    });

    it("should handle file without frontmatter", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "no-frontmatter.md");

      await writeFileContent(filePath, markdownWithoutFrontmatter);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-frontmatter.md",
        validate: true,
      });

      expect(command.getFileContent()).toBe("This is just plain content without frontmatter.");
    });

    it("should trim whitespace from file content", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "with-whitespace.md");
      const contentWithWhitespace = "\n\n  This content has whitespace  \n\n";

      await writeFileContent(filePath, contentWithWhitespace);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "with-whitespace.md",
        validate: true,
      });

      expect(command.getFileContent()).toBe("This content has whitespace");
    });

    it("should load from global path when global is true", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "global-test.md");

      await writeFileContent(filePath, "Global command body");

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "global-test.md",
        global: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe("Global command body");
      expect(command.getRelativeDirPath()).toBe(join(".cursor", "commands"));
    });

    it("should load from local path when global is false", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      const filePath = join(commandsDir, "local-test.md");

      await writeFileContent(filePath, "Local command body");

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "local-test.md",
        global: false,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe("Local command body");
      expect(command.getRelativeDirPath()).toBe(join(".cursor", "commands"));
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "valid-command.md",
        fileContent: "Valid body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "empty-body.md",
        fileContent: "",
        validate: true,
      });

      expect(command.getFileContent()).toBe("");
    });

    it("should handle special characters in content", () => {
      const specialContent =
        "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "special-char.md",
        fileContent: specialContent,
        validate: true,
      });

      expect(command.getFileContent()).toBe(specialContent);
      expect(command.getFileContent()).toContain("@#$%^&*()");
      expect(command.getFileContent()).toContain("你好世界 🌍");
      expect(command.getFileContent()).toContain("\"Hello 'World'\"");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
        validate: true,
      });

      expect(command.getFileContent()).toBe(longContent);
      expect(command.getFileContent().length).toBe(10000);
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "windows-lines.md",
        fileContent: windowsContent,
        validate: true,
      });

      expect(command.getFileContent()).toBe(windowsContent);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from ToolCommand", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        fileContent: "Body",
        validate: true,
      });

      // Check that it's an instance of parent classes
      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getRelativeDirPath()).toBe(".cursor/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle baseDir correctly", () => {
      const customBaseDir = "/custom/base/dir";
      const command = new CursorCommand({
        baseDir: customBaseDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        fileContent: "Body",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for rulesync command with wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with cursor target", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return true for rulesync command with cursor and other targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode", "cursor", "cline"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });

    it("should return false for rulesync command with different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["claudecode"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(false);
    });

    it("should return false for rulesync command with empty targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: [], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(false);
    });

    it("should return true for rulesync command with undefined targets (defaults to true)", () => {
      // Create a RulesyncCommand with undefined targets by bypassing validation
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined as any, description: "Test" },
        body: "Body",
        fileContent: "",
        validate: false, // Skip validation to allow undefined targets
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });
});
