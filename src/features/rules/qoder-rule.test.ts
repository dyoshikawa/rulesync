import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { QoderRule } from "./qoder-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

describe("QoderRule", () => {
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

  const makeRulesyncRule = (frontmatter: Partial<RulesyncRuleFrontmatter>, body = "Rule body") =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "topic.md",
      frontmatter: { targets: ["*"], ...frontmatter },
      body,
    });

  it("should place the root rule and topic rules for both scopes", () => {
    const project = QoderRule.getSettablePaths();
    expect(project.root).toEqual({ relativeDirPath: ".", relativeFilePath: "AGENTS.md" });
    expect(project.nonRoot.relativeDirPath).toBe(join(".qoder", "rules"));

    const global = QoderRule.getSettablePaths({ global: true });
    expect(global.root).toEqual({ relativeDirPath: ".qoder", relativeFilePath: "AGENTS.md" });
    expect(global.nonRoot.relativeDirPath).toBe(join(".qoder", "rules"));
  });

  it("should write the root rule as plain markdown", () => {
    const rule = QoderRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({ root: true, description: "Root" }, "# Project"),
    });

    expect(rule.isRoot()).toBe(true);
    expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(rule.getFileContent()).toBe("# Project");
  });

  it("should infer trigger: glob from specific globs", () => {
    const rule = QoderRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({ globs: ["src/api/**", "**/*.test.ts"], description: "API" }),
    });

    expect(rule.getRelativeDirPath()).toBe(join(".qoder", "rules"));
    expect(rule.getFrontmatter()).toEqual({
      trigger: "glob",
      glob: ["src/api/**", "**/*.test.ts"],
      description: "API",
    });
  });

  it("should infer trigger: always_on from a universal glob or no globs", () => {
    for (const globs of [["**/*"], [], undefined]) {
      const rule = QoderRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ globs }),
      });
      expect(rule.getFrontmatter()).toEqual({ trigger: "always_on" });
    }
  });

  it("should let the qoder section override the inferred trigger", () => {
    const rule = QoderRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({
        globs: ["**/*"],
        description: "Use when editing API handlers",
        qoder: { trigger: "model_decision" },
      }),
    });

    expect(rule.getFrontmatter()).toEqual({
      trigger: "model_decision",
      description: "Use when editing API handlers",
    });
  });

  it("should fall back to always_on with a warning for a glob trigger without specific globs", () => {
    const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

    const rule = QoderRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({ globs: ["**/*"], qoder: { trigger: "glob" } }),
    });

    expect(rule.getFrontmatter()).toEqual({ trigger: "always_on" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('qoder.trigger "glob"'));
  });

  it("should warn when a model_decision trigger has no description", () => {
    const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

    const rule = QoderRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({ qoder: { trigger: "model_decision" } }),
    });

    expect(rule.getFrontmatter()).toEqual({ trigger: "model_decision" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('qoder.trigger "model_decision"'));
  });

  it("should keep unmapped keys and an empty glob trigger in the qoder section on import", async () => {
    const rulesDir = join(testDir, ".qoder", "rules");
    await writeFileContent(
      join(rulesDir, "extra.md"),
      "---\ntrigger: glob\nglob: src/**/*.ts\npriority: 3\n---\nExtra body",
    );
    await writeFileContent(join(rulesDir, "empty-glob.md"), "---\ntrigger: glob\n---\nEmpty");

    const load = async (relativeFilePath: string) =>
      (
        await QoderRule.fromFile({
          outputRoot: testDir,
          relativeDirPath: join(".qoder", "rules"),
          relativeFilePath,
        })
      ).toRulesyncRule();

    const extra = await load("extra.md");
    expect(extra.getFrontmatter()).toMatchObject({
      globs: ["src/**/*.ts"],
      qoder: { priority: 3 },
    });
    expect(extra.getFrontmatter().qoder).not.toHaveProperty("trigger");
    expect(
      QoderRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule: extra }).getFrontmatter(),
    ).toEqual({ priority: 3, trigger: "glob", glob: ["src/**/*.ts"] });

    expect((await load("empty-glob.md")).getFrontmatter()).toMatchObject({
      globs: [],
      qoder: { trigger: "glob" },
    });
  });

  it("should import topic rules, resolving the compatibility spellings", async () => {
    const rulesDir = join(testDir, ".qoder", "rules");
    await writeFileContent(
      join(rulesDir, "glob.md"),
      "---\ntrigger: glob\nglob: src/**/*.ts\n---\nGlob body",
    );
    await writeFileContent(join(rulesDir, "paths.md"), "---\npaths:\n  - docs/**\n---\nPaths body");
    await writeFileContent(
      join(rulesDir, "decision.md"),
      "---\ntrigger: model_decision\ndescription: Use for tests\n---\nDecision body",
    );
    await writeFileContent(join(rulesDir, "manual.md"), "---\nalwaysApply: false\n---\nManual");
    await writeFileContent(join(rulesDir, "plain.md"), "Plain body");

    const load = async (relativeFilePath: string) =>
      (
        await QoderRule.fromFile({
          outputRoot: testDir,
          relativeDirPath: join(".qoder", "rules"),
          relativeFilePath,
        })
      )
        .toRulesyncRule()
        .getFrontmatter();

    expect(await load("glob.md")).toMatchObject({ root: false, globs: ["src/**/*.ts"] });
    expect(await load("glob.md")).not.toHaveProperty("qoder");
    expect(await load("paths.md")).toMatchObject({ globs: ["docs/**"] });
    expect(await load("decision.md")).toMatchObject({
      globs: [],
      description: "Use for tests",
      qoder: { trigger: "model_decision" },
    });
    expect(await load("manual.md")).toMatchObject({ globs: [], qoder: { trigger: "manual" } });
    expect(await load("plain.md")).toMatchObject({ globs: ["**/*"] });
  });

  it("should import the root AGENTS.md as the root rule", async () => {
    await writeFileContent(join(testDir, "AGENTS.md"), "# Root\n");

    const rule = await QoderRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "AGENTS.md",
    });

    expect(rule.isRoot()).toBe(true);
    expect(rule.toRulesyncRule().getFrontmatter()).toMatchObject({ root: true, globs: ["**/*"] });
    expect(rule.toRulesyncRule().getRelativeFilePath()).toBe("overview.md");
    expect(rule.toRulesyncRule().getBody()).toBe("# Root");
  });

  it("should treat a topic rule named AGENTS.md inside .qoder/rules as non-root", async () => {
    await writeFileContent(join(testDir, ".qoder", "rules", "AGENTS.md"), "Topic");

    const rule = await QoderRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".qoder", "rules"),
      relativeFilePath: "AGENTS.md",
    });

    expect(rule.isRoot()).toBe(false);
  });

  it("should only target qoder or wildcard rules", () => {
    expect(QoderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["qoder"] }))).toBe(true);
    expect(QoderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["cursor"] }))).toBe(
      false,
    );
  });
});
