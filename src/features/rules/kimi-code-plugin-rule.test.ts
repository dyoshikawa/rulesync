import { describe, expect, it } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { KimiCodePluginRule } from "./kimi-code-plugin-rule.js";
import { KimiCodeRule } from "./kimi-code-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KimiCodePluginRule", () => {
  const buildRulesyncRule = ({
    targets = ["*"],
    root = true,
    localRoot = false,
  }: {
    targets?: Array<ToolTarget | "*">;
    root?: boolean;
    localRoot?: boolean;
  } = {}) =>
    new RulesyncRule({
      outputRoot: ".",
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "overview.md",
      frontmatter: { root, localRoot, targets, globs: ["**/*"] },
      body: "Always follow the review checklist.",
    });

  it("writes the plugin's SYSTEM.md, while kimi-code keeps .kimi-code/AGENTS.md", () => {
    const rulesyncRule = buildRulesyncRule();

    const pluginRule = KimiCodePluginRule.fromRulesyncRule({ outputRoot: "plugin", rulesyncRule });

    expect(pluginRule).toBeInstanceOf(KimiCodePluginRule);
    expect(pluginRule.getRelativeDirPath()).toBe(".");
    expect(pluginRule.getRelativeFilePath()).toBe("SYSTEM.md");
    expect(pluginRule.getFileContent()).toBe("Always follow the review checklist.");
    expect(KimiCodeRule.getSettablePaths().root.relativeFilePath).toBe("AGENTS.md");
  });

  it("imports SYSTEM.md into the project's .rulesync/, not into the plugin root", () => {
    const pluginRule = KimiCodePluginRule.fromRulesyncRule({
      outputRoot: "plugin",
      rulesyncRule: buildRulesyncRule(),
    });

    const rulesyncRule = pluginRule.toRulesyncRule();

    expect(rulesyncRule.getOutputRoot()).toBe(".");
    expect(rulesyncRule.getFrontmatter().root).toBe(true);
    expect(rulesyncRule.getBody()).toBe("Always follow the review checklist.");
  });

  it("marks only SYSTEM.md at the plugin root as the root file for deletion", () => {
    expect(
      KimiCodePluginRule.forDeletion({
        outputRoot: "plugin",
        relativeDirPath: ".",
        relativeFilePath: "SYSTEM.md",
      }).isRoot(),
    ).toBe(true);
    expect(
      KimiCodePluginRule.forDeletion({
        outputRoot: "plugin",
        relativeDirPath: ".kimi-code",
        relativeFilePath: "AGENTS.md",
      }).isRoot(),
    ).toBe(false);
  });

  it("is targeted by the wildcard and by kimi-code-plugin, not by kimi-code alone", () => {
    expect(KimiCodePluginRule.isTargetedByRulesyncRule(buildRulesyncRule())).toBe(true);
    expect(
      KimiCodePluginRule.isTargetedByRulesyncRule(
        buildRulesyncRule({ targets: ["kimi-code-plugin"] }),
      ),
    ).toBe(true);
    expect(
      KimiCodePluginRule.isTargetedByRulesyncRule(buildRulesyncRule({ targets: ["kimi-code"] })),
    ).toBe(false);
  });

  it("never ships a localRoot rule in the bundle", () => {
    expect(
      KimiCodePluginRule.isTargetedByRulesyncRule(
        buildRulesyncRule({ root: false, localRoot: true }),
      ),
    ).toBe(false);
  });
});
