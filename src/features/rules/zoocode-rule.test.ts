import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ZoocodeRule } from "./zoocode-rule.js";

describe("ZoocodeRule", () => {
  it("targets rules addressed to zoocode, not roo", () => {
    const zoocodeRule = new RulesyncRule({
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: { targets: ["zoocode"], root: false },
      body: "# Rule",
    });
    const rooRule = new RulesyncRule({
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: "review.md",
      frontmatter: { targets: ["roo"], root: false },
      body: "# Rule",
    });

    expect(ZoocodeRule.isTargetedByRulesyncRule(zoocodeRule)).toBe(true);
    expect(ZoocodeRule.isTargetedByRulesyncRule(rooRule)).toBe(false);
  });

  it("scopes an imported mode rule to zoocode", () => {
    const imported = new ZoocodeRule({
      relativeDirPath: join(".roo", "rules-architect"),
      relativeFilePath: "review.md",
      fileContent: "# Architect rule",
      root: false,
    }).toRulesyncRule();

    expect(imported.getFrontmatter().targets).toEqual(["zoocode"]);
    expect(imported.getFrontmatter().roo).toEqual({ mode: "architect" });
  });
});
