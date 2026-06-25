import { describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { HermesagentCommand } from "./hermesagent-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("HermesagentCommand", () => {
  it("uses rulesync command description and body when generating SKILL.md", () => {
    const rulesyncCommand = new RulesyncCommand({
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: `${RULESYNC_COMMANDS_RELATIVE_DIR_PATH}/review.md`,
      frontmatter: {
        description: "Review the current changes",
      },
      body: "Review the diff carefully.",
      fileContent: "",
    });

    const command = HermesagentCommand.fromRulesyncCommand({
      outputRoot: ".",
      rulesyncCommand,
    });

    expect(command.getFileContent()).toContain("description: Review the current changes");
    expect(command.getFileContent()).toContain("Review the diff carefully.");
    expect(command.getFileContent()).not.toContain("targets:");
  });

  it("strips Hermes skill frontmatter when importing back to rulesync command", () => {
    const command = new HermesagentCommand({
      relativeDirPath: ".hermes/skills/review",
      relativeFilePath: "SKILL.md",
      fileContent: [
        "---",
        "name: review",
        "description: Review the current changes",
        "---",
        "",
        "Review the diff carefully.",
        "",
      ].join("\n"),
    });

    const rulesyncCommand = command.toRulesyncCommand();

    expect(rulesyncCommand.getFrontmatter().description).toBe("Review the current changes");
    expect(rulesyncCommand.getBody()).toBe("Review the diff carefully.\n");
    expect(rulesyncCommand.getBody()).not.toContain("---");
  });
});
