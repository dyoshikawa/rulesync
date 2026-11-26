import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GajaecodeCommand } from "./gajaecode-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("GajaecodeCommand", () => {
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

  const makeRulesyncCommand = (targets: string[]) => {
    const frontmatter = {
      targets,
      description: "Review code",
      gajaecode: { "argument-hint": "<file>" },
      pi: { "argument-hint": "ignored" },
    };
    return new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: frontmatter as never,
      body: "Review $1",
    });
  };

  it("should resolve project and global settable paths under the .gjc dirs", () => {
    expect(GajaecodeCommand.getSettablePaths().relativeDirPath).toBe(join(".gjc", "commands"));
    expect(GajaecodeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".gjc", "agent", "commands"),
    );
  });

  it("should be targeted by gajaecode and wildcard commands only", () => {
    expect(GajaecodeCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["gajaecode"]))).toBe(
      true,
    );
    expect(GajaecodeCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["*"]))).toBe(true);
    expect(GajaecodeCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["pi"]))).toBe(false);
  });

  it("should read the gajaecode section and round-trip it on import", () => {
    const command = GajaecodeCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: makeRulesyncCommand(["gajaecode"]),
    });

    expect(command).toBeInstanceOf(GajaecodeCommand);
    expect(command.getRelativeDirPath()).toBe(join(".gjc", "commands"));
    expect(command.getFrontmatter()).toEqual({
      description: "Review code",
      "argument-hint": "<file>",
    });
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Review code",
      gajaecode: { "argument-hint": "<file>" },
    });
  });

  it("should load a command file from .gjc/commands", async () => {
    await writeFileContent(
      join(testDir, ".gjc", "commands", "review.md"),
      "---\ndescription: Review code\n---\nReview $1\n",
    );

    const command = await GajaecodeCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(command).toBeInstanceOf(GajaecodeCommand);
    expect(command.getBody()).toBe("Review $1");
  });
});
