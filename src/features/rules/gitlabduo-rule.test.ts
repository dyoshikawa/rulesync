import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GitlabduoRule } from "./gitlabduo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("GitlabduoRule", () => {
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

  it("should resolve .gitlab/duo/chat-rules.md in both scopes with no non-root dir", () => {
    const expected = { relativeDirPath: join(".gitlab", "duo"), relativeFilePath: "chat-rules.md" };
    expect(GitlabduoRule.getSettablePaths().root).toEqual(expected);
    expect(GitlabduoRule.getSettablePaths().nonRoot).toBeUndefined();
    expect(GitlabduoRule.getSettablePaths({ global: true }).root).toEqual(expected);
  });

  it("should write root and non-root rules to the single rules file", () => {
    for (const root of [true, false]) {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: root ? "overview.md" : "style.md",
        frontmatter: { root, targets: ["gitlabduo"] },
        body: "Use tabs.",
      });

      const rule = GitlabduoRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(join(".gitlab", "duo"));
      expect(rule.getRelativeFilePath()).toBe("chat-rules.md");
      expect(rule.getFileContent()).toBe("Use tabs.");
      expect(rule.isRoot()).toBe(root);
    }
  });

  it("should import the rules file as the root rule", async () => {
    await writeFileContent(join(testDir, ".gitlab", "duo", "chat-rules.md"), "# Rules\n\nBe kind.");

    const rule = await GitlabduoRule.fromFile({
      outputRoot: testDir,
      relativeFilePath: "chat-rules.md",
    });
    const rulesyncRule = rule.toRulesyncRule();

    expect(rule.isRoot()).toBe(true);
    expect(rulesyncRule.getFrontmatter().root).toBe(true);
    expect(rulesyncRule.getBody()).toBe("# Rules\n\nBe kind.");
  });

  it("should only target rules that list gitlabduo or the wildcard", () => {
    const make = (targets: string[]) =>
      new RulesyncRule({
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "a.md",
        frontmatter: { targets: targets as never },
        body: "",
      });
    expect(GitlabduoRule.isTargetedByRulesyncRule(make(["*"]))).toBe(true);
    expect(GitlabduoRule.isTargetedByRulesyncRule(make(["gitlabduo"]))).toBe(true);
    expect(GitlabduoRule.isTargetedByRulesyncRule(make(["cursor"]))).toBe(false);
  });
});
