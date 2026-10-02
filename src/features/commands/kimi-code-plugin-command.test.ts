import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KimiCodePluginCommand } from "./kimi-code-plugin-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("KimiCodePluginCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncCommand = (
    frontmatter: Record<string, unknown> = { targets: ["*"], description: "Review a PR" },
    relativeFilePath = "review-pr.md",
  ) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: frontmatter as RulesyncCommand["frontmatter"],
      body: "Review pull request $ARGUMENTS.",
      fileContent: "",
    });

  it("writes the description and body into the plugin's commands/ directory", () => {
    const command = KimiCodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand(),
    });

    expect(command.getRelativeDirPath()).toBe("commands");
    expect(command.getRelativeFilePath()).toBe("review-pr.md");
    expect(command.getFrontmatter()).toEqual({ description: "Review a PR" });
    expect(command.getFileContent()).toContain("description: Review a PR");
    expect(command.getFileContent()).toContain("Review pull request $ARGUMENTS.");
  });

  it("keeps a nested command path, which Kimi turns into the command name", () => {
    const command = KimiCodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand(undefined, join("frontend", "component.md")),
    });

    expect(command.getRelativeFilePath()).toBe(join("frontend", "component.md"));
  });

  it("omits the description when the Rulesync command has none", () => {
    const command = KimiCodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand({ targets: ["*"] }),
    });

    expect(command.getFrontmatter()).toEqual({});
  });

  it("applies the kimi-code-plugin section, such as an explicit name", () => {
    const command = KimiCodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand({
        targets: ["*"],
        description: "Review a PR",
        "kimi-code-plugin": { name: "review" },
      }),
    });

    expect(command.getFrontmatter()).toEqual({ description: "Review a PR", name: "review" });
  });

  it("round-trips a plugin command file, keeping extra fields in the tool section", async () => {
    await writeFileContent(
      join(testDir, "commands", "review-pr.md"),
      "---\nname: review\ndescription: Review a PR\n---\nReview pull request $ARGUMENTS.\n",
    );

    const command = await KimiCodePluginCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review-pr.md",
    });
    const rulesyncCommand = command.toRulesyncCommand();

    expect(rulesyncCommand.getOutputRoot()).toBe(".");
    expect(rulesyncCommand.getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Review a PR",
      "kimi-code-plugin": { name: "review" },
    });
    expect(rulesyncCommand.getBody()).toBe("Review pull request $ARGUMENTS.");
  });

  it("is targeted by the wildcard and by kimi-code-plugin only", () => {
    expect(KimiCodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand())).toBe(true);
    expect(
      KimiCodePluginCommand.isTargetedByRulesyncCommand(
        buildRulesyncCommand({ targets: ["kimi-code-plugin"] }),
      ),
    ).toBe(true);
    expect(
      KimiCodePluginCommand.isTargetedByRulesyncCommand(
        buildRulesyncCommand({ targets: ["kimi-code"] }),
      ),
    ).toBe(false);
  });

  it("builds a deletion placeholder without validating", () => {
    const command = KimiCodePluginCommand.forDeletion({
      outputRoot: testDir,
      relativeDirPath: "commands",
      relativeFilePath: "stale.md",
    });

    expect(command.getRelativeFilePath()).toBe("stale.md");
  });
});
