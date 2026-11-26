import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { BbRule } from "./bb-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("BbRule", () => {
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

  it("should resolve .bb/AGENTS.md in both scopes with no non-root dir", () => {
    const expected = { relativeDirPath: ".bb", relativeFilePath: "AGENTS.md" };
    expect(BbRule.getSettablePaths().root).toEqual(expected);
    expect(BbRule.getSettablePaths().nonRoot).toBeUndefined();
    expect(BbRule.getSettablePaths({ global: true }).root).toEqual(expected);
  });

  it("should write root and non-root rules to the single rules file", () => {
    for (const root of [true, false]) {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: root ? "overview.md" : "style.md",
        frontmatter: { root, targets: ["bb"] },
        body: "Use tabs.",
      });

      const rule = BbRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(".bb");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("Use tabs.");
      expect(rule.isRoot()).toBe(root);
    }
  });

  it("should import the rules file as the root rule", async () => {
    await writeFileContent(join(testDir, ".bb", "AGENTS.md"), "# Rules\n\nBe kind.");

    const rule = await BbRule.fromFile({
      outputRoot: testDir,
      relativeFilePath: "AGENTS.md",
    });
    const rulesyncRule = rule.toRulesyncRule();

    expect(rule.isRoot()).toBe(true);
    expect(rulesyncRule.getFrontmatter().root).toBe(true);
    expect(rulesyncRule.getBody()).toBe("# Rules\n\nBe kind.");
  });

  it("should report the root file on deletion in both scopes", () => {
    for (const global of [false, true]) {
      const rule = BbRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".bb",
        relativeFilePath: "AGENTS.md",
        global,
      });
      expect(rule.isRoot()).toBe(true);
    }
  });

  it("should only target rules that list bb or the wildcard", () => {
    const make = (targets: string[]) =>
      new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "a.md",
        frontmatter: { targets: targets as never },
        body: "",
      });
    expect(BbRule.isTargetedByRulesyncRule(make(["*"]))).toBe(true);
    expect(BbRule.isTargetedByRulesyncRule(make(["bb"]))).toBe(true);
    expect(BbRule.isTargetedByRulesyncRule(make(["cursor"]))).toBe(false);
  });
});
