import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GitlabduoCommand } from "./gitlabduo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("GitlabduoCommand", () => {
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

  it("should resolve .agents/commands for the project and .gitlab/duo/commands globally", () => {
    expect(GitlabduoCommand.getSettablePaths().relativeDirPath).toBe(join(".agents", "commands"));
    expect(GitlabduoCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".gitlab", "duo", "commands"),
    );
  });

  it("should write the body with a description-only frontmatter", () => {
    const rulesyncCommand = new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "daily.md",
      frontmatter: { targets: ["gitlabduo"], description: "Prepare a daily report" },
      body: "Summarize my TODO items.",
      fileContent: "",
    });

    const command = GitlabduoCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand,
      global: true,
    });

    expect(command.getRelativeDirPath()).toBe(join(".gitlab", "duo", "commands"));
    expect(command.getRelativeFilePath()).toBe("daily.md");
    expect(command.getFileContent()).toBe(
      "---\ndescription: Prepare a daily report\n---\nSummarize my TODO items.\n",
    );
  });

  it("should import a command back into rulesync", async () => {
    await writeFileContent(
      join(testDir, ".agents", "commands", "daily.md"),
      "---\ndescription: Prepare a daily report\n---\n\nSummarize my TODO items.\n",
    );

    const command = await GitlabduoCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "daily.md",
    });
    const rulesyncCommand = command.toRulesyncCommand();

    expect(rulesyncCommand.getFrontmatter()).toEqual({
      targets: ["*"],
      description: "Prepare a daily report",
    });
    expect(rulesyncCommand.getBody()).toBe("Summarize my TODO items.");
    expect(rulesyncCommand.getRelativeFilePath()).toBe("daily.md");
  });

  it("should only target commands that list gitlabduo or the wildcard", () => {
    const make = (targets: string[]) =>
      new RulesyncCommand({
        relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: targets as never },
        body: "",
        fileContent: "",
      });
    expect(GitlabduoCommand.isTargetedByRulesyncCommand(make(["*"]))).toBe(true);
    expect(GitlabduoCommand.isTargetedByRulesyncCommand(make(["gitlabduo"]))).toBe(true);
    expect(GitlabduoCommand.isTargetedByRulesyncCommand(make(["agentsmd"]))).toBe(false);
  });
});
