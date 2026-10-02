import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinPluginRule } from "./devin-plugin-rule.js";
import { DevinRule } from "./devin-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("DevinPluginRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncRule = ({
    targets = ["*"],
    root = false,
    localRoot,
  }: {
    targets?: RulesyncTargets;
    root?: boolean;
    localRoot?: boolean;
  } = {}) =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: root ? "overview.md" : "review.md",
      frontmatter: {
        root,
        ...(localRoot !== undefined && { localRoot }),
        targets,
        description: "Review conventions",
        globs: ["src/**/*.ts"],
      },
      body: "Review changes before submission.",
    });

  it("writes non-root rules into rules/ with Devin trigger frontmatter", () => {
    const rulesyncRule = buildRulesyncRule();

    const pluginRule = DevinPluginRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    const projectRule = DevinRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

    expect(pluginRule).toBeInstanceOf(DevinPluginRule);
    expect(pluginRule.getRelativeDirPath()).toBe("rules");
    expect(pluginRule.getRelativeFilePath()).toBe("review.md");
    expect(pluginRule.getFrontmatter()).toEqual({ trigger: "glob", globs: "src/**/*.ts" });
    expect(projectRule.getRelativeDirPath()).toBe(join(".devin", "rules"));
  });

  it("writes the root rule to the plugin-root AGENTS.md as plain markdown", () => {
    const pluginRule = DevinPluginRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({ root: true }),
    });

    expect(pluginRule.isRoot()).toBe(true);
    expect(pluginRule.getRelativeDirPath()).toBe(".");
    expect(pluginRule.getRelativeFilePath()).toBe("AGENTS.md");
    expect(pluginRule.getFileContent()).toBe("Review changes before submission.");
  });

  it("reads rules/ files as non-root and AGENTS.md as root", async () => {
    await writeFileContent(
      join(testDir, "rules", "review.md"),
      "---\ntrigger: manual\n---\nManual rule.\n",
    );
    await writeFileContent(join(testDir, "AGENTS.md"), "Always on.\n");

    const nonRoot = await DevinPluginRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: "rules",
      relativeFilePath: "review.md",
    });
    const root = await DevinPluginRule.fromFile({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "AGENTS.md",
    });

    expect(nonRoot.isRoot()).toBe(false);
    expect(nonRoot.getRelativeDirPath()).toBe("rules");
    expect(nonRoot.getFrontmatter()).toEqual({ trigger: "manual" });
    expect(nonRoot.toRulesyncRule().getFrontmatter().devin).toEqual(
      expect.objectContaining({ trigger: "manual" }),
    );
    expect(root.isRoot()).toBe(true);
    expect(root.toRulesyncRule().getBody()).toContain("Always on.");
  });

  it("classifies deletion targets by the plugin rules/ directory", () => {
    expect(
      DevinPluginRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "review.md",
      }).isRoot(),
    ).toBe(false);
    expect(
      DevinPluginRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(true);
  });

  it("is targeted only by rules that name devin-plugin or every target, never localRoot ones", () => {
    expect(
      DevinPluginRule.isTargetedByRulesyncRule(buildRulesyncRule({ targets: ["devin-plugin"] })),
    ).toBe(true);
    expect(DevinPluginRule.isTargetedByRulesyncRule(buildRulesyncRule())).toBe(true);
    expect(
      DevinPluginRule.isTargetedByRulesyncRule(buildRulesyncRule({ targets: ["devin"] })),
    ).toBe(false);
    expect(
      DevinRule.isTargetedByRulesyncRule(buildRulesyncRule({ targets: ["devin-plugin"] })),
    ).toBe(false);
    expect(DevinPluginRule.isTargetedByRulesyncRule(buildRulesyncRule({ localRoot: true }))).toBe(
      false,
    );
  });

  it("exposes only project-scope paths", () => {
    expect(DevinPluginRule.getSettablePaths()).toEqual({
      root: { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
      nonRoot: { relativeDirPath: "rules" },
    });
  });
});
