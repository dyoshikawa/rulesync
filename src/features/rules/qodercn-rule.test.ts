import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { QoderRule } from "./qoder-rule.js";
import { QodercnRule } from "./qodercn-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

describe("QodercnRule", () => {
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

  const makeRulesyncRule = (
    frontmatter: Partial<RulesyncRuleFrontmatter>,
    body = "Rule body",
    relativeFilePath = "topic.md",
  ) =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: { targets: ["*"], ...frontmatter },
      body,
    });

  it("should share Qoder's project paths and move the user files to ~/.qoder-cn/", () => {
    expect(QodercnRule.getSettablePaths()).toEqual(QoderRule.getSettablePaths());

    const global = QodercnRule.getSettablePaths({ global: true });
    expect(global.root).toEqual({ relativeDirPath: ".qoder-cn", relativeFilePath: "AGENTS.md" });
    expect(global.nonRoot.relativeDirPath).toBe(join(".qoder-cn", "rules"));
  });

  it("should leave Qoder's own user paths unchanged", () => {
    const global = QoderRule.getSettablePaths({ global: true });
    expect(global.root.relativeDirPath).toBe(".qoder");
    expect(global.nonRoot.relativeDirPath).toBe(join(".qoder", "rules"));
  });

  it("should write the same project file content as Qoder, from the qoder section", () => {
    const rulesyncRule = makeRulesyncRule({
      description: "Pick when relevant",
      qoder: { trigger: "model_decision" },
    });
    const qodercn = QodercnRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    const qoder = QoderRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(qodercn).toBeInstanceOf(QodercnRule);
    expect(qodercn.getRelativeDirPath()).toBe(qoder.getRelativeDirPath());
    expect(qodercn.getFileContent()).toBe(qoder.getFileContent());
    expect(qodercn.getFileContent()).toContain("trigger: model_decision");
  });

  it("should write global topic rules and output styles under ~/.qoder-cn/", () => {
    const topic = QodercnRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule({ globs: ["src/**"] }),
      global: true,
    });
    expect(topic.getRelativeDirPath()).toBe(join(".qoder-cn", "rules"));

    const style = QodercnRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: makeRulesyncRule(
        { targets: ["qodercn"], qoder: { channel: "output-style" } },
        "Be terse",
        "terse.md",
      ),
      global: true,
    });
    expect(style.getRelativeDirPath()).toBe(join(".qoder-cn", "output-styles"));
    expect(QodercnRule.getExtraFixedFiles({ global: true })[0]?.relativeDirPath).toBe(
      join(".qoder-cn", "output-styles"),
    );
  });

  it("should be targeted by qodercn, not by qoder", () => {
    expect(QodercnRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["qodercn"] }))).toBe(
      true,
    );
    expect(QodercnRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["qoder"] }))).toBe(
      false,
    );
    expect(QoderRule.isTargetedByRulesyncRule(makeRulesyncRule({ targets: ["qodercn"] }))).toBe(
      false,
    );
  });

  it("should import a global topic rule from ~/.qoder-cn/rules/ as a non-root rule", async () => {
    await writeFileContent(
      join(testDir, ".qoder-cn", "rules", "AGENTS.md"),
      "---\ntrigger: glob\nglob: src/**\n---\n\nTopic body\n",
    );

    const rule = await QodercnRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".qoder-cn", "rules"),
      relativeFilePath: "AGENTS.md",
      global: true,
    });

    expect(rule.isRoot()).toBe(false);
    expect(rule.toRulesyncRule().getFrontmatter().globs).toEqual(["src/**"]);
  });

  it("should import a global output style with targets: [qodercn]", async () => {
    await writeFileContent(
      join(testDir, ".qoder-cn", "output-styles", "terse.md"),
      "---\ndescription: Terse\n---\n\nBe terse\n",
    );

    const rule = await QodercnRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".qoder-cn", "output-styles"),
      relativeFilePath: "terse.md",
      global: true,
    });

    expect(rule.toRulesyncRule().getFrontmatter()).toMatchObject({
      targets: ["qodercn"],
      qoder: { channel: "output-style" },
    });
  });

  it("should not treat a topic rule named AGENTS.md under ~/.qoder-cn/rules/ as a root file on deletion", () => {
    const rule = QodercnRule.forDeletion({
      outputRoot: testDir,
      relativeDirPath: join(".qoder-cn", "rules"),
      relativeFilePath: "AGENTS.md",
    });
    expect(rule.isRoot()).toBe(false);
  });

  it("should not warn about an output style that targets both qoder and qodercn", () => {
    const warnings = QodercnRule.getRuleOptionWarnings([
      makeRulesyncRule({ targets: ["qoder", "qodercn"], qoder: { channel: "output-style" } }),
    ]);
    expect(warnings).toEqual([]);
  });

  it("should warn about an output style that also targets other tools", () => {
    const warnings = QodercnRule.getRuleOptionWarnings([
      makeRulesyncRule({ targets: ["qodercn", "cursor"], qoder: { channel: "output-style" } }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('targets: ["qodercn"]');
    expect(warnings[0]).toContain("Qoder CN");
  });
});
