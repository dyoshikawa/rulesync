import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { writeFileContent } from "../../utils/file.js";
import { AugmentcodePluginRule } from "./augmentcode-plugin-rule.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AugmentcodePluginRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncRule = (targets: RulesyncTargets) =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: {
        root: false,
        targets,
        description: "Review conventions",
        augmentcode: { type: "agent_requested" },
      },
      body: "Review changes before submission.",
    });

  it("writes into the plugin's rules/ directory, while augmentcode keeps .augment/rules/", () => {
    const rulesyncRule = buildRulesyncRule(["*"]);

    const pluginRule = AugmentcodePluginRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule,
    });
    const projectRule = AugmentcodeRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule,
    });

    expect(pluginRule.getRelativeDirPath()).toBe("rules");
    expect(pluginRule.getRelativeFilePath()).toBe("review.md");
    expect(projectRule.getRelativeDirPath()).toBe(join(".augment", "rules"));
  });

  it("keeps the typed type / description frontmatter", () => {
    const pluginRule = AugmentcodePluginRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule(["augmentcode-plugin"]),
    });

    expect(pluginRule.getFrontmatter()).toEqual({
      type: "agent_requested",
      description: "Review conventions",
    });
    expect(pluginRule.getFileContent()).toContain("type: agent_requested");
  });

  it("is targeted only by rules that name augmentcode-plugin or every target", () => {
    expect(
      AugmentcodePluginRule.isTargetedByRulesyncRule(buildRulesyncRule(["augmentcode-plugin"])),
    ).toBe(true);
    expect(AugmentcodePluginRule.isTargetedByRulesyncRule(buildRulesyncRule(["*"]))).toBe(true);
    expect(AugmentcodePluginRule.isTargetedByRulesyncRule(buildRulesyncRule(["augmentcode"]))).toBe(
      false,
    );
    expect(
      AugmentcodeRule.isTargetedByRulesyncRule(buildRulesyncRule(["augmentcode-plugin"])),
    ).toBe(false);
  });

  it("reads a rule from the plugin's rules/ directory and round-trips its frontmatter", async () => {
    await writeFileContent(
      join(testDir, "rules", "review.md"),
      "---\ntype: agent_requested\ndescription: Review conventions\n---\nReview changes.\n",
    );

    const pluginRule = await AugmentcodePluginRule.fromFile({
      outputRoot: testDir,
      relativeFilePath: "review.md",
    });

    expect(pluginRule.getRelativeDirPath()).toBe("rules");
    expect(pluginRule.getBody()).toBe("Review changes.");
    const rulesyncFrontmatter = pluginRule.toRulesyncRule().getFrontmatter();
    expect(rulesyncFrontmatter.description).toBe("Review conventions");
    expect(rulesyncFrontmatter.augmentcode).toEqual({
      type: "agent_requested",
      description: "Review conventions",
    });
  });

  it("has only a non-root rules/ directory", () => {
    expect(AugmentcodePluginRule.getSettablePaths()).toEqual({
      nonRoot: { relativeDirPath: "rules" },
    });
  });
});
