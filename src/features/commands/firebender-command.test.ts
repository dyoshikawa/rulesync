import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderCommand } from "./firebender-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

describe("FirebenderCommand", () => {
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

  const makeRulesyncCommand = (frontmatter: Record<string, unknown>) =>
    new RulesyncCommand({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: "review-diff.md",
      frontmatter: { targets: ["*"], ...frontmatter },
      body: "Review the current git diff.",
    });

  it("should use .firebender/commands in both scopes", () => {
    expect(FirebenderCommand.getSettablePaths().relativeDirPath).toBe(
      join(".firebender", "commands"),
    );
    expect(FirebenderCommand.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".firebender", "commands"),
    );
  });

  it("should write an .mdc command with the description and firebender fields", () => {
    const command = FirebenderCommand.fromRulesyncCommand({
      outputRoot: testDir,
      rulesyncCommand: makeRulesyncCommand({
        description: "Review staged changes",
        firebender: { name: "review diff", mode: "read", model: "quick" },
      }),
    });

    expect(command.getRelativeDirPath()).toBe(join(".firebender", "commands"));
    expect(command.getRelativeFilePath()).toBe("review-diff.mdc");
    expect(command.getFrontmatter()).toEqual({
      description: "Review staged changes",
      name: "review diff",
      mode: "read",
      model: "quick",
    });
    expect(command.getFileContent()).toContain("mode: read\n");
    expect(command.getFileContent()).toContain("Review the current git diff.");
  });

  it("should import an .mdc command and keep Firebender-only fields in the firebender section", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "commands", "create-pr.mdc"),
      "---\nname: create pr\ndescription: Create a PR\nmodel: default\nmode: write\n---\n\nCreate a PR.\n",
    );

    const command = await FirebenderCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "create-pr.mdc",
    });
    const rulesyncCommand = command.toRulesyncCommand();

    expect(rulesyncCommand.getRelativeFilePath()).toBe("create-pr.md");
    expect(rulesyncCommand.getFrontmatter()).toMatchObject({
      targets: ["*"],
      description: "Create a PR",
      firebender: { name: "create pr", model: "default", mode: "write" },
    });
    expect(rulesyncCommand.getBody()).toBe("Create a PR.");
  });

  it("should import a command without frontmatter", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "commands", "quick-review.mdc"),
      "Review the current file.\n",
    );

    const command = await FirebenderCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "quick-review.mdc",
    });

    expect(command.getFrontmatter()).toEqual({});
    expect(command.toRulesyncCommand().getBody()).toBe("Review the current file.");
  });

  it("should be targeted by firebender and wildcard commands only", () => {
    expect(
      FirebenderCommand.isTargetedByRulesyncCommand(
        makeRulesyncCommand({ targets: ["firebender"] }),
      ),
    ).toBe(true);
    expect(FirebenderCommand.isTargetedByRulesyncCommand(makeRulesyncCommand({}))).toBe(true);
    expect(
      FirebenderCommand.isTargetedByRulesyncCommand(makeRulesyncCommand({ targets: ["cursor"] })),
    ).toBe(false);
  });
});
