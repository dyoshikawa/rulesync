import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OmpRule } from "./omp-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

const buildRule = ({
  targets = ["*"],
  root = false,
  globs,
  description,
  body = "# Test",
  relativeFilePath = "test.md",
}: {
  targets?: string[];
  root?: boolean;
  globs?: string[];
  description?: string;
  body?: string;
  relativeFilePath?: string;
}): RulesyncRule =>
  new RulesyncRule({
    relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { root, targets: targets as never, globs, description },
    body,
    validate: false,
  });

describe("OmpRule", () => {
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

  describe("getSettablePaths", () => {
    it("should return .omp/AGENTS.md and .omp/rules for project scope", () => {
      const paths = OmpRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".omp", relativeFilePath: "AGENTS.md" });
      expect(paths.nonRoot.relativeDirPath).toBe(join(".omp", "rules"));
    });

    it("should return ~/.omp/agent/AGENTS.md and ~/.omp/agent/rules for global scope", () => {
      const paths = OmpRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({
        relativeDirPath: join(".omp", "agent"),
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot.relativeDirPath).toBe(join(".omp", "agent", "rules"));
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write the root rule as plain Markdown to .omp/AGENTS.md", () => {
      const rule = OmpRule.fromRulesyncRule({
        rulesyncRule: buildRule({ root: true, body: "# Root" }),
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".omp");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Root");
    });

    it("should write a rule without scoped globs as alwaysApply", () => {
      const rule = OmpRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["**/*"], description: "Style" }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".omp", "rules"));
      expect(rule.getFrontmatter()).toEqual({ description: "Style", alwaysApply: true });
      expect(rule.getFileContent()).toContain("alwaysApply: true");
    });

    it("should keep scoped globs and generate a description when none is given", () => {
      const rule = OmpRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["src/**/*.ts"] }),
      });

      expect(rule.getFrontmatter()).toEqual({
        description: "Rules for files matching src/**/*.ts",
        globs: ["src/**/*.ts"],
      });
    });

    it("should prefer the rulesync description for a scoped rule", () => {
      const rule = OmpRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["src/**/*.ts"], description: "TypeScript" }),
      });

      expect(rule.getFrontmatter().description).toBe("TypeScript");
    });
  });

  describe("fromFile / toRulesyncRule", () => {
    it("should import the root context file", async () => {
      await writeFileContent(join(testDir, ".omp", "AGENTS.md"), "# Root\n");

      const rule = await OmpRule.fromFile({ outputRoot: testDir, relativeFilePath: "AGENTS.md" });

      expect(rule.isRoot()).toBe(true);
      expect(rule.toRulesyncRule().getRelativeFilePath()).toBe("overview.md");
      expect(rule.toRulesyncRule().getFrontmatter()).toMatchObject({
        root: true,
        globs: ["**/*"],
      });
    });

    it("should treat .omp/rules/AGENTS.md as a non-root rule", async () => {
      await writeFileContent(
        join(testDir, ".omp", "rules", "AGENTS.md"),
        "---\nalwaysApply: true\n---\n# Nested\n",
      );

      const rule = await OmpRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".omp", "rules"),
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getBody()).toBe("# Nested");
    });

    it("should round-trip scoped globs and alwaysApply", async () => {
      await writeFileContent(
        join(testDir, ".omp", "rules", "ts.md"),
        "---\ndescription: TypeScript\nglobs: src/**/*.ts\n---\n# TS\n",
      );
      await writeFileContent(
        join(testDir, ".omp", "rules", "always.md"),
        "---\nalwaysApply: true\nglobs: src/**/*.ts\n---\n# Always\n",
      );

      const scoped = await OmpRule.fromFile({ outputRoot: testDir, relativeFilePath: "ts.md" });
      const always = await OmpRule.fromFile({ outputRoot: testDir, relativeFilePath: "always.md" });

      expect(scoped.toRulesyncRule().getFrontmatter()).toMatchObject({
        root: false,
        description: "TypeScript",
        globs: ["src/**/*.ts"],
      });
      expect(always.toRulesyncRule().getFrontmatter().globs).toEqual(["**/*"]);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should be targeted by omp and wildcard rules only", () => {
      expect(OmpRule.isTargetedByRulesyncRule(buildRule({ targets: ["omp"] }))).toBe(true);
      expect(OmpRule.isTargetedByRulesyncRule(buildRule({ targets: ["*"] }))).toBe(true);
      expect(OmpRule.isTargetedByRulesyncRule(buildRule({ targets: ["pi"] }))).toBe(false);
    });
  });
});
