import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { AugmentcodeCommand } from "./augmentcode-command.js";
import { AugmentcodePluginCommand } from "./augmentcode-plugin-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("AugmentcodePluginCommand", () => {
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
      frontmatter: {
        targets,
        description: "Review the changes",
        augmentcode: {
          "argument-hint": "<branch>",
          model: "sonnet",
          color: "blue",
        },
      },
      body: "Review $ARGUMENTS.",
      fileContent: "",
    });

  it("writes into commands/ and drops the fields Auggie ignores for plugin commands", () => {
    const logger = createMockLogger();

    const command = AugmentcodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand(),
      logger,
    });

    expect(command.getRelativeDirPath()).toBe("commands");
    const { frontmatter } = parseFrontmatter(command.getFileContent(), "review.md");
    expect(frontmatter).toEqual({ description: "Review the changes", model: "sonnet" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Dropping argument-hint, color from augmentcode-plugin command review.md",
      ),
    );
  });

  it("does not warn when only description and model are set", () => {
    const logger = createMockLogger();

    AugmentcodePluginCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: new RulesyncCommand({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "review.md",
        frontmatter: {
          targets: ["*"],
          description: "Review the changes",
          augmentcode: { model: "sonnet" },
        },
        body: "Review.",
        fileContent: "",
      }),
      logger,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps those fields for the augmentcode target", () => {
    const command = AugmentcodeCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: buildRulesyncCommand(),
    });

    expect(command.getRelativeDirPath()).toBe(join(".augment", "commands"));
    const { frontmatter } = parseFrontmatter(command.getFileContent(), "review.md");
    expect(frontmatter).toMatchObject({ "argument-hint": "<branch>", color: "blue" });
  });

  it("is targeted only by commands that name augmentcode-plugin or every target", () => {
    expect(
      AugmentcodePluginCommand.isTargetedByRulesyncCommand(
        buildRulesyncCommand(["augmentcode-plugin"]),
      ),
    ).toBe(true);
    expect(AugmentcodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand(["*"]))).toBe(
      true,
    );
    expect(
      AugmentcodePluginCommand.isTargetedByRulesyncCommand(buildRulesyncCommand(["augmentcode"])),
    ).toBe(false);
  });

  it("reads a command from the plugin's commands/ directory", async () => {
    await writeFileContent(
      join(testDir, "commands", "review.md"),
      "---\ndescription: Review the changes\nmodel: sonnet\n---\nReview.\n",
    );

    const command = await AugmentcodePluginCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(command.getRelativeDirPath()).toBe("commands");
    expect(command.getFrontmatter()).toEqual({
      description: "Review the changes",
      model: "sonnet",
    });
  });

  it("does not import from the cross-tool .agents/commands/ root", async () => {
    await writeFileContent(
      join(testDir, ".agents", "commands", "shared.md"),
      "---\ndescription: Shared command\n---\nShared.\n",
    );

    expect(
      await (AugmentcodePluginCommand as typeof AugmentcodeCommand).loadAdditionalImportFiles({
        outputRoot: testDir,
      }),
    ).toEqual([]);
    // The project-scope target does read that root, so the file above is a real candidate.
    expect(
      await AugmentcodeCommand.loadAdditionalImportFiles({ outputRoot: testDir }),
    ).toHaveLength(1);
  });

  it("has only the plugin's commands/ directory", () => {
    expect(AugmentcodePluginCommand.getSettablePaths()).toEqual({ relativeDirPath: "commands" });
  });
});
