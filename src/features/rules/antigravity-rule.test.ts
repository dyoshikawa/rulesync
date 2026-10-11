import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { findFilesByGlobs, toPosixPath, writeFileContent } from "../../utils/file.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";
import { extractAntigravitySubprojectPath } from "./antigravity-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

function buildRulesyncRule({
  testDir,
  frontmatter,
  relativeFilePath = "api.md",
}: {
  testDir: string;
  frontmatter: Partial<RulesyncRuleFrontmatter>;
  relativeFilePath?: string;
}): RulesyncRule {
  return new RulesyncRule({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], ...frontmatter },
    body: "Rule body",
  });
}

describe("extractAntigravitySubprojectPath", () => {
  it.each([
    [
      join("packages", "api", ".agents", "rules"),
      { subprojectPath: "packages/api", innerDirPath: "" },
    ],
    [
      join("packages", "api", ".agents", "rules", "sub"),
      { subprojectPath: "packages/api", innerDirPath: "sub" },
    ],
  ])("splits %s", (relativeDirPath, expected) => {
    expect(extractAntigravitySubprojectPath(relativeDirPath)).toEqual(expected);
  });

  it.each([
    join(".agents", "rules"),
    ".",
    join("packages", "api"),
    join(".worktrees", "feature", ".agents", "rules"),
  ])("does not treat %s as a nested rules directory", (relativeDirPath) => {
    expect(extractAntigravitySubprojectPath(relativeDirPath)).toBeUndefined();
  });
});

describe.each([
  ["AntigravityIdeRule", AntigravityIdeRule],
  ["AntigravityCliRule", AntigravityCliRule],
] as const)("%s directory-scoped rules", (_name, RuleClass) => {
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

  it("writes a directory-scoped rule to that directory's .agents/rules", () => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { description: "API", agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(rule.getFilePath()).toBe(join(testDir, "packages", "api", ".agents", "rules", "api.md"));
    expect(rule.getFileContent()).toContain("trigger: always_on");
  });

  it("keeps an unscoped rule in the project-root .agents/rules", () => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({ testDir, frontmatter: {} }),
    });
    expect(rule.getRelativeDirPath()).toBe(join(".agents", "rules"));
  });

  it("never nests the root rule or a global rule", () => {
    const root = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { root: true, agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(root.getRelativeDirPath()).toBe(".");
    const global = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      global: true,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(global.getRelativeDirPath()).toBe(
      RuleClass.getSettablePaths({ global: true }).nonRoot?.relativeDirPath,
    );
  });

  it("imports a nested rule with its subproject and round-trips it", async () => {
    await writeFileContent(
      join(testDir, "packages", "api", ".agents", "rules", "api.md"),
      "---\ntrigger: glob\nglobs: src/**/*.ts\n---\nBody\n",
    );
    const rule = await RuleClass.fromFile({
      outputRoot: testDir,
      relativeDirPath: join("packages", "api", ".agents", "rules"),
      relativeFilePath: "api.md",
    });
    expect(rule.getRelativeDirPath()).toBe(join("packages", "api", ".agents", "rules"));
    const rulesyncRule = rule.toRulesyncRule();
    expect(rulesyncRule.getRelativeFilePath()).toBe("api.md");
    expect(rulesyncRule.getFrontmatter()).toMatchObject({
      targets: ["antigravity-ide", "antigravity-cli"],
      agentsmd: { subprojectPath: "packages/api" },
    });
    // The next generate writes the file back where it came from.
    const regenerated = RuleClass.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    expect(regenerated.getFilePath()).toBe(rule.getFilePath());
  });

  it("flattens a nested rule's file name and keeps its case so it round-trips", async () => {
    const generated = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        relativeFilePath: join("frontend", "codeStyle.md"),
        frontmatter: { agentsmd: { subprojectPath: "packages/web" } },
      }),
    });
    expect(generated.getFilePath()).toBe(
      join(testDir, "packages", "web", ".agents", "rules", "frontend-codeStyle.md"),
    );

    await writeFileContent(
      join(testDir, "packages", "api", ".agents", "rules", "codeStyle.md"),
      "---\ntrigger: always_on\n---\nBody\n",
    );
    const imported = await RuleClass.fromFile({
      outputRoot: testDir,
      relativeDirPath: join("packages", "api", ".agents", "rules"),
      relativeFilePath: "codeStyle.md",
    });
    const regenerated = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: imported.toRulesyncRule(),
    });
    expect(regenerated.getFilePath()).toBe(imported.getFilePath());
  });

  it("does not treat a project-root rule as nested", async () => {
    await writeFileContent(
      join(testDir, ".agents", "rules", "a.md"),
      "---\ntrigger: always_on\n---\nBody\n",
    );
    const rule = await RuleClass.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "rules"),
      relativeFilePath: "a.md",
    });
    const frontmatter = rule.toRulesyncRule().getFrontmatter();
    expect(frontmatter.targets).toEqual(["*"]);
    expect(frontmatter.agentsmd).toBeUndefined();
  });

  it("scans subdirectory .agents/rules but not the root one or hidden directories", async () => {
    for (const path of [
      join(".agents", "rules", "root.md"),
      join("packages", "api", ".agents", "rules", "api.md"),
      join("packages", "api", ".agents", "rules", "sub", "deep.md"),
      join(".worktrees", "feature", ".agents", "rules", "copy.md"),
      join("packages", "api", "node_modules", "dep", ".agents", "rules", "dep.md"),
      join("packages", "api", ".agents", "skills", "s", "SKILL.md"),
    ]) {
      await writeFileContent(join(testDir, path), "Body\n");
    }
    const patterns = RuleClass.getNestedFilePatterns();
    const matched = await findFilesByGlobs(patterns.include, {
      cwd: testDir,
      type: "file",
      ignore: patterns.ignore,
    });
    expect(matched.map((path) => toPosixPath(relative(testDir, path)))).toEqual([
      "packages/api/.agents/rules/api.md",
    ]);
  });
});

describe("AntigravityPluginRule directory-scoped rules", () => {
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

  it("keeps a subproject-scoped rule in the plugin's own rules directory", () => {
    const rule = AntigravityPluginRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(rule.getRelativeDirPath()).toBe("rules");
  });

  it("does not scan the project tree", () => {
    expect(AntigravityPluginRule.getNestedFilePatterns().include).toEqual([]);
  });
});
