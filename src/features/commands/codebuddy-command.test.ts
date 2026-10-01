import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuddyCommand } from "./codebuddy-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const commandsDir = join(".codebuddy", "commands");

const buildCommand = (
  targets: RulesyncTargets,
  extra: Record<string, unknown> = {},
  relativeFilePath = "test.md",
): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets, description: "Test", ...extra },
    body: "Body",
    fileContent: "",
  });

describe("CodebuddyCommand", () => {
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
    it("should return .codebuddy/commands for both scopes", () => {
      expect(CodebuddyCommand.getSettablePaths().relativeDirPath).toBe(commandsDir);
      expect(CodebuddyCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(commandsDir);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should write description and the codebuddy section, keeping subdirectories", () => {
      const command = CodebuddyCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(
          ["*"],
          {
            codebuddy: {
              "argument-hint": "[test-file]",
              "allowed-tools": "Bash(npm run:*)",
              model: "gemini-3.1-pro",
            },
          },
          join("frontend", "test.md"),
        ),
      }) as CodebuddyCommand;

      expect(command.getRelativeDirPath()).toBe(commandsDir);
      expect(command.getRelativeFilePath()).toBe(join("frontend", "test.md"));
      expect(command.getFrontmatter()).toEqual({
        description: "Test",
        "argument-hint": "[test-file]",
        "allowed-tools": "Bash(npm run:*)",
        model: "gemini-3.1-pro",
      });
      expect(command.getBody()).toBe("Body");
    });

    it("should keep the canonical description over a same-named codebuddy key", () => {
      const command = CodebuddyCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], {
          codebuddy: { description: "Overridden", "argument-hint": "[test-file]" },
        }),
      }) as CodebuddyCommand;

      expect(command.getFrontmatter()).toEqual({
        description: "Test",
        "argument-hint": "[test-file]",
      });
      expect(command.getFileContent()).not.toContain("Overridden");
    });
  });

  describe("fromFile and toRulesyncCommand", () => {
    it("should round-trip CodeBuddy-specific keys through the codebuddy section", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "review-pr.md"),
        '---\ndescription: Code review\nargument-hint: "[pr-number]"\n---\nReview PR #$1.\n',
      );

      const command = await CodebuddyCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "review-pr.md",
      });
      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Code review",
        codebuddy: { "argument-hint": "[pr-number]" },
      });
      expect(rulesyncCommand.getBody()).toBe("Review PR #$1.");
    });

    it("should reject a non-string description", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "bad.md"),
        "---\ndescription: 42\n---\nBody\n",
      );

      await expect(
        CodebuddyCommand.fromFile({ outputRoot: testDir, relativeFilePath: "bad.md" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should match wildcard and codebuddy targets only", () => {
      expect(CodebuddyCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
      expect(CodebuddyCommand.isTargetedByRulesyncCommand(buildCommand(["codebuddy"]))).toBe(true);
      expect(CodebuddyCommand.isTargetedByRulesyncCommand(buildCommand(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should build an unvalidated placeholder", () => {
      const command = CodebuddyCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "old.md",
      });

      expect(command.getRelativeFilePath()).toBe("old.md");
    });
  });
});
