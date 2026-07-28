import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { WarpCommand } from "./warp-command.js";

describe("WarpCommand", () => {
  describe("getSettablePaths", () => {
    it("should return the .warp/skills directory at both scopes", () => {
      expect(WarpCommand.getSettablePaths().relativeDirPath).toBe(join(".warp", "skills"));
      expect(WarpCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".warp", "skills"),
      );
    });
  });

  describe("fromRulesyncCommand", () => {
    const rulesyncCommand = new RulesyncCommand({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review-pr.md",
      frontmatter: {
        description: "Review the current changes",
      },
      body: "Review the diff carefully.",
      fileContent: "",
    });

    it("should emit a SKILL.md under a per-command slug directory", () => {
      const command = WarpCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand,
      });

      expect(command.getRelativeDirPath()).toBe(join(".warp", "skills", "review-pr"));
      expect(command.getRelativeFilePath()).toBe("SKILL.md");
      expect(command.getFileContent()).toContain("name: review-pr");
      expect(command.getFileContent()).toContain("description: Review the current changes");
      expect(command.getFileContent()).toContain("Review the diff carefully.");
      expect(command.getFileContent()).not.toContain("targets:");
    });

    it("should fall back to a generated description when none is authored", () => {
      const withoutDescription = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: {},
        body: "Deploy the app.",
        fileContent: "",
      });

      const command = WarpCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand: withoutDescription,
      });

      expect(command.getFileContent()).toContain("description: deploy command");
    });
  });

  describe("toRulesyncCommand", () => {
    it("should strip skill frontmatter and derive the command name from the slug dir", () => {
      const command = new WarpCommand({
        relativeDirPath: join(".warp", "skills", "review-pr"),
        relativeFilePath: "SKILL.md",
        fileContent: [
          "---",
          "name: review-pr",
          "description: Review the current changes",
          "---",
          "",
          "Review the diff carefully.",
          "",
        ].join("\n"),
      });

      const rulesyncCommand = command.toRulesyncCommand();

      expect(rulesyncCommand.getRelativeFilePath()).toBe("review-pr.md");
      expect(rulesyncCommand.getFrontmatter().description).toBe("Review the current changes");
      expect(rulesyncCommand.getBody()).toBe("Review the diff carefully.\n");
      expect(rulesyncCommand.getBody()).not.toContain("---");
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it.each([
      { targets: undefined, expected: true },
      { targets: ["*"], expected: true },
      { targets: ["warp"], expected: true },
      { targets: ["claudecode"], expected: false },
    ])("should return $expected for targets $targets", ({ targets, expected }) => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review-pr.md",
        frontmatter: { targets: targets as ["*"] | undefined, description: "Review" },
        body: "Review.",
        fileContent: "",
      });

      expect(WarpCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(expected);
    });
  });
});
