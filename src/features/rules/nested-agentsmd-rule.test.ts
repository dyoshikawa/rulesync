import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { NestedAgentsmdRule, NestedAgentsmdRuleFamily } from "./nested-agentsmd-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

class FamilyRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: ".family", toolTarget: "pool" };
  }
}

describe("NestedAgentsmdRule", () => {
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

  it("should refuse to be used without a family", () => {
    expect(() => NestedAgentsmdRule.getSettablePaths({ global: true })).toThrow(
      "Please implement this method in the subclass.",
    );
    expect(() =>
      NestedAgentsmdRule.forDeletion({ relativeDirPath: ".family", relativeFilePath: "AGENTS.md" }),
    ).toThrow("Please implement this method in the subclass.");
  });

  it("should build instances of the concrete subclass with its global directory", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["pool"] },
      body: "Global context.",
    });

    const rule = FamilyRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule, global: true });

    expect(rule).toBeInstanceOf(FamilyRule);
    expect(rule.getRelativeDirPath()).toBe(".family");
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(
      FamilyRule.forDeletion({
        relativeDirPath: ".family",
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(true);
  });

  it("should select rules by the family's tool target", () => {
    const targeted = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "a.md",
      frontmatter: { targets: ["pool"] },
      body: "",
    });
    const other = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "b.md",
      frontmatter: { targets: ["vibe"] },
      body: "",
    });

    expect(FamilyRule.isTargetedByRulesyncRule(targeted)).toBe(true);
    expect(FamilyRule.isTargetedByRulesyncRule(other)).toBe(false);
  });
});
