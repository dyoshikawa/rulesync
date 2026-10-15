import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { TraeCommand } from "./trae-command.js";

describe("TraeCommand", () => {
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

  const createRulesyncCommand = ({
    relativeFilePath,
    frontmatter,
  }: {
    relativeFilePath: string;
    frontmatter: Record<string, unknown>;
  }): RulesyncCommand => {
    const fullFrontmatter = { targets: ["trae" as const], ...frontmatter };
    return new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: fullFrontmatter,
      body: "Review the diff.",
      fileContent: stringifyFrontmatter("Review the diff.", fullFrontmatter),
    });
  };

  it("should use .trae/commands for both scopes", () => {
    expect(TraeCommand.getSettablePaths().relativeDirPath).toBe(join(".trae", "commands"));
    expect(TraeCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".trae", "commands"),
    );
  });

  it("should write the file name stem as name, keep nested paths and round-trip", () => {
    const rulesyncCommand = createRulesyncCommand({
      relativeFilePath: join("git", "commit.md"),
      frontmatter: { description: "Generate a commit message" },
    });

    const command = TraeCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

    expect(command.getRelativeFilePath()).toBe(join("git", "commit.md"));
    expect(command.getFrontmatter()).toEqual({
      name: "commit",
      description: "Generate a commit message",
    });
    expect(command.getFileContent()).toContain("name: commit\n");
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Generate a commit message",
    });
  });

  it("should let the trae section override name and keep it on import", () => {
    const rulesyncCommand = createRulesyncCommand({
      relativeFilePath: "commit.md",
      frontmatter: { description: "Generate a commit message", trae: { name: "git-commit" } },
    });

    const command = TraeCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

    expect(command.getFrontmatter()).toEqual({
      name: "git-commit",
      description: "Generate a commit message",
    });
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Generate a commit message",
      trae: { name: "git-commit" },
    });
  });

  it("should import a command file", async () => {
    await writeFileContent(
      join(testDir, ".trae", "commands", "summarize-pr.md"),
      "---\nname: summarize-pr\ndescription: Summarize PR information.\n---\n\nReview the changes.\n",
    );

    const command = await TraeCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "summarize-pr.md",
    });

    expect(command.getBody()).toBe("Review the changes.");
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Summarize PR information.",
    });
  });

  it("should be targeted by rulesync commands for trae or all tools only", () => {
    expect(
      TraeCommand.isTargetedByRulesyncCommand(
        createRulesyncCommand({ relativeFilePath: "a.md", frontmatter: { description: "a" } }),
      ),
    ).toBe(true);
    expect(
      TraeCommand.isTargetedByRulesyncCommand(
        createRulesyncCommand({
          relativeFilePath: "b.md",
          frontmatter: { description: "b", targets: ["cursor"] },
        }),
      ),
    ).toBe(false);
  });

  describe("validateRulesyncCommands", () => {
    it("should warn when two commands derive the same name", () => {
      const logger = createMockLogger();
      TraeCommand.validateRulesyncCommands({
        rulesyncCommands: [
          createRulesyncCommand({ relativeFilePath: join("a", "review.md"), frontmatter: {} }),
          createRulesyncCommand({ relativeFilePath: join("b", "review.md"), frontmatter: {} }),
          createRulesyncCommand({ relativeFilePath: "commit.md", frontmatter: {} }),
        ],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Trae command name "review" is shared by "a/review.md", "b/review.md", but Trae treats `name` as a unique identifier. Rename a file or set `trae.name` to tell them apart.',
      );
    });

    it("should use the trae section name when checking for duplicates", () => {
      const logger = createMockLogger();
      TraeCommand.validateRulesyncCommands({
        rulesyncCommands: [
          createRulesyncCommand({ relativeFilePath: join("a", "review.md"), frontmatter: {} }),
          createRulesyncCommand({
            relativeFilePath: join("b", "review.md"),
            frontmatter: { trae: { name: "review-b" } },
          }),
          createRulesyncCommand({
            relativeFilePath: "check.md",
            frontmatter: { trae: { name: "review" } },
          }),
        ],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"review" is shared by "a/review.md", "check.md"'),
      );
    });

    it("should ignore commands not targeted at trae", () => {
      const logger = createMockLogger();
      TraeCommand.validateRulesyncCommands({
        rulesyncCommands: [
          createRulesyncCommand({ relativeFilePath: join("a", "review.md"), frontmatter: {} }),
          createRulesyncCommand({
            relativeFilePath: join("b", "review.md"),
            frontmatter: { targets: ["claudecode"] },
          }),
        ],
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should warn about project commands nested deeper than three levels", () => {
      const logger = createMockLogger();
      TraeCommand.validateRulesyncCommands({
        rulesyncCommands: [
          createRulesyncCommand({
            relativeFilePath: join("a", "b", "c", "ok.md"),
            frontmatter: {},
          }),
          createRulesyncCommand({
            relativeFilePath: join("a", "b", "c", "d", "deep.md"),
            frontmatter: {},
          }),
        ],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Trae reads project commands only up to 3 nested directory levels, so "a/b/c/d/deep.md" is written but never loaded. Move it to a shallower directory.',
      );
    });

    it("should not apply the nesting limit to global commands", () => {
      const logger = createMockLogger();
      TraeCommand.validateRulesyncCommands({
        rulesyncCommands: [
          createRulesyncCommand({
            relativeFilePath: join("a", "b", "c", "d", "deep.md"),
            frontmatter: {},
          }),
        ],
        logger,
        global: true,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
