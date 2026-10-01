import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { findFilesByGlobs, toPosixPath, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { TraeRule } from "./trae-rule.js";

describe("TraeRule", () => {
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

  const generate = (frontmatter: Partial<RulesyncRuleFrontmatter>, relativeFilePath = "a.md") =>
    TraeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath,
        frontmatter: { targets: ["*"], ...frontmatter },
        body: "Rule body",
      }),
    });

  const importFile = async (content: string) => {
    await writeFileContent(join(testDir, ".trae", "rules", "a.md"), content);
    const rule = await TraeRule.fromFile({ outputRoot: testDir, relativeFilePath: "a.md" });
    return rule.toRulesyncRule().getFrontmatter();
  };

  it("should place every rule under .trae/rules", () => {
    expect(TraeRule.getSettablePaths()).toEqual({
      nonRoot: { relativeDirPath: join(".trae", "rules") },
    });
    const rule = generate({ root: true }, "overview.md");
    expect(rule.getFilePath()).toBe(join(testDir, ".trae", "rules", "overview.md"));
    expect(rule.isRoot()).toBe(false);
  });

  it("should write the root rule and universal globs as always applied", () => {
    expect(generate({ root: true, globs: ["**/*"] }).getFileContent()).toBe(
      "---\nalwaysApply: true\n---\n\nRule body",
    );
    expect(generate({ globs: ["**/*"], description: "Style" }).getFileContent()).toBe(
      "---\nalwaysApply: true\ndescription: Style\n---\n\nRule body",
    );
    expect(generate({}).getFrontmatter().alwaysApply).toBe(true);
  });

  it("should write specific globs as an unquoted comma-separated list", () => {
    expect(generate({ globs: ["*.ts", "src/**/*.tsx"] }).getFileContent()).toBe(
      "---\nalwaysApply: false\nglobs: *.ts,src/**/*.tsx\n---\n\nRule body",
    );
  });

  it("should expand brace alternations, since Trae splits globs on every comma", () => {
    const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
    expect(generate({ globs: ["src/**/*.{ts,tsx}", "docs/**"] }).getFileContent()).toBe(
      "---\nalwaysApply: false\nglobs: src/**/*.ts,src/**/*.tsx,docs/**\n---\n\nRule body",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should warn when a glob still contains a comma after expansion", () => {
    const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
    // Nine two-way groups expand to 512 patterns, past the cap, so the glob is kept verbatim.
    const tooMany = `${"{a,b}".repeat(9)}.ts`;
    expect(generate({ globs: [tooMany] }).getFrontmatter().globs).toBe(tooMany);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Trae splits globs on every comma"),
    );
  });

  it("should write a description-only rule as intelligently applied", () => {
    expect(generate({ description: "When writing tests" }).getFileContent()).toBe(
      "---\nalwaysApply: false\ndescription: When writing tests\n---\n\nRule body",
    );
  });

  it("should let trae.alwaysApply override the derived value", () => {
    expect(generate({ trae: { alwaysApply: false } }).getFileContent()).toBe(
      "---\nalwaysApply: false\n---\n\nRule body",
    );
  });

  it("should import an always-applied rule as the universal glob", async () => {
    expect(await importFile("---\nalwaysApply: true\n---\n\nBody\n")).toMatchObject({
      root: false,
      globs: ["**/*"],
    });
  });

  it("should import unquoted and list globs and an empty globs line", async () => {
    expect(await importFile("---\nalwaysApply: false\nglobs: *.py\n---\nBody\n")).toMatchObject({
      globs: ["*.py"],
    });
    expect(
      await importFile("---\nalwaysApply: false\nglobs: src/**/*.{ts,tsx},docs/**\n---\nBody\n"),
    ).toMatchObject({ globs: ["src/**/*.{ts,tsx}", "docs/**"] });
    expect(
      await importFile('---\nalwaysApply: false\nglobs: ["**/*.md", "**/*.mdx"]\n---\nBody\n'),
    ).toMatchObject({ globs: ["**/*.md", "**/*.mdx"] });
    const manual = await importFile("---\nalwaysApply: false\nglobs: \n---\nBody\n");
    expect(manual.globs).toEqual([]);
  });

  it("should carry trae.alwaysApply only when it cannot be derived", async () => {
    const manual = await importFile("---\nalwaysApply: false\n---\nBody\n");
    expect(manual.trae).toEqual({ alwaysApply: false });

    const intelligent = await importFile(
      "---\nalwaysApply: false\ndescription: When testing\n---\nBody\n",
    );
    expect(intelligent.description).toBe("When testing");
    expect(intelligent.trae).toBeUndefined();

    const scopedAlways = await importFile("---\nalwaysApply: true\nglobs: *.ts\n---\nBody\n");
    expect(scopedAlways).toMatchObject({ globs: ["*.ts"], trae: { alwaysApply: true } });
  });

  it("should round-trip the scene field of a commit-message rule", async () => {
    const imported = await importFile(
      "---\nscene: git_message\nalwaysApply: false\n---\nUse Conventional Commits\n",
    );
    expect(imported.trae).toEqual({ alwaysApply: false, scene: "git_message" });
    expect(generate(imported).getFileContent()).toBe(
      "---\nscene: git_message\nalwaysApply: false\n---\n\nRule body",
    );
  });

  it("should write a scene value containing replacement patterns verbatim", () => {
    for (const scene of ["$&$&", "$'", "$`"]) {
      const content = generate({ globs: ["src/**"], trae: { scene } }).getFileContent();
      expect(content.split("\n").slice(0, 5)).toEqual([
        "---",
        `scene: ${scene}`,
        "alwaysApply: false",
        "globs: src/**",
        "---",
      ]);
    }
  });

  it("should keep universal globs on a file-scoped rule through a round trip", async () => {
    const imported = await importFile("---\nalwaysApply: false\nglobs: **/*\n---\nBody\n");
    expect(imported).toMatchObject({ globs: ["**/*"], trae: { alwaysApply: false } });
    expect(generate(imported).getFileContent()).toBe(
      "---\nalwaysApply: false\nglobs: **/*\n---\n\nRule body",
    );
    expect(
      generate({ globs: ["**/*", "*.ts"], trae: { alwaysApply: false } }).getFileContent(),
    ).toBe("---\nalwaysApply: false\nglobs: **/*,*.ts\n---\n\nRule body");
  });

  it("should drop globs on a derived always-applied rule with a mixed glob list", () => {
    expect(generate({ globs: ["**/*", "*.ts"] }).getFileContent()).toBe(
      "---\nalwaysApply: true\n---\n\nRule body",
    );
  });

  it("should import unquoted globs that YAML would otherwise reject", async () => {
    expect(
      await importFile("---\nalwaysApply: false\nglobs: {src,lib}/**/*.ts\n---\nBody\n"),
    ).toMatchObject({ globs: ["{src,lib}/**/*.ts"] });
    expect(
      await importFile("---\nalwaysApply: false\nglobs: !**/test/**\n---\nBody\n"),
    ).toMatchObject({ globs: ["!**/test/**"] });
  });

  it("should import a leading-[ character-class glob but keep flow lists as lists", async () => {
    expect(
      await importFile("---\nalwaysApply: false\nglobs: [abc]*.ts,src/**\n---\nBody\n"),
    ).toMatchObject({ globs: ["[abc]*.ts", "src/**"] });
    expect(
      await importFile("---\nalwaysApply: false\nglobs: [Dd]ocs/*.[mM][dD],[ab],[cd]\n---\nBody\n"),
    ).toMatchObject({ globs: ["[Dd]ocs/*.[mM][dD]", "[ab]", "[cd]"] });
    expect(
      await importFile('---\nalwaysApply: false\nglobs: ["*.ts", "*.md"] # lists\n---\nBody\n'),
    ).toMatchObject({ globs: ["*.ts", "*.md"] });
    expect(
      await importFile('---\nalwaysApply: false\nglobs: [\n  "*.ts",\n  "*.md"\n]\n---\nBody\n'),
    ).toMatchObject({ globs: ["*.ts", "*.md"] });
    expect(
      await importFile('---\nalwaysApply: false\nglobs: ["*.ts",\n  "*.md"]\n---\nBody\n'),
    ).toMatchObject({ globs: ["*.ts", "*.md"] });
    expect(
      await importFile('---\nalwaysApply: false\nglobs: ["a]",\n  "b"]\n---\nBody\n'),
    ).toMatchObject({ globs: ["a]", "b"] });
  });

  it("should trim trailing blanks from an unquoted globs value", async () => {
    expect(
      await importFile(`---\nalwaysApply: false\nglobs: *.ts${" ".repeat(50_000)}\n---\nBody\n`),
    ).toMatchObject({ globs: ["*.ts"] });
  });

  it("should leave YAML null and boolean keywords and block scalars unquoted on import", async () => {
    expect((await importFile("---\nalwaysApply: false\nglobs: null\n---\nBody\n")).globs).toEqual(
      [],
    );
    expect(
      (await importFile("---\nalwaysApply: false\nglobs: null # none\n---\nBody\n")).globs,
    ).toEqual([]);
    expect(await importFile("---\nalwaysApply: false\nglobs: ~\n---\nBody\n")).toMatchObject({
      globs: [],
    });
    expect(
      await importFile("---\nalwaysApply: false\nglobs: |-\n  *.ts,*.tsx\n---\nBody\n"),
    ).toMatchObject({ globs: ["*.ts", "*.tsx"] });
    await writeFileContent(
      join(testDir, ".trae", "rules", "a.md"),
      "---\nalwaysApply: false\nglobs: true\n---\nBody\n",
    );
    await expect(
      TraeRule.fromFile({ outputRoot: testDir, relativeFilePath: "a.md" }),
    ).rejects.toThrow("Invalid frontmatter");
  });

  it("should end the frontmatter where gray-matter does, even at a ---- line", async () => {
    await writeFileContent(
      join(testDir, ".trae", "rules", "a.md"),
      "---\ndescription: Rules\n----\nglobs: *.ts\n---\nBody\n",
    );
    const rule = await TraeRule.fromFile({ outputRoot: testDir, relativeFilePath: "a.md" });
    expect(rule.getFrontmatter().globs).toBeUndefined();
    expect(rule.getBody()).toContain("globs: *.ts");
  });

  it("should leave a globs line in the body untouched on import", async () => {
    await writeFileContent(
      join(testDir, ".trae", "rules", "a.md"),
      "---\ndescription: How to write rules\n---\nExample:\n\nglobs: *.ts\n",
    );
    const rule = await TraeRule.fromFile({ outputRoot: testDir, relativeFilePath: "a.md" });
    expect(rule.getBody()).toBe("Example:\n\nglobs: *.ts");
    expect(rule.getFrontmatter().globs).toBeUndefined();
  });

  it("should reject invalid frontmatter on import", async () => {
    await writeFileContent(
      join(testDir, ".trae", "rules", "a.md"),
      '---\nalwaysApply: "yes"\n---\nBody\n',
    );
    await expect(
      TraeRule.fromFile({ outputRoot: testDir, relativeFilePath: "a.md" }),
    ).rejects.toThrow("Invalid frontmatter");
  });

  it("should flatten a multi-line scene to one line", () => {
    expect(generate({ trae: { scene: "git_\nmessage" } }).getFileContent()).toBe(
      "---\nscene: git_ message\nalwaysApply: true\n---\n\nRule body",
    );
  });

  it("should round-trip a manual rule", async () => {
    const imported = await importFile("---\nalwaysApply: false\n---\nBody\n");
    expect(generate(imported).getFrontmatter().alwaysApply).toBe(false);
  });

  it("should be targeted by trae and wildcard rules only", () => {
    const make = (targets: string[]) =>
      new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: targets as RulesyncRuleFrontmatter["targets"] },
        body: "",
      });
    expect(TraeRule.isTargetedByRulesyncRule(make(["trae"]))).toBe(true);
    expect(TraeRule.isTargetedByRulesyncRule(make(["*"]))).toBe(true);
    expect(TraeRule.isTargetedByRulesyncRule(make(["cursor"]))).toBe(false);
  });

  it("should write a directory-scoped rule to that directory's .trae/rules", () => {
    const rule = generate(
      { description: "API", agentsmd: { subprojectPath: "packages/api" } },
      "api.md",
    );
    expect(rule.getFilePath()).toBe(join(testDir, "packages", "api", ".trae", "rules", "api.md"));
    expect(rule.getFileContent()).toBe(
      "---\nalwaysApply: false\ndescription: API\n---\n\nRule body",
    );
  });

  it("should never nest the root rule or a global rule", () => {
    const root = generate({ root: true, agentsmd: { subprojectPath: "packages/api" } });
    expect(root.getRelativeDirPath()).toBe(join(".trae", "rules"));
    const global = TraeRule.fromRulesyncRule({
      outputRoot: testDir,
      global: true,
      rulesyncRule: new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["*"], agentsmd: { subprojectPath: "packages/api" } },
        body: "Rule body",
      }),
    });
    expect(global.getRelativeDirPath()).toBe(join(".trae", "rules"));
  });

  it("should import a nested rule with its subproject and frontmatter", async () => {
    await writeFileContent(
      join(testDir, "packages", "api", ".trae", "rules", "sub", "api.md"),
      "---\nalwaysApply: true\nscene: git_message\n---\nBody\n",
    );
    const rule = await TraeRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join("packages", "api", ".trae", "rules", "sub"),
      relativeFilePath: "api.md",
    });
    expect(rule.getRelativeDirPath()).toBe(join("packages", "api", ".trae", "rules"));
    expect(rule.getRelativeFilePath()).toBe(join("sub", "api.md"));
    const rulesyncRule = rule.toRulesyncRule();
    expect(rulesyncRule.getRelativeFilePath()).toBe(join("sub", "api.md"));
    expect(rulesyncRule.getFrontmatter()).toMatchObject({
      targets: ["trae"],
      globs: ["**/*"],
      agentsmd: { subprojectPath: "packages/api" },
      trae: { scene: "git_message" },
    });
    // Round trip: the next generate writes the file back where it came from.
    const regenerated = TraeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    expect(regenerated.getFilePath()).toBe(rule.getFilePath());
    expect(regenerated.getFrontmatter().alwaysApply).toBe(true);
  });

  it("should not treat project-root rules as nested", async () => {
    await writeFileContent(join(testDir, ".trae", "rules", "a.md"), "Body\n");
    const rule = await TraeRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".trae", "rules"),
      relativeFilePath: "a.md",
    });
    const frontmatter = rule.toRulesyncRule().getFrontmatter();
    expect(frontmatter.targets).toEqual(["*"]);
    expect(frontmatter.agentsmd).toBeUndefined();
  });

  it("should scan subdirectory .trae/rules but not the root one or hidden directories", async () => {
    for (const path of [
      join(".trae", "rules", "root.md"),
      join("packages", "api", ".trae", "rules", "api.md"),
      join("packages", "api", ".trae", "rules", "sub", "deep.md"),
      join(".worktrees", "feature", ".trae", "rules", "copy.md"),
      join("packages", "api", "node_modules", "dep", ".trae", "rules", "dep.md"),
      join("dist", ".trae", "rules", "built.md"),
    ]) {
      await writeFileContent(join(testDir, path), "Body\n");
    }
    const patterns = TraeRule.getNestedFilePatterns();
    const matched = await findFilesByGlobs(patterns.include, {
      cwd: testDir,
      type: "file",
      ignore: patterns.ignore,
    });
    expect(matched.map((path) => toPosixPath(relative(testDir, path))).toSorted()).toEqual([
      "packages/api/.trae/rules/api.md",
      "packages/api/.trae/rules/sub/deep.md",
    ]);
  });

  it("should build a deletion placeholder", () => {
    const rule = TraeRule.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".trae", "rules"),
      relativeFilePath: "a.md",
    });
    expect(rule.getFilePath()).toBe(join(testDir, ".trae", "rules", "a.md"));
  });
});
