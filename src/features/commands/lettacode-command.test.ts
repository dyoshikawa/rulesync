import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { LettacodeCommand } from "./lettacode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("LettacodeCommand", () => {
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

  const createRulesyncCommand = (
    frontmatter: ConstructorParameters<typeof RulesyncCommand>[0]["frontmatter"],
    relativeFilePath = "review.md",
  ) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter,
      body: "Review $ARGUMENTS and focus on $1.",
      fileContent: "",
    });

  describe("getSettablePaths", () => {
    it("uses .commands at project scope and .letta/commands at global scope", () => {
      expect(LettacodeCommand.getSettablePaths()).toEqual({ relativeDirPath: ".commands" });
      expect(LettacodeCommand.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".letta", "commands"),
      });
    });
  });

  describe("fromRulesyncCommand", () => {
    it("writes description and the lettacode argument-hint", () => {
      const command = LettacodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: createRulesyncCommand({
          targets: ["*"],
          description: "Review code",
          lettacode: { "argument-hint": "[file]" },
        }),
      });

      expect(command.getRelativeDirPath()).toBe(".commands");
      expect(command.getRelativeFilePath()).toBe("review.md");
      expect(command.getFrontmatter()).toEqual({
        description: "Review code",
        "argument-hint": "[file]",
      });
      expect(command.getFileContent()).toContain("argument-hint: '[file]'");
      expect(command.getFileContent()).toContain("Review $ARGUMENTS and focus on $1.");
    });

    it("writes into .letta/commands at global scope and keeps subdirectories", () => {
      const command = LettacodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: createRulesyncCommand({ description: "Test" }, join("git", "commit.md")),
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".letta", "commands"));
      expect(command.getRelativeFilePath()).toBe(join("git", "commit.md"));
    });

    it("omits description when the rulesync command has none", () => {
      const command = LettacodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: createRulesyncCommand({ targets: ["*"] }),
      });

      expect(command.getFrontmatter()).toEqual({});
    });

    it("drops lettacode fields Letta Code does not read, with a warning", () => {
      const logger = createMockLogger();
      const command = LettacodeCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: createRulesyncCommand({
          description: "Review code",
          lettacode: { "argument-hint": "[file]", "allowed-tools": "Bash", model: "x" },
        }),
        logger,
      });

      expect(command.getFrontmatter()).toEqual({
        description: "Review code",
        "argument-hint": "[file]",
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("lettacode.allowed-tools"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("lettacode.model"));
    });
  });

  describe("fromFile / toRulesyncCommand", () => {
    it("imports a project command and keeps Letta-specific fields in the lettacode section", async () => {
      await writeFileContent(
        join(testDir, ".commands", "frontend", "test.md"),
        "---\ndescription: Run tests\nargument-hint: '[pattern]'\n---\nRun tests for $ARGUMENTS\n",
      );

      const command = await LettacodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: join("frontend", "test.md"),
      });
      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getRelativeFilePath()).toBe(join("frontend", "test.md"));
      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Run tests",
        lettacode: { "argument-hint": "[pattern]" },
      });
      expect(rulesyncCommand.getBody()).toBe("Run tests for $ARGUMENTS");
    });

    it("imports a global command from .letta/commands", async () => {
      await writeFileContent(join(testDir, ".letta", "commands", "hello.md"), "Say hello\n");

      const command = await LettacodeCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "hello.md",
        global: true,
      });

      expect(command.getFilePath()).toBe(join(testDir, ".letta", "commands", "hello.md"));
      expect(command.toRulesyncCommand().getBody()).toBe("Say hello");
    });

    it("rejects invalid frontmatter", async () => {
      await writeFileContent(
        join(testDir, ".commands", "bad.md"),
        "---\ndescription: 123\n---\nBody\n",
      );

      await expect(
        LettacodeCommand.fromFile({ outputRoot: testDir, relativeFilePath: "bad.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("forDeletion", () => {
    it("never marks a project-scope .commands file deletable", () => {
      const command = LettacodeCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".commands",
        relativeFilePath: "stale.md",
      });

      expect(command.isDeletable()).toBe(false);
    });

    it("marks a global .letta/commands file deletable", () => {
      const command = LettacodeCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".letta", "commands"),
        relativeFilePath: "stale.md",
        global: true,
      });

      expect(command.isDeletable()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("honors the targets field", () => {
      expect(
        LettacodeCommand.isTargetedByRulesyncCommand(createRulesyncCommand({ targets: ["*"] })),
      ).toBe(true);
      expect(
        LettacodeCommand.isTargetedByRulesyncCommand(
          createRulesyncCommand({ targets: ["lettacode"] }),
        ),
      ).toBe(true);
      expect(
        LettacodeCommand.isTargetedByRulesyncCommand(
          createRulesyncCommand({ targets: ["claudecode"] }),
        ),
      ).toBe(false);
    });
  });
});
