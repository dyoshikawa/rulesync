import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { OmpCommand } from "./omp-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("OmpCommand", () => {
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
      omp: { "argument-hint": "<file>" },
      pi: { "argument-hint": "ignored" },
    };
    return new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: frontmatter as never,
      body: "Review $1",
      fileContent: stringifyFrontmatter("Review $1", frontmatter),
    });
  };

  it("should resolve project and global settable paths under the omp dirs", () => {
    expect(OmpCommand.getSettablePaths().relativeDirPath).toBe(join(".omp", "commands"));
    expect(OmpCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".omp", "agent", "commands"),
    );
  });

  it("should be targeted by omp and wildcard commands only", () => {
    expect(OmpCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["omp"]))).toBe(true);
    expect(OmpCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["*"]))).toBe(true);
    expect(OmpCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["pi"]))).toBe(false);
  });

  it("should read the omp section and round-trip it on import", () => {
    const command = OmpCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: makeRulesyncCommand(["omp"]),
    });

    expect(command).toBeInstanceOf(OmpCommand);
    expect(command.getRelativeDirPath()).toBe(join(".omp", "commands"));
    expect(command.getFrontmatter()).toEqual({
      description: "Review code",
      "argument-hint": "<file>",
    });
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Review code",
      omp: { "argument-hint": "<file>" },
    });
  });

  it("should load a command file from .omp/commands", async () => {
    await writeFileContent(
      join(testDir, ".omp", "commands", "review.md"),
      "---\ndescription: Review code\n---\nReview $1\n",
    );

    const command = await OmpCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(command).toBeInstanceOf(OmpCommand);
    expect(command.getBody()).toBe("Review $1");
  });
});
