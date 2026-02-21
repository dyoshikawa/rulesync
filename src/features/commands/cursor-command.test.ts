import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CursorCommand, CursorCommandFrontmatterSchema } from "./cursor-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import type {
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

describe("CursorCommand", () => {
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
    it("should create instance with valid content and frontmatter", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test description" },
        body: "This is the body of the cursor command.\nIt can be multiline.",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe(
        "This is the body of the cursor command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
    });

    it("should create instance with empty frontmatter", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {},
        body: "Body content",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe("Body content");
    });

    it("should create instance without validation when validate is false", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        frontmatter: {},
        body: "Test body",
        validate: false,
      });

      expect(command).toBeInstanceOf(CursorCommand);
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test cursor command" },
        body: "This is a test command body",
      });

      const fileContent = command.getFileContent();
      expect(fileContent).toContain("---");
      expect(fileContent).toContain("description: Test cursor command");
      expect(fileContent).toContain("This is a test command body");
    });
  });

  describe("getBody", () => {
    it("should return the command body", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test" },
        body: "This is the body content.\nWith multiple lines.",
      });

      expect(command.getBody()).toBe("This is the body content.\nWith multiple lines.");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const frontmatter = { description: "Test cursor command description" };
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Command body",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand with description", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test-command.md",
        frontmatter: { description: "Test cursor description" },
        body: "Test body content",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getBody()).toBe("Test body content");
      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncCommand.getFrontmatter().description).toBe("Test cursor description");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test-command.md");
      expect(rulesyncCommand.getFileContent()).toContain("Test body content");
    });

    it("should default description to empty string when not set", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter().description).toBe("");
    });

    it("should preserve handoffs in cursor section", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test",
          handoffs: [{ label: "Build Plan", agent: "planner", prompt: "Plan this", send: true }],
        },
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      const fm = rulesyncCommand.getFrontmatter();
      expect(fm.cursor).toEqual({
        handoffs: [{ label: "Build Plan", agent: "planner", prompt: "Plan this", send: true }],
      });
    });

    it("should not include cursor section when no extra fields", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Just a description" },
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = command.toRulesyncCommand();
      expect(rulesyncCommand.getFrontmatter().cursor).toBeUndefined();
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
        fileContent: "",
        validate: true,
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
        validate: true,
      });

      expect(cursorCommand).toBeInstanceOf(CursorCommand);
      expect(cursorCommand.getBody()).toBe("Test command content");
      expect(cursorCommand.getFrontmatter()).toEqual({
        description: "Test description from rulesync",
      });
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

      expect(cursorCommand.getBody()).toBe("Test content");
      // Empty description should not be included in cursor frontmatter
      expect(cursorCommand.getFrontmatter()).toEqual({});
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

    it("should preserve cursor-specific fields from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "passthrough-test.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test command",
          cursor: {
            handoffs: [{ label: "Build Plan", agent: "planner", prompt: "Plan this", send: true }],
          },
        },
        body: "Test body",
        fileContent: "",
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      const frontmatter = cursorCommand.getFrontmatter();
      expect(frontmatter.description).toBe("Test command");
      expect(frontmatter.handoffs).toEqual([
        { label: "Build Plan", agent: "planner", prompt: "Plan this", send: true },
      ]);
    });

    it("should handle empty cursor fields in RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "empty-test.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Test command",
          cursor: {},
        },
        body: "Test body",
        fileContent: "",
      });

      const cursorCommand = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      const frontmatter = cursorCommand.getFrontmatter();
      expect(frontmatter.description).toBe("Test command");
      // No extra fields should be added
      expect(Object.keys(frontmatter)).toEqual(["description"]);
    });
  });

  describe("fromFile", () => {
    it("should load CursorCommand from file with frontmatter", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Test cursor command description
---

This is the body of the cursor command.
It can be multiline.`;

      const filePath = join(commandsDir, "test-file-command.md");
      await writeFileContent(filePath, fileContent);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-file-command.md",
        validate: true,
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe(
        "This is the body of the cursor command.\nIt can be multiline.",
      );
      expect(command.getFrontmatter()).toEqual({
        description: "Test cursor command description",
      });
      expect(command.getRelativeFilePath()).toBe("test-file-command.md");
    });

    it("should load CursorCommand from file with handoffs", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Create a spec
handoffs:
  - label: Build Plan
    agent: planner.plan
    prompt: Create a plan
  - label: Clarify
    agent: planner.clarify
    prompt: Clarify requirements
    send: true
---

This is the body.`;

      const filePath = join(commandsDir, "with-handoffs.md");
      await writeFileContent(filePath, fileContent);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "with-handoffs.md",
        validate: true,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Create a spec",
        handoffs: [
          { label: "Build Plan", agent: "planner.plan", prompt: "Create a plan" },
          {
            label: "Clarify",
            agent: "planner.clarify",
            prompt: "Clarify requirements",
            send: true,
          },
        ],
      });
      expect(command.getBody()).toBe("This is the body.");
    });

    it("should handle file without frontmatter", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "no-frontmatter.md"),
        "This is just plain content without frontmatter.",
      );

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-frontmatter.md",
        validate: true,
      });

      expect(command.getBody()).toBe("This is just plain content without frontmatter.");
      expect(command.getFrontmatter()).toEqual({});
    });

    it("should handle file path with subdirectories", async () => {
      const commandsDir = join(testDir, ".cursor", "commands", "subdir");
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "nested-command.md"),
        `---
description: Nested
---

Body content`,
      );

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "subdir/nested-command.md",
        validate: true,
      });

      expect(command.getRelativeFilePath()).toBe("subdir/nested-command.md");
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

    it("should trim whitespace from body", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      const fileContent = `---
description: Whitespace test
---


   Body with leading and trailing whitespace


`;

      await writeFileContent(join(commandsDir, "whitespace.md"), fileContent);

      const command = await CursorCommand.fromFile({
        baseDir: testDir,
        relativeFilePath: "whitespace.md",
        validate: true,
      });

      expect(command.getBody()).toBe("Body with leading and trailing whitespace");
    });

    it("should load from global path when global is true", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "global-test.md"),
        `---
description: Global command
---
Global command body`,
      );

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
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "local-test.md"),
        `---
description: Local command
---
Local command body`,
      );

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
    it("should return success for valid frontmatter", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "valid-command.md",
        frontmatter: { description: "Valid description" },
        body: "Valid body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty frontmatter", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "empty-fm.md",
        frontmatter: {},
        body: "Body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success when frontmatter is undefined", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: {} as any,
        body: "Body",
        validate: false,
      });

      (command as any).frontmatter = undefined;

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal instance for deletion", () => {
      const command = CursorCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "to-delete.md",
      });

      expect(command).toBeInstanceOf(CursorCommand);
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({});
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "empty-body.md",
        frontmatter: {},
        body: "",
        validate: true,
      });

      expect(command.getBody()).toBe("");
    });

    it("should handle special characters in content", () => {
      const specialContent =
        "Special characters: @#$%^&*()\nUnicode: 你好世界 🌍\nQuotes: \"Hello 'World'\"";

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "special-char.md",
        frontmatter: { description: "Special chars" },
        body: specialContent,
        validate: true,
      });

      expect(command.getBody()).toBe(specialContent);
      expect(command.getBody()).toContain("@#$%^&*()");
      expect(command.getBody()).toContain("你好世界 🌍");
      expect(command.getBody()).toContain("\"Hello 'World'\"");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "long-content.md",
        frontmatter: {},
        body: longContent,
        validate: true,
      });

      expect(command.getBody()).toBe(longContent);
      expect(command.getBody().length).toBe(10000);
    });

    it("should handle Windows-style line endings", () => {
      const windowsContent = "Line 1\r\nLine 2\r\nLine 3";

      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "windows-lines.md",
        frontmatter: {},
        body: windowsContent,
        validate: true,
      });

      expect(command.getBody()).toBe(windowsContent);
    });
  });

  describe("integration with base classes", () => {
    it("should properly inherit from ToolCommand", () => {
      const command = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test" },
        body: "Body",
        validate: true,
      });

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
        frontmatter: {},
        body: "Body",
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
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: undefined as any, description: "Test" },
        body: "Body",
        fileContent: "",
        validate: false,
      });

      const result = CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand);
      expect(result).toBe(true);
    });
  });

  describe("CursorCommandFrontmatterSchema", () => {
    it("should validate frontmatter with description", () => {
      const result = CursorCommandFrontmatterSchema.safeParse({ description: "Test" });
      expect(result.success).toBe(true);
    });

    it("should validate empty frontmatter", () => {
      const result = CursorCommandFrontmatterSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should validate frontmatter with handoffs", () => {
      const result = CursorCommandFrontmatterSchema.safeParse({
        description: "Test",
        handoffs: [
          { label: "Build Plan", agent: "planner", prompt: "Do it" },
          { label: "Clarify", agent: "clarifier", prompt: "Ask", send: true },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.handoffs).toHaveLength(2);
        expect(result.data.handoffs?.[1]?.send).toBe(true);
      }
    });

    it("should reject non-string description", () => {
      const result = CursorCommandFrontmatterSchema.safeParse({ description: 123 });
      expect(result.success).toBe(false);
    });

    it("should allow additional properties via looseObject", () => {
      const result = CursorCommandFrontmatterSchema.safeParse({
        description: "Test",
        unknownField: "should pass through",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("tool-specific field passthrough", () => {
    it("round-trip should preserve description + handoffs", () => {
      const original = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          targets: ["cursor"],
          description: "Roundtrip test",
          cursor: {
            handoffs: [
              { label: "Build Plan", agent: "planner.plan", prompt: "Plan this" },
              { label: "Clarify", agent: "planner.clarify", prompt: "Clarify", send: true },
            ],
          },
        },
        body: "Body content",
        fileContent: "",
      });

      const cursor = CursorCommand.fromRulesyncCommand({
        rulesyncCommand: original,
      });

      // Verify the cursor command has the right frontmatter
      expect(cursor.getFrontmatter()).toEqual({
        description: "Roundtrip test",
        handoffs: [
          { label: "Build Plan", agent: "planner.plan", prompt: "Plan this" },
          { label: "Clarify", agent: "planner.clarify", prompt: "Clarify", send: true },
        ],
      });

      const backToRulesync = cursor.toRulesyncCommand();

      expect(backToRulesync.getFrontmatter().description).toBe("Roundtrip test");
      expect(backToRulesync.getFrontmatter().cursor).toEqual({
        handoffs: [
          { label: "Build Plan", agent: "planner.plan", prompt: "Plan this" },
          { label: "Clarify", agent: "planner.clarify", prompt: "Clarify", send: true },
        ],
      });
    });

    it("round-trip should preserve description-only (no cursor section)", () => {
      const original = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "desc-only.md",
        frontmatter: { description: "Just a description" },
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = original.toRulesyncCommand();
      const back = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(back.getBody()).toBe("Body");
      expect(back.getFrontmatter()).toEqual({ description: "Just a description" });
    });

    it("round-trip should work for commands with no frontmatter", () => {
      const original = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "no-fm.md",
        frontmatter: {},
        body: "Plain body content",
        validate: true,
      });

      const rulesyncCommand = original.toRulesyncCommand();
      const back = CursorCommand.fromRulesyncCommand({
        baseDir: testDir,
        rulesyncCommand,
      });

      expect(back.getBody()).toBe("Plain body content");
    });

    it("unknown fields should pass through via looseObject", () => {
      const original = new CursorCommand({
        baseDir: testDir,
        relativeDirPath: ".cursor/commands",
        relativeFilePath: "unknown.md",
        frontmatter: {
          description: "Test",
          handoffs: [{ label: "Test", agent: "test" }],
          someNewField: "value",
        } as any,
        body: "Body",
        validate: true,
      });

      const rulesyncCommand = original.toRulesyncCommand();
      const fm = rulesyncCommand.getFrontmatter();

      // Both handoffs and someNewField should be in cursor section
      expect(fm.cursor).toEqual({
        handoffs: [{ label: "Test", agent: "test" }],
        someNewField: "value",
      });

      // Round-trip back
      const back = CursorCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      const backFm = back.getFrontmatter();
      expect(backFm.description).toBe("Test");
      expect(backFm.handoffs).toEqual([{ label: "Test", agent: "test" }]);
      expect((backFm as any).someNewField).toBe("value");
    });

    it("double round-trip should produce stable output", () => {
      const original = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "stable.md",
        frontmatter: {
          targets: ["*"],
          description: "Stable test",
          cursor: {
            handoffs: [{ label: "Plan", agent: "planner", prompt: "Plan", send: false }],
          },
        },
        body: "Stable body",
        fileContent: "",
      });

      // First round-trip
      const cursor1 = CursorCommand.fromRulesyncCommand({ rulesyncCommand: original });
      const rulesync1 = cursor1.toRulesyncCommand();

      // Second round-trip
      const cursor2 = CursorCommand.fromRulesyncCommand({ rulesyncCommand: rulesync1 });
      const rulesync2 = cursor2.toRulesyncCommand();

      // Output should be identical
      expect(rulesync2.getFrontmatter().description).toBe(rulesync1.getFrontmatter().description);
      expect(rulesync2.getFrontmatter().cursor).toEqual(rulesync1.getFrontmatter().cursor);
      expect(rulesync2.getBody()).toBe(rulesync1.getBody());
    });
  });

  describe("type definitions", () => {
    it("should work with ToolCommandFromFileParams", async () => {
      const commandsDir = join(testDir, ".cursor", "commands");
      await ensureDir(commandsDir);

      await writeFileContent(
        join(commandsDir, "type-test.md"),
        `---
description: Type test
---
Body`,
      );

      const params: ToolCommandFromFileParams = {
        baseDir: testDir,
        relativeFilePath: "type-test.md",
      };

      const command = await CursorCommand.fromFile(params);
      expect(command).toBeInstanceOf(CursorCommand);
    });

    it("should work with ToolCommandFromRulesyncCommandParams", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "type-test.md",
        frontmatter: { targets: ["*"], description: "Type test" },
        body: "Body",
        fileContent: "",
      });

      const params: ToolCommandFromRulesyncCommandParams = {
        baseDir: testDir,
        rulesyncCommand,
      };

      const command = CursorCommand.fromRulesyncCommand(params);
      expect(command).toBeInstanceOf(CursorCommand);
    });
  });
});
