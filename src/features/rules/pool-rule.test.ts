import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { PoolRule } from "./pool-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("PoolRule", () => {
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
      frontmatter: { root: true, targets: ["pool"], description: "Project context" },
      body: "Use the project conventions.",
    });

    const poolRule = PoolRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(poolRule.getRelativeDirPath()).toBe(".");
    expect(poolRule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(poolRule.getFileContent()).toBe("Use the project conventions.");
  });

  it("should write global root rules to .config/poolside/AGENTS.md", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "overview.md",
      frontmatter: { root: true, targets: ["pool"] },
      body: "Global Pool context.",
    });

    const poolRule = PoolRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule,
      global: true,
    });

    expect(poolRule.getRelativeDirPath()).toBe(join(".config", "poolside"));
    expect(poolRule.getRelativeFilePath()).toBe("AGENTS.md");
  });

  it("should fold plain non-root rules into the root AGENTS.md", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "detail.md",
      frontmatter: { root: false, targets: ["pool"] },
      body: "Non-root rule.",
    });

    expect(PoolRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);

    const poolRule = PoolRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(poolRule.getRelativeDirPath()).toBe(".");
    expect(poolRule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(poolRule.isRoot()).toBe(false);
  });

  it("should write a directory-scoped rule to a nested AGENTS.md", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "packages-api.md",
      frontmatter: {
        root: false,
        targets: ["pool"],
        agentsmd: { subprojectPath: "packages/api" },
      },
      body: "API package conventions.",
    });

    const poolRule = PoolRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(poolRule.getRelativeDirPath()).toBe(join("packages", "api"));
    expect(poolRule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(poolRule.getFileContent()).toBe("API package conventions.");
  });

  it("should fold a directory-scoped rule into the global root, which has no workspace to nest under", () => {
    const rulesyncRule = new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: "packages-api.md",
      frontmatter: {
        root: false,
        targets: ["pool"],
        agentsmd: { subprojectPath: "packages/api" },
      },
      body: "API package conventions.",
    });

    const poolRule = PoolRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule,
      global: true,
    });

    expect(poolRule.getRelativeDirPath()).toBe(join(".config", "poolside"));
    expect(poolRule.getRelativeFilePath()).toBe("AGENTS.md");
  });

  it("should import a nested AGENTS.md under the shared AGENTS.md-derived name", async () => {
    await writeFileContent(
      join(testDir, "packages", "api", "AGENTS.md"),
      "API package conventions.",
    );

    const poolRule = await PoolRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join("packages", "api"),
      relativeFilePath: "AGENTS.md",
    });

    expect(poolRule.isRoot()).toBe(false);

    const rulesyncRule = poolRule.toRulesyncRule();

    // Not suffixed with `-pool`: this is literally the AGENTS.md standard's own
    // per-directory file, so importing it through any target that reads it must
    // produce the same single rulesync rule.
    expect(rulesyncRule.getRelativeFilePath()).toBe("packages-api.md");
    expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
    expect(rulesyncRule.getFrontmatter().agentsmd).toEqual({ subprojectPath: "packages/api" });
    expect(rulesyncRule.getBody()).toBe("API package conventions.");
  });

  it("should import the root file when no nested directory is given", async () => {
    await writeFileContent(join(testDir, "AGENTS.md"), "Root context.");

    const poolRule = await PoolRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "AGENTS.md",
    });

    expect(poolRule.isRoot()).toBe(true);
    expect(poolRule.toRulesyncRule().getFrontmatter().root).toBe(true);
  });

  it("should exclude the root file and vendored trees from the nested scan", () => {
    const patterns = PoolRule.getNestedFilePatterns();

    // Root-relative: the project root travels as `findFilesByGlobs`'s `cwd`, so
    // a root whose name holds a glob metacharacter is read as the directory it is.
    expect(patterns.include).toEqual(["**/AGENTS.md"]);
    expect(patterns.ignore).toContain("AGENTS.md");
    expect(patterns.ignore).toContain("**/node_modules/**");
  });

  it("should treat only the project and global root paths as root on deletion", () => {
    expect(
      PoolRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(true);
    expect(
      PoolRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "poolside"),
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(true);
    expect(
      PoolRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join("packages", "api"),
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(false);
  });

  it("should target root rules with wildcard or pool target", () => {
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

    expect(PoolRule.isTargetedByRulesyncRule(wildcardRule)).toBe(true);
    expect(PoolRule.isTargetedByRulesyncRule(otherRule)).toBe(false);
  });
});
