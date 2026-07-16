import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { commandSlug, rulesyncCommandSlugExists } from "./command-skill-ownership.js";

describe("commandSlug", () => {
  it("should strip the .md extension and keep safe characters", () => {
    expect(commandSlug("review-pr.md")).toBe("review-pr");
    expect(commandSlug("deep/nested/review_pr.md")).toBe("review_pr");
  });

  it("should replace characters outside [a-zA-Z0-9_-] with dashes", () => {
    expect(commandSlug("my command!.md")).toBe("my-command-");
  });
});

describe("rulesyncCommandSlugExists", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return true when a command file matches the slug", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      "Review.",
    );

    expect(await rulesyncCommandSlugExists({ inputRoot: testDir, dirName: "review-pr" })).toBe(
      true,
    );
  });

  it("should match nested command files by their slug-converted basename", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "git", "my command.md"),
      "Commit.",
    );

    expect(await rulesyncCommandSlugExists({ inputRoot: testDir, dirName: "my-command" })).toBe(
      true,
    );
  });

  it("should return false when no command matches", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md"),
      "Review.",
    );

    expect(await rulesyncCommandSlugExists({ inputRoot: testDir, dirName: "other" })).toBe(false);
  });

  it("should return false when the commands directory does not exist", async () => {
    expect(await rulesyncCommandSlugExists({ inputRoot: testDir, dirName: "review-pr" })).toBe(
      false,
    );
  });
});
