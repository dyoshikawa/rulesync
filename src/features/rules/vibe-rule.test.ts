import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { VibeRule } from "./vibe-rule.js";

describe("VibeRule", () => {
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

  it("should write project root rules to ./AGENTS.md", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["vibe"], description: "Project context" },
      body: "Use the project conventions.",
    });

    const vibeRule = VibeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(vibeRule.getRelativeDirPath()).toBe(".");
    expect(vibeRule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(vibeRule.getFileContent()).toBe("Use the project conventions.");
  });

  it("should write global root rules to .vibe/AGENTS.md", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["vibe"] },
      body: "Global Vibe context.",
    });

    const vibeRule = VibeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule,
      global: true,
    });

    expect(vibeRule.getRelativeDirPath()).toBe(".vibe");
    expect(vibeRule.getRelativeFilePath()).toBe("AGENTS.md");
  });

  it("should ignore non-root rules even when targeted to vibe", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "detail.md",
      frontmatter: { root: false, targets: ["vibe"] },
      body: "Non-root rule.",
    });

    expect(VibeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    expect(() => VibeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule })).toThrow(
      /only supports root rules/,
    );
  });

  it("should target root rules with wildcard or vibe target", () => {
    const wildcardRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["*"] },
      body: "Root rule.",
    });
    const otherRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["zed"] },
      body: "Root rule.",
    });

    expect(VibeRule.isTargetedByRulesyncRule(wildcardRule)).toBe(true);
    expect(VibeRule.isTargetedByRulesyncRule(otherRule)).toBe(false);
  });
});
