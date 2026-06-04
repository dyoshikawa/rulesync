import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { WindsurfCommand } from "./windsurf-command.js";

describe("WindsurfCommand", () => {
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
    it("should create a valid WindsurfCommand instance", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command" },
        body: "This is a test command body",
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({ description: "Test command" });
    });

    it("should validate frontmatter during construction by default", () => {
      expect(() => {
        new WindsurfCommand({
          outputRoot: testDir,
          relativeDirPath: join(".windsurf", "workflows"),
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as any },
          body: "This is a test command body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as any },
        body: "This is a test command body",
        validate: false,
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getBody()).toBe("This is a test command body");
    });

    it("should generate correct file content with frontmatter", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
        relativeFilePath: "test.md",
        frontmatter,
        body: "Command body",
      });

      expect(command.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
    it("should return .windsurf/workflows as relativeDirPath", () => {
      const paths = WindsurfCommand.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".windsurf", "workflows"));
    });

    it("should return .codeium/windsurf/global_workflows as relativeDirPath for global mode", () => {
      const paths = WindsurfCommand.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".codeium", "windsurf", "global_workflows"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should convert to RulesyncCommand correctly", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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

    it("should preserve extra fields in windsurf section", () => {
      const command = new WindsurfCommand({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
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
        windsurf: { extra: "field" },
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should create WindsurfCommand from RulesyncCommand", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["windsurf"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = WindsurfCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getRelativeDirPath()).toBe(join(".windsurf", "workflows"));
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
          targets: ["windsurf"],
          description: "Test description",
        },
        body: "Test body",
      });

      const command = WindsurfCommand.fromRulesyncCommand({
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "global_workflows"));
    });

    it("should merge windsurf-specific fields from rulesync frontmatter", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test-command.md",
        fileContent: "",
        frontmatter: {
          targets: ["windsurf"],
          description: "Test description",
          windsurf: { extra: "field" },
        },
        body: "Test body",
      });

      const command = WindsurfCommand.fromRulesyncCommand({
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Test description",
        extra: "field",
      });
    });
  });

  describe("fromFile", () => {
    it("should load WindsurfCommand from file", async () => {
      const relativeDirPath = join(".windsurf", "workflows");
      const relativeFilePath = "test-command.md";
      const body = "Test body";
      const frontmatter = { description: "Test description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await WindsurfCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should load WindsurfCommand from global file", async () => {
      const relativeDirPath = join(".codeium", "windsurf", "global_workflows");
      const relativeFilePath = "global-command.md";
      const body = "Global body";
      const frontmatter = { description: "Global description" };
      const fileContent = stringifyFrontmatter(body, frontmatter);

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      const command = await WindsurfCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath,
        global: true,
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "global_workflows"));
      expect(command.getBody()).toBe(body);
      expect(command.getFrontmatter()).toEqual(frontmatter);
    });

    it("should throw error if frontmatter in file is invalid", async () => {
      const relativeDirPath = join(".windsurf", "workflows");
      const relativeFilePath = "invalid-command.md";
      const fileContent = stringifyFrontmatter("Body", { description: 123 as any });

      await ensureDir(join(testDir, relativeDirPath));
      await writeFileContent(join(testDir, relativeDirPath, relativeFilePath), fileContent);

      await expect(
        WindsurfCommand.fromFile({
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

      expect(WindsurfCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return true if targets includes windsurf", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["windsurf"], description: "Test" },
        body: "Body",
      });

      expect(WindsurfCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });

    it("should return false if targets does not include windsurf or *", () => {
      const rulesyncCommand = new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/command",
        relativeFilePath: "test.md",
        fileContent: "",
        frontmatter: { targets: ["other-tool"] as any, description: "Test" },
        body: "Body",
      });

      expect(WindsurfCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(false);
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

      expect(WindsurfCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(true);
    });
  });

  describe("forDeletion", () => {
    it("should create a minimal WindsurfCommand for deletion", () => {
      const command = WindsurfCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "workflows"),
        relativeFilePath: "test.md",
      });

      expect(command).toBeInstanceOf(WindsurfCommand);
      expect(command.getRelativeDirPath()).toBe(join(".windsurf", "workflows"));
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getBody()).toBe("");
      expect(command.getFrontmatter()).toEqual({ description: "" });
    });
  });
});
