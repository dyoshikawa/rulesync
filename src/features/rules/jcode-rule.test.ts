import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { JcodeRule } from "./jcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("JcodeRule", () => {
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

  it("should write the prompt overlay in both scopes", () => {
    const expected = { root: { relativeDirPath: ".jcode", relativeFilePath: "prompt-overlay.md" } };
    expect(JcodeRule.getSettablePaths()).toEqual(expected);
    expect(JcodeRule.getSettablePaths({ global: true })).toEqual(expected);
  });

  it("should write a rule body as plain markdown to .jcode/prompt-overlay.md", () => {
    const rule = JcodeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["jcode"] },
        body: "# Project\n\nUse pnpm.",
      }),
    });
    expect(rule.getRelativeDirPath()).toBe(".jcode");
    expect(rule.getRelativeFilePath()).toBe("prompt-overlay.md");
    expect(rule.getFileContent()).toBe("# Project\n\nUse pnpm.");
    expect(rule.isRoot()).toBe(true);
  });

  it("should import the overlay as the root rule", async () => {
    await writeFileContent(join(testDir, ".jcode", "prompt-overlay.md"), "Be terse.");
    const rule = await JcodeRule.fromFile({ outputRoot: testDir, relativeFilePath: "x.md" });
    const rulesyncRule = rule.toRulesyncRule();
    expect(rulesyncRule.getFrontmatter().root).toBe(true);
    expect(rulesyncRule.getBody()).toBe("Be terse.");
  });

  it("should only target jcode or wildcard rules", () => {
    const make = (targets: string[]) =>
      new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { root: false, targets } as never,
        body: "x",
      });
    expect(JcodeRule.isTargetedByRulesyncRule(make(["*"]))).toBe(true);
    expect(JcodeRule.isTargetedByRulesyncRule(make(["jcode"]))).toBe(true);
    expect(JcodeRule.isTargetedByRulesyncRule(make(["cursor"]))).toBe(false);
  });
});
