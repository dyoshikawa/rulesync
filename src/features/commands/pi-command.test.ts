import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { PiCommand, PiCommandFrontmatterSchema } from "./pi-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("PiCommand", () => {
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

  describe("getSettablePaths", () => {
    it("should return project prompts directory by default", () => {
      const paths = PiCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".pi", "prompts"));
    });

    it("should return global prompts directory when global is true", () => {
      const paths = PiCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".pi", "agent", "prompts"));
    });
  });

  describe("constructor", () => {
    it("should create a PiCommand with frontmatter", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test" },
        body: "Body",
      });

      expect(command).toBeInstanceOf(PiCommand);
      expect(command.getBody()).toBe("Body");
      expect(command.getFrontmatter()).toEqual({ description: "Test" });
    });

    it("should emit body-only content when frontmatter is empty", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Body only",
      });

      expect(command.getFileContent()).toBe("Body only");
    });

    it("should emit frontmatter block when frontmatter has fields", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test", "argument-hint": "[args]" },
        body: "Body",
      });

      const content = command.getFileContent();
      expect(content).toContain("---");
      expect(content).toContain("description: Test");
      expect(content).toContain("argument-hint");
    });

    it("should throw when validating invalid frontmatter", () => {
      expect(() => {
        new PiCommand({
          outputRoot: testDir,
          relativeDirPath: join(".pi", "prompts"),
          relativeFilePath: "test.md",
          frontmatter: { description: 42 as any },
          body: "Body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });
  });

  describe("validate", () => {
    it("should succeed for valid frontmatter", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid" },
        body: "Body",
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail for invalid frontmatter when validation deferred", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "Body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("fromFile", () => {
    it("should load a command from the project prompts directory", async () => {
      const promptsDir = join(testDir, ".pi", "prompts");
      await ensureDir(promptsDir);
      await writeFileContent(
        join(promptsDir, "test.md"),
        `---
description: Test command
argument-hint: "[name]"
---
Body`,
      );

      const command = await PiCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test.md",
      });

      expect(command.getBody()).toBe("Body");
      expect(command.getFrontmatter()).toEqual({
        description: "Test command",
        "argument-hint": "[name]",
      });
      expect(command.getRelativeDirPath()).toBe(join(".pi", "prompts"));
    });

    it("should load a command from the global prompts directory", async () => {
      const promptsDir = join(testDir, ".pi", "agent", "prompts");
      await ensureDir(promptsDir);
      await writeFileContent(
        join(promptsDir, "test.md"),
        `---
description: Global command
---
Body`,
      );

      const command = await PiCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "test.md",
        global: true,
      });

      expect(command.getBody()).toBe("Body");
      expect(command.getRelativeDirPath()).toBe(join(".pi", "agent", "prompts"));
    });

    it("should throw on invalid frontmatter", async () => {
      const promptsDir = join(testDir, ".pi", "prompts");
      await ensureDir(promptsDir);
      await writeFileContent(
        join(promptsDir, "bad.md"),
        `---
description: 123
---
Body`,
      );

      await expect(
        PiCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath: "bad.md",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should copy description from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          description: "Desc",
        },
        body: "Body",
        fileContent: "",
      });

      const command = PiCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({ description: "Desc" });
      expect(command.getBody()).toBe("Body");
      expect(command.getRelativeDirPath()).toBe(join(".pi", "prompts"));
    });

    it("should propagate argument-hint from rulesync pi section", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["pi"],
          description: "Desc",
          pi: {
            "argument-hint": "[message]",
          },
        },
        body: "Body",
        fileContent: "",
      });

      const command = PiCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Desc",
        "argument-hint": "[message]",
      });
    });

    it("should emit to the global path when global is true", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["pi"],
          description: "Desc",
        },
        body: "Body",
        fileContent: "",
      });

      const command = PiCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".pi", "agent", "prompts"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should produce rulesync frontmatter with wildcard targets", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Desc" },
        body: "Body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter().targets).toEqual(["*"]);
      expect(rulesyncCommand.getFrontmatter().description).toBe("Desc");
      expect(rulesyncCommand.getFrontmatter().pi).toBeUndefined();
    });

    it("should preserve argument-hint in the pi section on round-trip", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Desc", "argument-hint": "[message]" },
        body: "Body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter().pi).toEqual({
        "argument-hint": "[message]",
      });
    });

    it("should preserve arbitrary extra fields in the pi section", () => {
      const command = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Desc",
          "argument-hint": "[arg]",
          "custom-field": "x",
        },
        body: "Body",
        validate: false,
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter().pi).toEqual({
        "argument-hint": "[arg]",
        "custom-field": "x",
      });
    });

    it("should round-trip argument-hint through pi section", () => {
      const original = new PiCommand({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "roundtrip.md",
        frontmatter: { description: "Desc", "argument-hint": "[arg]" },
        body: "Body",
      });

      const rulesyncCommand = original.toRulesyncCommand();

      // Re-parse the serialized file content to guard against regressions in
      // frontmatter serialization (the in-memory getter alone could miss them).
      const { frontmatter: serialized } = parseFrontmatter(rulesyncCommand.getFileContent());
      expect(serialized).toMatchObject({
        targets: ["*"],
        description: "Desc",
        pi: { "argument-hint": "[arg]" },
      });

      const restored = PiCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(restored.getFrontmatter()).toEqual({
        description: "Desc",
        "argument-hint": "[arg]",
      });
    });
  });

  describe("forDeletion", () => {
    it("should create a deletion stub", () => {
      const command = PiCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".pi", "prompts"),
        relativeFilePath: "to-delete.md",
      });

      expect(command).toBeInstanceOf(PiCommand);
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({});
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true for pi target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["pi"], description: "D" },
        body: "Body",
        fileContent: "",
      });

      expect(PiCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], description: "D" },
        body: "Body",
        fileContent: "",
      });

      expect(PiCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false for unrelated targets", () => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], description: "D" },
        body: "Body",
        fileContent: "",
      });

      expect(PiCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("PiCommandFrontmatterSchema", () => {
    it("should accept empty frontmatter", () => {
      const result = PiCommandFrontmatterSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept description and argument-hint", () => {
      const result = PiCommandFrontmatterSchema.safeParse({
        description: "Desc",
        "argument-hint": "[a]",
      });
      expect(result.success).toBe(true);
    });

    it("should accept unknown keys via looseObject", () => {
      const result = PiCommandFrontmatterSchema.safeParse({
        description: "Desc",
        customField: "value",
      });
      expect(result.success).toBe(true);
    });

    it("should reject non-string description", () => {
      const result = PiCommandFrontmatterSchema.safeParse({ description: 42 });
      expect(result.success).toBe(false);
    });
  });
});
