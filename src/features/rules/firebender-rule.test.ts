import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderRule } from "./firebender-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("FirebenderRule", () => {
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

  const makeRulesyncRule = ({
    relativeFilePath = "kotlin.md",
    root = false,
    globs,
    description,
    targets = ["*"],
  }: {
    relativeFilePath?: string;
    root?: boolean;
    globs?: string[];
    description?: string;
    targets?: RulesyncTargets;
  }) =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: {
        root,
        targets,
        ...(globs !== undefined && { globs }),
        ...(description !== undefined && { description }),
      },
      body: "# Rule\n\nUse coroutines.",
    });

  describe("getSettablePaths", () => {
    it("should use .firebender/AGENTS.md and .firebender/rules in both scopes", () => {
      for (const global of [false, true]) {
        const paths = FirebenderRule.getSettablePaths({ global });
        expect(paths.root).toEqual({
          relativeDirPath: ".firebender",
          relativeFilePath: "AGENTS.md",
        });
        expect(paths.nonRoot.relativeDirPath).toBe(join(".firebender", "rules"));
      }
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write the root rule as plain markdown to .firebender/AGENTS.md", () => {
      const rule = FirebenderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ relativeFilePath: "overview.md", root: true }),
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".firebender");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Rule\n\nUse coroutines.");
    });

    it("should write a glob-scoped rule as an .mdc file with comma-separated globs", () => {
      const rule = FirebenderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({
          globs: ["**/*.kt", "**/*.kts"],
          description: "Kotlin style",
        }),
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".firebender", "rules"));
      expect(rule.getRelativeFilePath()).toBe("kotlin.mdc");
      expect(rule.getFrontmatter()).toEqual({
        alwaysApply: false,
        description: "Kotlin style",
        globs: "**/*.kt, **/*.kts",
      });
      expect(rule.getFileContent()).toContain("alwaysApply: false\n");
      expect(rule.getFileContent()).toContain("description: Kotlin style\n");
      expect(rule.getFileContent()).toContain("globs: '**/*.kt, **/*.kts'\n");
      expect(rule.getFileContent()).toContain("# Rule\n\nUse coroutines.");
    });

    it("should expand brace alternations because Firebender splits globs on commas", () => {
      const rule = FirebenderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ globs: ["src/**/*.{kt,kts}"] }),
      });

      expect(rule.getFrontmatter().globs).toBe("src/**/*.kt, src/**/*.kts");
    });

    it("should mark a rule without specific globs as always applied", () => {
      for (const globs of [undefined, [], ["**/*"]]) {
        const rule = FirebenderRule.fromRulesyncRule({
          outputRoot: testDir,
          rulesyncRule: makeRulesyncRule({ ...(globs !== undefined && { globs }) }),
        });
        expect(rule.getFrontmatter()).toEqual({ alwaysApply: true });
      }
    });

    it("should flatten a multi-line description into one line", () => {
      const rule = FirebenderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ description: "first\nsecond" }),
      });

      expect(rule.getFileContent()).toContain("description: first second\n");
    });
  });

  describe("fromFile and toRulesyncRule", () => {
    it("should import the root .firebender/AGENTS.md as the root rule", async () => {
      await writeFileContent(join(testDir, ".firebender", "AGENTS.md"), "# Project\n");

      const rule = await FirebenderRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: ".firebender",
        relativeFilePath: "AGENTS.md",
      });
      const rulesyncRule = rule.toRulesyncRule();

      expect(rule.isRoot()).toBe(true);
      expect(rulesyncRule.getRelativeFilePath()).toBe("overview.md");
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getBody()).toBe("# Project\n");
    });

    it("should import an .mdc rule with unquoted Cursor-style globs", async () => {
      await writeFileContent(
        join(testDir, ".firebender", "rules", "tests.mdc"),
        "---\ndescription: Guidelines for test files\nglobs: *Test.kt, *Spec.kt\n---\n\n# Tests\n",
      );

      const rule = await FirebenderRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "tests.mdc",
      });
      const rulesyncRule = rule.toRulesyncRule();

      expect(rule.isRoot()).toBe(false);
      expect(rulesyncRule.getRelativeFilePath()).toBe("tests.md");
      expect(rulesyncRule.getFrontmatter()).toMatchObject({
        root: false,
        description: "Guidelines for test files",
        globs: ["*Test.kt", "*Spec.kt"],
      });
      expect(rulesyncRule.getBody()).toBe("# Tests");
    });

    it("should import an always-applied rule and a rule without frontmatter as **/*", async () => {
      await writeFileContent(
        join(testDir, ".firebender", "rules", "always.mdc"),
        '---\nalwaysApply: true\nglobs: "*.kt"\n---\n\nAlways.\n',
      );
      await writeFileContent(join(testDir, ".firebender", "rules", "plain.mdc"), "Plain.\n");

      for (const relativeFilePath of ["always.mdc", "plain.mdc"]) {
        const rule = await FirebenderRule.fromFile({ outputRoot: testDir, relativeFilePath });
        expect(rule.toRulesyncRule().getFrontmatter().globs).toEqual(["**/*"]);
      }
    });

    it("should round-trip a generated rule", async () => {
      const generated = FirebenderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ globs: ["*.kt"], description: "Kotlin" }),
      });
      await writeFileContent(generated.getFilePath(), generated.getFileContent());

      const imported = await FirebenderRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "kotlin.mdc",
      });

      expect(imported.getFrontmatter()).toEqual(generated.getFrontmatter());
      expect(imported.toRulesyncRule().getFrontmatter()).toMatchObject({
        description: "Kotlin",
        globs: ["*.kt"],
      });
    });
  });

  describe("forDeletion", () => {
    it("should recognize the root file", () => {
      expect(
        FirebenderRule.forDeletion({
          outputRoot: testDir,
          relativeDirPath: ".firebender",
          relativeFilePath: "AGENTS.md",
        }).isRoot(),
      ).toBe(true);
      expect(
        FirebenderRule.forDeletion({
          outputRoot: testDir,
          relativeDirPath: join(".firebender", "rules"),
          relativeFilePath: "a.mdc",
        }).isRoot(),
      ).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should be targeted by firebender and wildcard rules only", () => {
      expect(
        FirebenderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["firebender"] })),
      ).toBe(true);
      expect(FirebenderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["*"] }))).toBe(
        true,
      );
      expect(
        FirebenderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["cursor"] })),
      ).toBe(false);
    });
  });
});
