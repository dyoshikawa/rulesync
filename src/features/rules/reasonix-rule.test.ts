import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReasonixRule } from "./reasonix-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("ReasonixRule", () => {
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
    it("should target REASONIX.md at the project root in project mode", () => {
      const { root } = ReasonixRule.getSettablePaths();
      expect(root).toEqual({ relativeDirPath: ".", relativeFilePath: "REASONIX.md" });
    });

    it("should target .reasonix/REASONIX.md in global mode", () => {
      const { root } = ReasonixRule.getSettablePaths({ global: true });
      expect(root).toEqual({ relativeDirPath: ".reasonix", relativeFilePath: "REASONIX.md" });
    });
  });

  describe("fromFile", () => {
    it("should load the root REASONIX.md regardless of the requested relativeFilePath", async () => {
      const content = "# Reasonix Instructions\n\nSingle source of truth.";
      await writeFileContent(join(testDir, "REASONIX.md"), content);

      const rule = await ReasonixRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("REASONIX.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should load the global REASONIX.md from .reasonix/", async () => {
      const content = "# Global Reasonix Instructions";
      await writeFileContent(join(testDir, ".reasonix", "REASONIX.md"), content);

      const rule = await ReasonixRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "REASONIX.md",
        global: true,
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".reasonix");
    });
  });

  describe("fromRulesyncRule / toRulesyncRule", () => {
    it("should emit the rule body to REASONIX.md and round-trip back", () => {
      const body = "# Team Rules\n\nAlways write tests.";
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: { root: true, targets: ["*"], description: "", globs: ["**/*"] },
        body,
        validate: false,
      });

      const rule = ReasonixRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
      expect(rule.getRelativeFilePath()).toBe("REASONIX.md");
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getFileContent()).toBe(body);

      const back = rule.toRulesyncRule();
      expect(back.getBody()).toBe(body);
    });
  });

  describe("nested instruction files (Context Engine v2)", () => {
    const makeScopedRule = (subprojectPath: string) =>
      new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "api-rules.md",
        frontmatter: {
          root: false,
          targets: ["reasonix"],
          description: "API rules",
          globs: [`${subprojectPath}/**/*`],
          agentsmd: { subprojectPath },
        },
        body: "# API rules",
        validate: false,
      });

    it("should emit a directory-scoped rule as nested <dir>/REASONIX.md", () => {
      const rule = ReasonixRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeScopedRule("packages/api"),
      });

      expect(rule.getRelativeDirPath()).toBe(join("packages", "api"));
      expect(rule.getRelativeFilePath()).toBe("REASONIX.md");
      expect(rule.isRoot()).toBe(false);
      expect(rule.getFileContent()).toBe("# API rules");
    });

    it("should ignore subprojectPath in global mode (no workspace to nest under)", () => {
      const rule = ReasonixRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeScopedRule("packages/api"),
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(".reasonix");
      expect(rule.getRelativeFilePath()).toBe("REASONIX.md");
    });

    it("should import a nested file back to a reasonix-scoped rulesync rule", async () => {
      await writeFileContent(join(testDir, "packages", "api", "REASONIX.md"), "# Nested");

      const rule = await ReasonixRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join("packages", "api"),
        relativeFilePath: "REASONIX.md",
      });
      expect(rule.isRoot()).toBe(false);

      const rulesyncRule = rule.toRulesyncRule();
      expect(rulesyncRule.getRelativeFilePath()).toBe("packages-api-reasonix.md");
      const frontmatter = rulesyncRule.getFrontmatter();
      expect(frontmatter.targets).toEqual(["reasonix"]);
      expect(frontmatter.root).toBe(false);
      expect(frontmatter.globs).toEqual(["packages/api/**/*"]);
      expect(frontmatter.agentsmd?.subprojectPath).toBe("packages/api");
      expect(rulesyncRule.getBody()).toBe("# Nested");
    });

    it("should refuse to write a nested file outside the project via subprojectPath traversal", () => {
      const rule = ReasonixRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: "evil.md",
          frontmatter: {
            root: false,
            targets: ["reasonix"],
            description: "",
            globs: [],
            agentsmd: { subprojectPath: "../../outside" },
          },
          body: "# Evil",
          validate: false,
        }),
      });

      // AiFile.getFilePath enforces outputRoot containment at write time.
      expect(() => rule.getFilePath()).toThrow(/Path traversal detected/);
    });

    it("should exclude the root file and dependency dirs from the nested scan patterns", () => {
      const patterns = ReasonixRule.getNestedFilePatterns({ outputRoot: "/proj" });
      expect(patterns.include).toEqual(["/proj/**/REASONIX.md"]);
      expect(patterns.ignore).toContain("/proj/REASONIX.md");
      expect(patterns.ignore).toContain("/proj/**/node_modules/**");
      expect(patterns.ignore).toContain("/proj/vendor/**");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should target reasonix for wildcard and explicit targets, not others", () => {
      const make = (targets: ("*" | "reasonix" | "cursor")[]) =>
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: false, targets, description: "", globs: [] },
          body: "x",
          validate: false,
        });

      expect(ReasonixRule.isTargetedByRulesyncRule(make(["*"]))).toBe(true);
      expect(ReasonixRule.isTargetedByRulesyncRule(make(["reasonix"]))).toBe(true);
      expect(ReasonixRule.isTargetedByRulesyncRule(make(["cursor"]))).toBe(false);
    });
  });
});
