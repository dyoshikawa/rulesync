import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GROKCLI_COMMANDS_DIR_PATH } from "../../constants/grokcli-paths.js";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { GrokcliCommand } from "./grokcli-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const commandNamed = (name: string): RulesyncCommand =>
  new RulesyncCommand({
    fileContent: "",
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], description: "d" },
    body: "b",
  });

describe("GrokcliCommand", () => {
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
    it("should use .grok/commands in both scopes", () => {
      expect(GrokcliCommand.getSettablePaths()).toEqual({
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
      });
      expect(GrokcliCommand.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
      });
    });
  });

  describe("constructor", () => {
    it("should create a valid instance and render frontmatter", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: "Test command", "argument-hint": "<file>" },
        body: "This is a test command body",
      });

      expect(command.getBody()).toBe("This is a test command body");
      expect(command.getFrontmatter()).toEqual({
        description: "Test command",
        "argument-hint": "<file>",
      });
      expect(command.getFileContent()).toContain("argument-hint: <file>");
    });

    it("should reject a non-string description when validating", () => {
      expect(() => {
        new GrokcliCommand({
          outputRoot: testDir,
          relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
          relativeFilePath: "test.md",
          frontmatter: { description: 123 as unknown as string },
          body: "body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { description: 123 as unknown as string },
        body: "body",
        validate: false,
      });

      expect(command).toBeInstanceOf(GrokcliCommand);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should map description and the grokcli section", () => {
      const rulesyncCommand = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          targets: ["*"],
          description: "Review the diff",
          grokcli: {
            "argument-hint": "<path>",
            "user-invocable": false,
            "disable-model-invocation": true,
          },
        },
        body: "Review $ARGUMENTS",
      });

      const command = GrokcliCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(command.getRelativeDirPath()).toBe(GROKCLI_COMMANDS_DIR_PATH);
      expect(command.getRelativeFilePath()).toBe("review.md");
      expect(command.getFrontmatter()).toEqual({
        description: "Review the diff",
        "argument-hint": "<path>",
        "user-invocable": false,
        "disable-model-invocation": true,
      });
      expect(command.getBody()).toBe("Review $ARGUMENTS");
    });

    it("should flatten a nested command onto its basename", () => {
      const rulesyncCommand = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: join("git", "commit.md"),
        frontmatter: { targets: ["*"], description: "d" },
        body: "b",
      });

      // Grok's scan is flat, so the processor is configured with
      // `supportsSubdirectory: false` and hands the adapter a flattened path.
      const command = GrokcliCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: rulesyncCommand.withRelativeFilePath("commit.md"),
      });

      expect(command.getRelativeFilePath()).toBe("commit.md");
      expect(command.getRelativeDirPath()).toBe(GROKCLI_COMMANDS_DIR_PATH);
    });

    it("should use the same relative dir in global scope", () => {
      const rulesyncCommand = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: { targets: ["*"], description: "d" },
        body: "b",
      });

      const command = GrokcliCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(GROKCLI_COMMANDS_DIR_PATH);
    });

    it("should let the grokcli section override the shared description", () => {
      const rulesyncCommand = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          targets: ["*"],
          description: "shared",
          grokcli: { description: "grok-specific" },
        },
        body: "body",
      });

      const command = GrokcliCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand,
      });

      expect(command.getFrontmatter()).toEqual({ description: "grok-specific" });
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should respect the targets list", () => {
      const targeted = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["grokcli"], description: "d" },
        body: "b",
      });
      const notTargeted = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { targets: ["claudecode"], description: "d" },
        body: "b",
      });

      const wildcard = new RulesyncCommand({
        fileContent: "",
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "c.md",
        frontmatter: { targets: ["*"], description: "d" },
        body: "b",
      });

      expect(GrokcliCommand.isTargetedByRulesyncCommand(targeted)).toBe(true);
      expect(GrokcliCommand.isTargetedByRulesyncCommand(notTargeted)).toBe(false);
      expect(GrokcliCommand.isTargetedByRulesyncCommand(wildcard)).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should read a command file from .grok/commands", async () => {
      await ensureDir(join(testDir, GROKCLI_COMMANDS_DIR_PATH));
      await writeFileContent(
        join(testDir, GROKCLI_COMMANDS_DIR_PATH, "deploy.md"),
        [
          "---",
          "description: Deploy the app",
          "argument-hint: <env>",
          "---",
          "",
          "Deploy to $1",
        ].join("\n"),
      );

      const command = await GrokcliCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "deploy.md",
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Deploy the app",
        "argument-hint": "<env>",
      });
      expect(command.getBody()).toBe("Deploy to $1");
    });

    it("should throw when description is not a string", async () => {
      await ensureDir(join(testDir, GROKCLI_COMMANDS_DIR_PATH));
      await writeFileContent(
        join(testDir, GROKCLI_COMMANDS_DIR_PATH, "bad-description.md"),
        ["---", "description: 1", "---", "", "body"].join("\n"),
      );

      await expect(
        GrokcliCommand.fromFile({ outputRoot: testDir, relativeFilePath: "bad-description.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw when user-invocable is not a boolean", async () => {
      await ensureDir(join(testDir, GROKCLI_COMMANDS_DIR_PATH));
      await writeFileContent(
        join(testDir, GROKCLI_COMMANDS_DIR_PATH, "bad-flag.md"),
        ["---", "description: ok", 'user-invocable: "yes"', "---", "", "body"].join("\n"),
      );

      await expect(
        GrokcliCommand.fromFile({ outputRoot: testDir, relativeFilePath: "bad-flag.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should preserve unknown frontmatter keys", async () => {
      await ensureDir(join(testDir, GROKCLI_COMMANDS_DIR_PATH));
      await writeFileContent(
        join(testDir, GROKCLI_COMMANDS_DIR_PATH, "extra.md"),
        ["---", "description: ok", "model: grok-4", "---", "", "body"].join("\n"),
      );

      const command = await GrokcliCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "extra.md",
      });

      expect(command.getFrontmatter()).toEqual({ description: "ok", model: "grok-4" });
    });
  });

  describe("validate", () => {
    it("should succeed for valid frontmatter", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "ok.md",
        frontmatter: { description: "ok" },
        body: "body",
      });

      expect(command.validate()).toEqual({ success: true, error: null });
    });

    it("should fail for frontmatter that skipped construction-time validation", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "bad.md",
        frontmatter: { description: 1 as unknown as string },
        body: "body",
        validate: false,
      });

      const result = command.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/Invalid frontmatter/);
    });
  });

  describe("validateRulesyncCommands", () => {
    it("should warn when a skill shadows a same-named command", async () => {
      await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review"));
      await writeFileContent(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "review", "SKILL.md"),
        ["---", "name: review", "description: d", "---", "", "body"].join("\n"),
      );
      const logger = { warn: vi.fn() };

      await GrokcliCommand.validateRulesyncCommands({
        inputRoot: testDir,
        rulesyncCommands: [commandNamed("review")],
        logger: logger as unknown as Logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("review"));
    });

    it("should stay quiet when no skill matches a command name", async () => {
      await ensureDir(join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "deploy"));
      await writeFileContent(
        join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "deploy", "SKILL.md"),
        ["---", "name: deploy", "description: d", "---", "", "body"].join("\n"),
      );
      const logger = { warn: vi.fn() };

      await GrokcliCommand.validateRulesyncCommands({
        inputRoot: testDir,
        rulesyncCommands: [commandNamed("review")],
        logger: logger as unknown as Logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("toRulesyncCommand", () => {
    it("should keep description shared and push Grok-only keys into the grokcli section", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          description: "Review the diff",
          "argument-hint": "<path>",
          "user-invocable": false,
        },
        body: "Review $ARGUMENTS",
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review the diff",
        grokcli: { "argument-hint": "<path>", "user-invocable": false },
      });
      expect(rulesyncCommand.getRelativeFilePath()).toBe("review.md");
    });

    it("should omit the grokcli section when there are no Grok-only keys", () => {
      const command = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "plain.md",
        frontmatter: { description: "Plain" },
        body: "body",
      });

      expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Plain",
      });
    });

    it("should round-trip through rulesync without losing fields", () => {
      const original = new GrokcliCommand({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          description: "Review the diff",
          "argument-hint": "<path>",
          "disable-model-invocation": true,
        },
        body: "Review $ARGUMENTS",
      });

      const roundTripped = GrokcliCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: original.toRulesyncCommand(),
      });

      expect(roundTripped.getFrontmatter()).toEqual(original.getFrontmatter());
      expect(roundTripped.getBody()).toBe(original.getBody());
    });
  });

  describe("forDeletion", () => {
    it("should build an empty command for deletion", () => {
      const command = GrokcliCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: GROKCLI_COMMANDS_DIR_PATH,
        relativeFilePath: "gone.md",
      });

      expect(command.getBody()).toBe("");
      expect(command.isDeletable()).toBe(true);
    });
  });
});
