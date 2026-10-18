import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AntigravityPluginRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should load a plain rules/AGENTS.md as the root rule and add the trigger", async () => {
    await writeFileContent(join(testDir, "rules", "AGENTS.md"), "# Plugin Root\n");

    const rule = await AntigravityPluginRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: "rules",
      relativeFilePath: "AGENTS.md",
    });

    expect(rule).toBeInstanceOf(AntigravityPluginRule);
    expect(rule.isRoot()).toBe(true);
    expect(rule.getBody()).toBe("# Plugin Root\n");
    expect(rule.getFileContent()).toBe("---\ntrigger: always_on\n---\n# Plugin Root\n");
    expect(rule.toRulesyncRule().getBody()).toBe("# Plugin Root\n");
  });

  it("should write the root rule as rules/AGENTS.md with an always_on trigger", () => {
    const rulesyncRule = new RulesyncRule({
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["*"] },
      body: "# Overview\nRoot rule.",
    });

    const rule = AntigravityPluginRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(rule.isRoot()).toBe(true);
    expect(rule.getRelativeDirPath()).toBe("rules");
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(rule.getFileContent()).toBe("---\ntrigger: always_on\n---\n# Overview\nRoot rule.\n");
  });

  it("should import a root rule with its trigger frontmatter as a plain root rule", async () => {
    await writeFileContent(
      join(testDir, "rules", "AGENTS.md"),
      "---\ntrigger: always_on\n---\n# Plugin Root\n",
    );

    const rule = await AntigravityPluginRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: "rules",
      relativeFilePath: "AGENTS.md",
    });
    const rulesyncRule = rule.toRulesyncRule();

    expect(rule.isRoot()).toBe(true);
    expect(rule.getFrontmatter()).toEqual({ trigger: "always_on" });
    expect(rulesyncRule.getFrontmatter().root).toBe(true);
    expect(rulesyncRule.getBody()).toBe("# Plugin Root\n");
    expect(rulesyncRule.getBody()).not.toContain("trigger");
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
