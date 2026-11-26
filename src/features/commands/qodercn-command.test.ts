import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { QoderCommand } from "./qoder-command.js";
import { QodercnCommand } from "./qodercn-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("QodercnCommand", () => {
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

  const makeRulesyncCommand = (targets: string[]) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "commit.md",
      frontmatter: { targets, description: "Commit", qoder: { name: "git-commit" } } as never,
      body: "Review the diff.",
    });

  it("should share .qoder/commands in project scope and use ~/.qoder-cn/commands globally", () => {
    expect(QodercnCommand.getSettablePaths().relativeDirPath).toBe(join(".qoder", "commands"));
    expect(QodercnCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder-cn", "commands"),
    );
    expect(QoderCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "commands"),
    );
  });

  it("should write the qoder section like Qoder does", () => {
    const rulesyncCommand = makeRulesyncCommand(["qodercn"]);
    const command = QodercnCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });
    const qoder = QoderCommand.fromRulesyncCommand({ outputRoot: testDir, rulesyncCommand });

    expect(command.getFrontmatter()).toEqual({ description: "Commit", name: "git-commit" });
    expect(command.getFileContent()).toBe(qoder.getFileContent());
  });

  it("should be targeted by qodercn only", () => {
    expect(QodercnCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["qodercn"]))).toBe(true);
    expect(QodercnCommand.isTargetedByRulesyncCommand(makeRulesyncCommand(["qoder"]))).toBe(false);
  });

  it("should import extra fields back into the qoder section", async () => {
    await writeFileContent(
      join(testDir, ".qoder-cn", "commands", "commit.md"),
      "---\ndescription: Commit\nname: git-commit\n---\n\nReview the diff.\n",
    );
    const command = await QodercnCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "commit.md",
      global: true,
    });

    expect(command.toRulesyncCommand().getFrontmatter()).toMatchObject({
      description: "Commit",
      qoder: { name: "git-commit" },
    });
  });
});
