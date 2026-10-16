import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { KimiCodeCommand } from "./kimi-code-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KimiCodeCommand", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getSettablePaths", () => {
    it("should return the .kimi-code/skills directory at both scopes", () => {
      vi.stubEnv("KIMI_CODE_HOME", "");
      expect(KimiCodeCommand.getSettablePaths().relativeDirPath).toBe(join(".kimi-code", "skills"));
      expect(KimiCodeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".kimi-code", "skills"),
      );
    });

    it("should use skills/ directly under KIMI_CODE_HOME in global scope", () => {
      vi.stubEnv("KIMI_CODE_HOME", "/tmp/custom-kimi");
      expect(KimiCodeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe("skills");
      expect(KimiCodeCommand.getSettablePaths().relativeDirPath).toBe(join(".kimi-code", "skills"));
    });
  });

  describe("fromRulesyncCommand", () => {
    const rulesyncCommand = new RulesyncCommand({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review-pr.md",
      frontmatter: {
        description: "Review the current changes",
      },
      body: "Review $ARGUMENTS carefully.",
      fileContent: "",
    });

    it("should emit a manual-only SKILL.md under a per-command slug directory", () => {
      vi.stubEnv("KIMI_CODE_HOME", "");
      const command = KimiCodeCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand,
      });

      expect(command.getRelativeDirPath()).toBe(join(".kimi-code", "skills", "review-pr"));
      expect(command.getRelativeFilePath()).toBe("SKILL.md");
      const { frontmatter, body } = parseFrontmatter(command.getFileContent());
      expect(frontmatter).toEqual({
        name: "review-pr",
        description: "Review the current changes",
        disableModelInvocation: true,
      });
      expect(body.trim()).toBe("Review $ARGUMENTS carefully.");
    });

    it("should fall back to a generated description when none is authored", () => {
      const withoutDescription = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: {},
        body: "Deploy the app.",
        fileContent: "",
      });

      const command = KimiCodeCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand: withoutDescription,
      });

      expect(parseFrontmatter(command.getFileContent()).frontmatter.description).toBe(
        "deploy command",
      );
    });

    it("should fall back to a generated description when the authored one is blank", () => {
      const blankDescription = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "deploy.md",
        frontmatter: { description: "   " },
        body: "Deploy the app.",
        fileContent: "",
      });

      const command = KimiCodeCommand.fromRulesyncCommand({
        outputRoot: ".",
        rulesyncCommand: blankDescription,
      });

      expect(parseFrontmatter(command.getFileContent()).frontmatter.description).toBe(
        "deploy command",
      );
    });

    it("should normalize Kimi's alias spellings to the canonical keys", () => {
      const withAliases = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "commit.md",
        frontmatter: {
          description: "Commit",
          "kimi-code": {
            "when-to-use": "When asked to commit",
            disable_model_invocation: false,
          },
        },
        body: "Commit.",
        fileContent: "",
      });

      const { frontmatter } = parseFrontmatter(
        KimiCodeCommand.fromRulesyncCommand({
          outputRoot: ".",
          rulesyncCommand: withAliases,
        }).getFileContent(),
      );

      expect(frontmatter).toEqual({
        name: "commit",
        description: "Commit",
        disableModelInvocation: false,
        whenToUse: "When asked to commit",
      });
    });

    it("should prefer the canonical spelling over an alias", () => {
      const withBoth = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "commit.md",
        frontmatter: {
          description: "Commit",
          "kimi-code": { whenToUse: "canonical", when_to_use: "alias" },
        },
        body: "Commit.",
        fileContent: "",
      });

      const { frontmatter } = parseFrontmatter(
        KimiCodeCommand.fromRulesyncCommand({
          outputRoot: ".",
          rulesyncCommand: withBoth,
        }).getFileContent(),
      );

      expect(frontmatter.whenToUse).toBe("canonical");
      expect(frontmatter).not.toHaveProperty("when_to_use");
    });

    it("should carry whitelisted keys of the kimi-code section and drop the rest", () => {
      const withSection = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "commit.md",
        frontmatter: {
          description: "Commit",
          "kimi-code": {
            arguments: ["message"],
            whenToUse: "When asked to commit",
            disableModelInvocation: false,
            unknownKey: "dropped",
          },
        },
        body: "Commit with $message.",
        fileContent: "",
      });

      const { frontmatter } = parseFrontmatter(
        KimiCodeCommand.fromRulesyncCommand({
          outputRoot: ".",
          rulesyncCommand: withSection,
        }).getFileContent(),
      );

      expect(frontmatter).toEqual({
        name: "commit",
        description: "Commit",
        disableModelInvocation: false,
        arguments: ["message"],
        whenToUse: "When asked to commit",
      });
    });
  });

  describe("toRulesyncCommand", () => {
    it("should strip skill frontmatter and derive the command name from the slug dir", () => {
      const command = new KimiCodeCommand({
        relativeDirPath: join(".kimi-code", "skills", "review-pr"),
        relativeFilePath: "SKILL.md",
        fileContent: [
          "---",
          "name: review-pr",
          "description: Review the current changes",
          "disableModelInvocation: true",
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
    });
  });

  describe("isTargetedByRulesyncCommand", () => {
    it.each([
      { targets: undefined, expected: true },
      { targets: ["*"], expected: true },
      { targets: ["kimi-code"], expected: true },
      { targets: ["kimi-code-plugin"], expected: false },
    ])("should return $expected for targets $targets", ({ targets, expected }) => {
      const rulesyncCommand = new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review-pr.md",
        frontmatter: { targets: targets as ["*"] | undefined, description: "Review" },
        body: "Review.",
        fileContent: "",
      });

      expect(KimiCodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)).toBe(expected);
    });
  });
});
