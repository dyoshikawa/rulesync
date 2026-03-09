import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { JunieCommand } from "./junie-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("JunieCommand", () => {
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
    it("should create a valid JunieCommand instance", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new JunieCommand({
          baseDir: testDir,
          relativeDirPath: ".junie/commands",
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getBody()).toBe("This is a test command body");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
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

  describe("getBody", () => {
    it("should return the command body", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "Command body content",
      });

      expect(command.getBody()).toBe("Command body content");
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter", () => {
      const frontmatter = { description: "Test command description" };
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Command body",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Valid description" },
        body: "Body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "Body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Invalid frontmatter/);
    });

    it("should return success for frontmatter with extra fields", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: { description: "Test", extra: "field" } as any,
        body: "Body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths", () => {
      const paths = JunieCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".junie", "commands"));
    });

    it("should return the same paths even if global is true", () => {
      const paths = JunieCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".junie", "commands"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
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

    it("should preserve extra fields in junie section", () => {
      const command = new JunieCommand({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
        frontmatter: {
          description: "Test description",
          extra: "field",
        } as any,
        body: "Test body",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Test description",
        junie: { extra: "field" },
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create JunieCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["junie"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = JunieCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getRelativeDirPath()).toBe(join(".junie", "commands"));
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
      expect(command.getBody()).toBe("Test body");
    });

    it("should merge junie-specific fields from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["junie"],
          description: "Test description",
          junie: { extra: "field" },
        },
        body: "Test body",
      });

      const command = JunieCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Test description",
        extra: "field",
      });
    });
  });

  describe("fromFile", () => {
    it("should load JunieCommand from file", async () => {
      const relativeDirPath = join(".junie", "commands");
      const relativeFilePath = "test-command.md";
      const body = "Test body";
      const frontmatter = { description: "Test description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await JunieCommand.fromFile({
        baseDir: testDir,
        relativeFilePath,
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should throw error if frontmatter in file is invalid", async () => {
      const relativeDirPath = join(".junie", "commands");
      const relativeFilePath = "invalid-command.md";
      const fileContent = stringifyFrontmatter("Body", { description: 123 as any });

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      await expect(
        JunieCommand.fromFile({
          baseDir: testDir,
          relativeFilePath,
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should return true if targets includes *", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
      });

      expect(JunieCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true if targets includes junie", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["junie"], description: "Test" },
        body: "Body",
      });

      expect(JunieCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false if targets does not include junie or *", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["other-tool"] as any, description: "Test" },
        body: "Body",
      });

      expect(JunieCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });

    it("should return true if targets is undefined", () => {
      const rulesyncCommand = new RulesyncCommand({
        baseDir: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: undefined, description: "Test" } as any,
        body: "Body",
      });

      expect(JunieCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal JunieCommand for deletion", () => {
      const command = JunieCommand.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".junie/commands",
        relativeFilePath: "test.md",
      });

      expect(command).toBeInstanceOf(JunieCommand);
      expect(command.getRelativeDirPath()).toBe(".junie/commands");
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({ description: "" });
    });
  });
});
