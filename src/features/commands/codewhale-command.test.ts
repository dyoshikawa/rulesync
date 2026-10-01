import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleCommand } from "./codewhale-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

const commandsDir = join(".codewhale", "commands");

const buildCommand = (
  targets: RulesyncTargets,
  extra: Record<string, unknown> = {},
  body = "Body",
): RulesyncCommand =>
  new RulesyncCommand({
    relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: { targets, description: "Test", ...extra },
    body,
    fileContent: "",
  });

describe("CodewhaleCommand", () => {
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
    it("should return .codewhale/commands for both scopes", () => {
      expect(CodewhaleCommand.getSettablePaths().relativeDirPath).toBe(commandsDir);
      expect(CodewhaleCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(commandsDir);
    });
  });

  describe("fromRulesyncCommand", () => {
    it("should write description and the codewhale section on single lines", () => {
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(
          ["*"],
          {
            description: "A long description\nthat spans two lines",
            codewhale: {
              usage: "/test <path>",
              "allowed-tools": ["read_file", "grep_files"],
              aliases: ["t", "tst"],
              hidden: false,
            },
          },
          "Run $ARGUMENTS",
        ),
      });

      expect(command.getRelativeDirPath()).toBe(commandsDir);
      expect(command.getRelativeFilePath()).toBe("test.md");
      expect(command.getFileContent()).toBe(
        [
          "---",
          "description: A long description that spans two lines",
          "usage: /test <path>",
          "allowed-tools: read_file, grep_files",
          "aliases: t, tst",
          "hidden: false",
          "---",
          "Run $ARGUMENTS",
          "",
        ].join("\n"),
      );
    });

    it("should keep the canonical description and drop nested values with a warning", () => {
      const logger = createMockLogger();
      const command = CodewhaleCommand.fromRulesyncCommand({
        outputRoot: testDir,
        rulesyncCommand: buildCommand(["*"], {
          codewhale: { description: "Ignored", name: "renamed", nested: { a: 1 } },
        }),
        logger,
      });

      expect(command.getFrontmatter()).toEqual({ description: "Test", name: "renamed" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("nested"));
    });
  });

  describe("fromFile and toRulesyncCommand", () => {
    it("should round-trip extra frontmatter through the codewhale section", async () => {
      await writeFileContent(
        join(testDir, commandsDir, "review.md"),
        "---\ndescription: Review a change\nargument-hint: <pr>\npausable: true\n---\nReview $1\n",
      );

      const command = await CodewhaleCommand.fromFile({
        outputRoot: testDir,
        relativeFilePath: "review.md",
      });
      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getFrontmatter()).toEqual({
        targets: ["*"],
        description: "Review a change",
        codewhale: { "argument-hint": "<pr>", pausable: true },
      });
      expect(rulesyncCommand.getBody()).toBe("Review $1");
      expect(rulesyncCommand.getRelativeFilePath()).toBe("review.md");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it("should honor the codewhale target and the wildcard", () => {
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["*"]))).toBe(true);
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["codewhale"]))).toBe(true);
      expect(CodewhaleCommand.isTargetedByRulesyncCommand(buildCommand(["claudecode"]))).toBe(
        false,
      );
    });
  });

  describe("forDeletion", () => {
    it("should build a non-validated instance", () => {
      const command = CodewhaleCommand.forDeletion({
        outputRoot: testDir,
        relativeDirPath: commandsDir,
        relativeFilePath: "old.md",
      });
      expect(command.getRelativeFilePath()).toBe("old.md");
    });
  });
});
