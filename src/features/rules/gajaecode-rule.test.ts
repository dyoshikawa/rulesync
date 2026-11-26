import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GajaecodeRule } from "./gajaecode-rule.js";
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

describe("GajaecodeRule", () => {
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
    it("should return .gjc/AGENTS.md and .gjc/rules for project scope", () => {
      const paths = GajaecodeRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".gjc", relativeFilePath: "AGENTS.md" });
      expect(paths.nonRoot.relativeDirPath).toBe(join(".gjc", "rules"));
    });

    it("should return ~/.gjc/agent/AGENTS.md and ~/.gjc/agent/rules for global scope", () => {
      const paths = GajaecodeRule.getSettablePaths({ global: true });
      expect(paths.root).toEqual({
        relativeDirPath: join(".gjc", "agent"),
        relativeFilePath: "AGENTS.md",
      });
      expect(paths.nonRoot.relativeDirPath).toBe(join(".gjc", "agent", "rules"));
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write the root rule as plain Markdown to .gjc/AGENTS.md", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ root: true, body: "# Root" }),
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getRelativeDirPath()).toBe(".gjc");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Root");
    });

    it("should write a rule without scoped globs as alwaysApply", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["**/*"], description: "Style" }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".gjc", "rules"));
      expect(rule.getFrontmatter()).toEqual({ description: "Style", alwaysApply: true });
      expect(rule.getFileContent()).toContain("alwaysApply: true");
    });

    it("should keep scoped globs and generate a description when none is given", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["src/**/*.ts"] }),
      });

      expect(rule.getFrontmatter()).toEqual({
        description: "Rules for files matching src/**/*.ts",
        globs: ["src/**/*.ts"],
      });
    });

    it("should prefer the rulesync description for a scoped rule", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ globs: ["src/**/*.ts"], description: "TypeScript" }),
      });

      expect(rule.getFrontmatter().description).toBe("TypeScript");
    });
  });

  describe("nested rules", () => {
    it("should flatten a nested rulesync rule into the top-level rules directory", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ relativeFilePath: join("frontend", "style.md") }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".gjc", "rules"));
      expect(rule.getRelativeFilePath()).toBe("frontend-style.md");
    });

    it("should flatten a nested rulesync rule in global scope too", () => {
      const rule = GajaecodeRule.fromRulesyncRule({
        rulesyncRule: buildRule({ relativeFilePath: join("frontend", "style.md") }),
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(join(".gjc", "agent", "rules"));
      expect(rule.getRelativeFilePath()).toBe("frontend-style.md");
    });

    it("should import a .mdc rule as a .md rulesync rule", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "rules", "legacy.mdc"),
        "---\ndescription: Legacy\nglobs: src/**/*.ts\n---\n# Legacy\n",
      );

      const rule = await GajaecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "legacy.mdc",
      });
      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getRelativeFilePath()).toBe("legacy.md");
      expect(rulesyncRule.getFrontmatter()).toMatchObject({
        description: "Legacy",
        globs: ["src/**/*.ts"],
      });
    });
  });

  describe("fromFile / toRulesyncRule", () => {
    it("should import the root context file", async () => {
      await writeFileContent(join(testDir, ".gjc", "AGENTS.md"), "# Root\n");

      const rule = await GajaecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.toRulesyncRule().getRelativeFilePath()).toBe("overview.md");
      expect(rule.toRulesyncRule().getFrontmatter()).toMatchObject({
        root: true,
        globs: ["**/*"],
      });
    });

    it("should treat .gjc/rules/AGENTS.md as a non-root rule", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "rules", "AGENTS.md"),
        "---\nalwaysApply: true\n---\n# Nested\n",
      );

      const rule = await GajaecodeRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".gjc", "rules"),
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getBody()).toBe("# Nested");
    });

    it("should round-trip scoped globs and alwaysApply", async () => {
      await writeFileContent(
        join(testDir, ".gjc", "rules", "ts.md"),
        "---\ndescription: TypeScript\nglobs: src/**/*.ts\n---\n# TS\n",
      );
      await writeFileContent(
        join(testDir, ".gjc", "rules", "always.md"),
        "---\nalwaysApply: true\nglobs: src/**/*.ts\n---\n# Always\n",
      );

      const scoped = await GajaecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "ts.md",
      });
      const always = await GajaecodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "always.md",
      });

      expect(scoped.toRulesyncRule().getFrontmatter()).toMatchObject({
        root: false,
        description: "TypeScript",
        globs: ["src/**/*.ts"],
      });
      expect(always.toRulesyncRule().getFrontmatter().globs).toEqual(["**/*"]);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should be targeted by gajaecode and wildcard rules only", () => {
      expect(GajaecodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["gajaecode"] }))).toBe(
        true,
      );
      expect(GajaecodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["*"] }))).toBe(true);
      expect(GajaecodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["pi"] }))).toBe(false);
    });
  });
});
