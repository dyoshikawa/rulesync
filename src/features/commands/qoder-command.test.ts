import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { QoderCommand } from "./qoder-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("QoderCommand", () => {
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

  it("should use .qoder/commands for both scopes", () => {
    expect(QoderCommand.getSettablePaths().relativeDirPath).toBe(join(".qoder", "commands"));
    expect(QoderCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "commands"),
    );
  });

  it("should write description plus the qoder section and keep nested paths", () => {
    const frontmatter = {
      targets: ["qoder" as const],
      description: "Generate a commit message",
      qoder: { name: "git-commit" },
    };
    const rulesyncCommand = new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: join("git", "commit.md"),
      frontmatter,
      body: "Review the diff.",
      fileContent: stringifyFrontmatter("Review the diff.", frontmatter),
    });

    const command = QoderCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

    expect(command.getRelativeFilePath()).toBe(join("git", "commit.md"));
    expect(command.getFrontmatter()).toEqual({
      description: "Generate a commit message",
      name: "git-commit",
    });
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Generate a commit message",
      qoder: { name: "git-commit" },
    });
  });

  it("should import a command file", async () => {
    await writeFileContent(
      join(testDir, ".qoder", "commands", "review.md"),
      "---\ndescription: Review code\n---\n\nReview the changes.\n",
    );

    const command = await QoderCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(command.getBody()).toBe("Review the changes.");
    expect(command.toRulesyncCommand().getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Review code",
    });
  });
});
