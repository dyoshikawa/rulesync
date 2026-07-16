import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { DevinCommand } from "./devin-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("DevinCommand", () => {
  describe("getSettablePaths", () => {
    it("should return the project skills directory by default", () => {
      expect(DevinCommand.getSettablePaths().relativeDirPath).toBe(join(".devin", "skills"));
    });

    it("should return the Devin-native global skills directory in global mode", () => {
      expect(DevinCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "devin", "skills"),
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

    it("should emit a SKILL.md under a per-command slug directory (project)", () => {
      const command = DevinCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand,
      });

      expect(command.getRelativeDirPath()).toBe(join(".devin", "skills", "review-pr"));
      expect(command.getRelativeFilePath()).toBe("SKILL.md");
      expect(command.getFileContent()).toContain("name: review-pr");
      expect(command.getFileContent()).toContain("description: Review the current changes");
      expect(command.getFileContent()).toContain("Review the diff carefully.");
      expect(command.getFileContent()).not.toContain("targets:");
    });

    it("should emit under ~/.config/devin/skills in global mode", () => {
      const command = DevinCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand,
        global: true,
      });

      expect(command.getRelativeDirPath()).toBe(join(".config", "devin", "skills", "review-pr"));
      expect(command.getRelativeFilePath()).toBe("SKILL.md");
    });

    it("should fall back to a generated description when none is authored", () => {
      const withoutDescription = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: {},
        body: "Deploy the app.",
        fileContent: "",
      });

      const command = DevinCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand: withoutDescription,
      });

      expect(command.getFileContent()).toContain("description: deploy command");
    });

    it("should sanitize slug characters outside [a-zA-Z0-9_-]", () => {
      const weirdName = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review pr!.md",
        frontmatter: { description: "Review" },
        body: "Review.",
        fileContent: "",
      });

      const command = DevinCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand: weirdName,
      });

      expect(command.getRelativeDirPath()).toBe(join(".devin", "skills", "review-pr-"));
    });
  });

  describe("toRulesyncCommand", () => {
    it("should strip skill frontmatter and derive the command name from the slug dir", () => {
      const command = new DevinCommand({
        relativeDirPath: join(".devin", "skills", "review-pr"),
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
      { targets: ["devin"], expected: true },
      { targets: ["claudecode"], expected: false },
    ])("should return $expected for targets $targets", ({ targets, expected }) => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review-pr.md",
        frontmatter: { targets: targets as ["*"] | undefined, description: "Review" },
        body: "Review.",
        fileContent: "",
      });

      expect(DevinCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(expected);
    });
  });
});
