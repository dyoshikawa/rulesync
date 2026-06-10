import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { AugmentcodeCommand } from "./augmentcode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("AugmentcodeCommand", () => {
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
    it("should create a valid AugmentcodeCommand instance", () => {
      const command = new AugmentcodeCommand({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(AugmentcodeCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new AugmentcodeCommand({
          outputRoot: testDir,
          relativeDirPath: join(".augment", "commands"),
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new AugmentcodeCommand({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(AugmentcodeCommand);
      expect(command.getBody()).toBe("This is a test command body");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new AugmentcodeCommand({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
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
    it("should return .augment/commands for project scope", () => {
      const paths = AugmentcodeCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".augment", "commands"));
    });

    it("should return the same relative path for global scope", () => {
      // Augment reads user commands from ~/.augment/commands/; the relative path is
      // identical to the project scope and only the resolved outputRoot differs.
      const paths = AugmentcodeCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".augment", "commands"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new AugmentcodeCommand({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test description" },
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand).toBeInstanceOf(RulesyncCommand);
      expect(rulesyncCommand.getRelativeFilePath()).toBe("test.md");
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test description",
      });
      expect(rulesyncCommand.getBody()).toBe("Test body");
    });

    it("should preserve extra fields in the augmentcode section", () => {
      const command = new AugmentcodeCommand({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test description",
          "argument-hint": "<file>",
          model: "gpt-5",
        } as any,
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test description",
        augmentcode: { "argument-hint": "<file>", model: "gpt-5" },
      });
    });

    it("should accept and validate the argument-hint and model frontmatter fields", () => {
      expect(
        () =>
          new AugmentcodeCommand({
            outputRoot: testDir,
            relativeDirPath: join(".augment", "commands"),
            relativeFilePath: "test.md",
            frontmatter: {
              description: "Test description",
              "argument-hint": "<file>",
              model: "gpt-5",
            },
            body: "Test body",
            validate: true,
          }),
      ).not.toThrow();

      expect(
        () =>
          new AugmentcodeCommand({
            outputRoot: testDir,
            relativeDirPath: join(".augment", "commands"),
            relativeFilePath: "test.md",
            frontmatter: { model: 123 as any },
            body: "Test body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create AugmentcodeCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["augmentcode"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = AugmentcodeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(AugmentcodeCommand);
      expect(command.getRelativeDirPath()).toBe(join(".augment", "commands"));
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
      expect(command.getBody()).toBe("Test body");
    });

    it("should merge augmentcode-specific fields from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["augmentcode"],
          description: "Test description",
          augmentcode: { "argument-hint": "<file>" },
        },
        body: "Test body",
      });

      const command = AugmentcodeCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Test description",
        "argument-hint": "<file>",
      });
    });
  });

  describe("fromFile", () => {
    it("should load AugmentcodeCommand from file", async () => {
      const relativeDirPath = join(".augment", "commands");
      const relativeFilePath = "test-command.md";
      const body = "Test body";
      const frontmatter = { description: "Test description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await AugmentcodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command).toBeInstanceOf(AugmentcodeCommand);
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should throw error if frontmatter in file is invalid", async () => {
      const relativeDirPath = join(".augment", "commands");
      const relativeFilePath = "invalid-command.md";
      const fileContent = stringifyFrontmatter("Body", { description: 123 as any });

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      await expect(
        AugmentcodeCommand.fromFile({
          outputRoot: testDir,
          relativeFilePath,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true if targets includes *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
      });

      expect(AugmentcodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true if targets includes augmentcode", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["augmentcode"], description: "Test" },
        body: "Body",
      });

      expect(AugmentcodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false if targets does not include augmentcode or *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/commands",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["cursor"], description: "Test" },
        body: "Body",
      });

      expect(AugmentcodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal AugmentcodeCommand for deletion", () => {
      const command = AugmentcodeCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".augment", "commands"),
        relativeFilePath: "test.md",
      });

      expect(command).toBeInstanceOf(AugmentcodeCommand);
      expect(command.getRelativeDirPath()).toBe(join(".augment", "commands"));
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({ description: "" });
    });
  });
});
