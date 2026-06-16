import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QWENCODE_COMMANDS_DIR_PATH } from "../../constants/qwencode-paths.js";
import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QwencodeCommand, QwencodeCommandFrontmatterSchema } from "./qwencode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("QwencodeCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await setupTestDirectory();
    testDir = result.testDir;
    cleanup = result.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create a valid QwencodeCommand instance", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(QwencodeCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new QwencodeCommand({
          outputRoot: testDir,
          relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow();
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Test command");
      expect(fileContent).toContain("This is a test command body");
    });
  });

  describe("getSettablePaths", () => {
    it("should return the commands dir for project scope", () => {
      const paths = QwencodeCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(QWENCODE_COMMANDS_DIR_PATH);
      expect(paths.relativeDirPath).toBe(join(".qwen", "commands"));
    });

    it("should return the commands dir for global scope", () => {
      const paths = QwencodeCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(QWENCODE_COMMANDS_DIR_PATH);
      expect(paths.relativeDirPath).toBe(join(".qwen", "commands"));
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid description" },
        body: "Command body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
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

  describe("fromRulesyncCommand", () => {
    it("should emit Markdown with description frontmatter", () => {
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

      const qwencodeCommand = QwencodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(qwencodeCommand).toBeInstanceOf(QwencodeCommand);
      expect(qwencodeCommand.getBody()).toBe("Sync command body");
      expect(qwencodeCommand.getFrontmatter()).toEqual({
        description: "Sync test command",
      });
      expect(qwencodeCommand.getRelativeDirPath()).toBe(QWENCODE_COMMANDS_DIR_PATH);
      expect(qwencodeCommand.getRelativeFilePath()).toBe("sync-test.md");

      const fileContent = qwencodeCommand.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Sync test command");
      expect(fileContent).toContain("Sync command body");
    });

    it("should preserve qwencode-specific fields", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "passthrough.md",
        frontmatter: {
          targets: ["qwencode"],
          description: "Passthrough command",
          qwencode: {
            "custom-setting": true,
          },
        },
        body: "Body",
        fileContent: "",
      });

      const qwencodeCommand = QwencodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      const frontmatter = qwencodeCommand.getFrontmatter();
      expect(frontmatter.description).toBe("Passthrough command");
      expect(frontmatter["custom-setting"]).toBe(true);
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

      const qwencodeCommand = QwencodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(qwencodeCommand.getRelativeDirPath()).toBe(QWENCODE_COMMANDS_DIR_PATH);
      expect(qwencodeCommand.getBody()).toBe("Global command body");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
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

    it("should preserve extra fields in qwencode section", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test command",
          "another-field": { nested: "value" },
        },
        body: "Test body",
        validate: false,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      const frontmatter = rulesyncCommand.getFrontmatter();

      expect(frontmatter.qwencode).toEqual({
        "another-field": { nested: "value" },
      });
    });

    it("should not include qwencode section when no extra fields", () => {
      const command = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter().qwencode).toBeUndefined();
    });

    it("should support round-trip conversion with RulesyncCommand", () => {
      const originalCommand = new QwencodeCommand({
        outputRoot: testDir,
        relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: { description: "Round trip test" },
        body: "Original command body",
      });

      const rulesyncCommand = originalCommand.toRulesyncCommand();
      const convertedCommand = QwencodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(convertedCommand.getBody()).toBe("Original command body");
      expect(convertedCommand.getFrontmatter()).toEqual({
        description: "Round trip test",
      });
      expect(convertedCommand.getRelativeFilePath()).toBe("roundtrip.md");
    });
  });

  describe("fromFile", () => {
    it("should load QwencodeCommand from file", async () => {
      const commandsDir = join(testDir, QWENCODE_COMMANDS_DIR_PATH);
      await ensureDir(commandsDir);

      const fileContent = `---
description: File test command
---
This is the command body from file`;

      const filePath = join(commandsDir, "file-test.md");
      await writeFileContent(filePath, fileContent);

      const command = await QwencodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "file-test.md",
      });

      expect(command).toBeInstanceOf(QwencodeCommand);
      expect(command.getBody()).toBe("This is the command body from file");
      expect(command.getFrontmatter()).toEqual({
        description: "File test command",
      });
      expect(command.getRelativeFilePath()).toBe("file-test.md");
      expect(command.getRelativeDirPath()).toBe(QWENCODE_COMMANDS_DIR_PATH);
      expect(command.getOutputRoot()).toBe(testDir);
    });

    it("should throw error for invalid frontmatter", async () => {
      const commandsDir = join(testDir, QWENCODE_COMMANDS_DIR_PATH);
      await ensureDir(commandsDir);

      const fileContent = `---
description: 123
---
Command body`;

      const filePath = join(commandsDir, "invalid-test.md");
      await writeFileContent(filePath, fileContent);

      await expect(
        QwencodeCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "invalid-test.md",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should preserve subdirectory path in relativeFilePath", async () => {
      const commandsDir = join(testDir, QWENCODE_COMMANDS_DIR_PATH, "git");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Subdirectory command
---
Subdirectory command body`;

      const filePath = join(commandsDir, "commit.md");
      await writeFileContent(filePath, fileContent);

      const command = await QwencodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("git", "commit.md"),
      });

      expect(command).toBeInstanceOf(QwencodeCommand);
      expect(command.getBody()).toBe("Subdirectory command body");
      expect(command.getRelativeFilePath()).toBe(join("git", "commit.md"));
      expect(command.getRelativeDirPath()).toBe(QWENCODE_COMMANDS_DIR_PATH);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      expect(QwencodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for qwencode target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["qwencode"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      expect(QwencodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false for different target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
        fileContent: "",
      });

      expect(QwencodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("QwencodeCommandFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const result = QwencodeCommandFrontmatterSchema.safeParse({ description: "Valid" });
      expect(result.success).toBe(true);
    });

    it("should accept frontmatter without description", () => {
      const result = QwencodeCommandFrontmatterSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject non-string description", () => {
      const result = QwencodeCommandFrontmatterSchema.safeParse({ description: 123 });
      expect(result.success).toBe(false);
    });

    it("should allow additional properties", () => {
      const result = QwencodeCommandFrontmatterSchema.safeParse({
        description: "Valid",
        extra: "property",
      });
      expect(result.success).toBe(true);
    });
  });
});
