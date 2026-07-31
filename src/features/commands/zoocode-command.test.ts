import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ZoocodeCommand } from "./zoocode-command.js";

describe("ZoocodeCommand", () => {
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

  it("re-tags imported commands to zoocode so a zoocode generate keeps them", async () => {
    await writeFileContent(
      join(testDir, ".roo", "commands", "review-pr.md"),
      "---\ndescription: Review a PR\n---\nReview the PR.",
    );

    const command = await ZoocodeCommand.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review-pr.md",
    });
    expect(command).toBeInstanceOf(ZoocodeCommand);

    const rulesyncCommand = command.toRulesyncCommand();
    expect(rulesyncCommand.getFrontmatter().targets).toEqual(["zoocode"]);
    expect(rulesyncCommand.getFileContent()).toContain("zoocode");
  });
});
