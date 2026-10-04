import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";

describe("AntigravityPluginRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should load rules/AGENTS.md as the plain root rule", async () => {
    await writeFileContent(join(testDir, "rules", "AGENTS.md"), "# Plugin Root\n");

    const rule = await AntigravityPluginRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: "rules",
      relativeFilePath: "AGENTS.md",
    });

    expect(rule).toBeInstanceOf(AntigravityPluginRule);
    expect(rule.isRoot()).toBe(true);
    expect(rule.getFileContent()).toBe("# Plugin Root\n");
  });

  it("should mark only rules/AGENTS.md as root for deletion", () => {
    const rootRule = AntigravityPluginRule.forDeletion({
      relativeDirPath: "rules",
      relativeFilePath: "AGENTS.md",
    });
    const nonRootRule = AntigravityPluginRule.forDeletion({
      relativeDirPath: "rules",
      relativeFilePath: "style.md",
    });

    expect(rootRule).toBeInstanceOf(AntigravityPluginRule);
    expect(rootRule.isRoot()).toBe(true);
    expect(rootRule.isDeletable()).toBe(true);
    expect(nonRootRule.isRoot()).toBe(false);
    expect(nonRootRule.isDeletable()).toBe(true);
  });
});
