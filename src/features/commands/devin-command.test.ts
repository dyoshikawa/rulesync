import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { DevinCommand } from "./devin-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("DevinCommand", () => {
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
    it("should create a valid DevinCommand instance", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new DevinCommand({
          outputRoot: testDir,
          relativeDirPath: join(".devin", "workflows"),
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getBody()).toBe("This is a test command body");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
        relativeFilePath: "test.md",
        frontmatter,
        body: "Command body",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
    it("should return .devin/workflows as relativeDirPath", () => {
      const paths = DevinCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".devin", "workflows"));
    });

    it("should return .codeium/windsurf/global_workflows as relativeDirPath for global mode", () => {
      const paths = DevinCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".codeium", "windsurf", "global_workflows"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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

    it("should preserve extra fields in devin section", () => {
      const command = new DevinCommand({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
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
        devin: { extra: "field" },
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create DevinCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["devin"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = DevinCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getRelativeDirPath()).toBe(join(".devin", "workflows"));
      expect(command.getRelativeFilePath()).toBe("test-command.md");
      expect(command.getFrontmatter()).toEqual({ description: "Test description" });
      expect(command.getBody()).toBe("Test body");
    });

    it("should use global path when global is true", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["devin"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = DevinCommand.fromRulesyncCommand({
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "global_workflows"));
    });

    it("should merge devin-specific fields from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["devin"],
          description: "Test description",
          devin: { extra: "field" },
        },
        body: "Test body",
      });

      const command = DevinCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Test description",
        extra: "field",
      });
    });
  });

  describe("fromFile", () => {
    it("should load DevinCommand from file", async () => {
      const relativeDirPath = join(".devin", "workflows");
      const relativeFilePath = "test-command.md";
      const body = "Test body";
      const frontmatter = { description: "Test description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await DevinCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should load DevinCommand from global file", async () => {
      const relativeDirPath = join(".codeium", "windsurf", "global_workflows");
      const relativeFilePath = "global-command.md";
      const body = "Global body";
      const frontmatter = { description: "Global description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await DevinCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
        global: true,
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "global_workflows"));
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should throw error if frontmatter in file is invalid", async () => {
      const relativeDirPath = join(".devin", "workflows");
      const relativeFilePath = "invalid-command.md";
      const fileContent = stringifyFrontmatter("Body", { description: 123 as any });

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      await expect(
        DevinCommand.fromFile({
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
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["*"], description: "Test" },
        body: "Body",
      });

      expect(DevinCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true if targets includes devin", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["devin"], description: "Test" },
        body: "Body",
      });

      expect(DevinCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false if targets does not include devin or *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["other-tool"] as any, description: "Test" },
        body: "Body",
      });

      expect(DevinCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
    });

    it("should return true if targets is undefined", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: undefined, description: "Test" } as any,
        body: "Body",
      });

      expect(DevinCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal DevinCommand for deletion", () => {
      const command = DevinCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".devin", "workflows"),
        relativeFilePath: "test.md",
      });

      expect(command).toBeInstanceOf(DevinCommand);
      expect(command.getRelativeDirPath()).toBe(join(".devin", "workflows"));
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({ description: "" });
    });
  });
});
