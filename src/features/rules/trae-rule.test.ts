import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
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

  it("should build a deletion placeholder", () => {
    const rule = TraeRule.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".trae", "rules"),
      relativeFilePath: "a.md",
    });
    expect(rule.getFilePath()).toBe(join(testDir, ".trae", "rules", "a.md"));
  });
});
