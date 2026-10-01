import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ZcodeCommand } from "./zcode-command.js";
import { ZcodePluginCommand } from "./zcode-plugin-command.js";

describe("ZcodePluginCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncCommand = (targets: RulesyncTargets = ["*"]) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: { targets, description: "Review the changes" },
      body: "Review $ARGUMENTS.",
      fileContent: "",
    });

  it("writes into the plugin's commands/ directory, while zcode keeps .zcode/commands/", () => {
    const rulesyncCommand = buildRulesyncCommand();

    const pluginCommand = ZcodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand,
    });
    const projectCommand = ZcodeCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand,
    });

    expect(pluginCommand.getRelativeDirPath()).toBe("commands");
    expect(pluginCommand.getFileContent()).toContain("description: Review the changes");
    expect(projectCommand.getRelativeDirPath()).toBe(join(".zcode", "commands"));
  });

  it("reads a command back from the plugin's commands/ directory", async () => {
    await writeFileContent(
      join(testDir, "commands", "review.md"),
      "---\ndescription: Review the changes\n---\nReview $ARGUMENTS.\n",
    );

    const command = await ZcodePluginCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(command.getRelativeDirPath()).toBe("commands");
    expect(command.toRulesyncCommand().getFrontmatter().description).toBe("Review the changes");
  });

  it("is targeted by the wildcard and by zcode-plugin, not by zcode alone", () => {
    expect(ZcodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand(["*"]))).toBe(true);
    expect(
      ZcodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand(["zcode-plugin"])),
    ).toBe(true);
    expect(ZcodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand(["zcode"]))).toBe(
      false,
    );
  });
});
