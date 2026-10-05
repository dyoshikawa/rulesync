import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { VibePluginSkill } from "./vibe-plugin-skill.js";
import { VibeSkill } from "./vibe-skill.js";

const buildRulesyncSkill = (name: string, targets: string[] = ["*"]) =>
  new RulesyncSkill({
    outputRoot: ".",
    relativeDirPath: ".rulesync/skills",
    dirName: name,
    frontmatter: { name, description: "A skill", targets } as never,
    body: "Do the thing.",
    validate: false,
  });

describe("VibePluginSkill", () => {
  it("writes into skills/ at the plugin root", () => {
    expect(VibePluginSkill.getSettablePaths()).toEqual({ relativeDirPath: "skills" });

    const skill = VibePluginSkill.fromRulesyncSkill({
      outputRoot: ".",
      rulesyncSkill: buildRulesyncSkill("review"),
    });

    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(skill.getFrontmatter()).toEqual({ name: "review", description: "A skill" });
  });

  it("does not warn about Vibe built-in names, which plugin namespacing avoids", () => {
    const logger = createMockLogger();

    VibePluginSkill.fromRulesyncSkill({
      outputRoot: ".",
      rulesyncSkill: buildRulesyncSkill("skill-creator"),
      logger,
    });
    expect(logger.warn).not.toHaveBeenCalled();

    VibeSkill.fromRulesyncSkill({
      outputRoot: ".",
      rulesyncSkill: buildRulesyncSkill("skill-creator"),
      logger,
    });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("is targeted by the wildcard and vibe-plugin, not by vibe", () => {
    expect(VibePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill("a"))).toBe(true);
    expect(
      VibePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill("a", ["vibe-plugin"])),
    ).toBe(true);
    expect(VibePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill("a", ["vibe"]))).toBe(
      false,
    );
  });
});
