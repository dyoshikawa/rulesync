import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AugmentcodePluginSkill } from "./augmentcode-plugin-skill.js";
import { AugmentcodeSkill } from "./augmentcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AugmentcodePluginSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncSkill = (targets: string[]) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "review",
      frontmatter: { name: "review", description: "Review code", targets },
      body: "Review the changes.",
      validate: true,
    });

  it("writes into the plugin's skills/ directory, while augmentcode keeps .augment/skills/", () => {
    const rulesyncSkill = buildRulesyncSkill(["*"]);

    const pluginSkill = AugmentcodePluginSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
    });
    const projectSkill = AugmentcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

    expect(pluginSkill.getRelativeDirPath()).toBe("skills");
    expect(projectSkill.getRelativeDirPath()).toBe(join(".augment", "skills"));
  });

  it("reads a skill back from the plugin's skills/ directory", async () => {
    await writeFileContent(
      join(testDir, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\nReview the changes.\n",
    );

    const skill = await AugmentcodePluginSkill.fromDir({ outputRoot: testDir, dirName: "review" });

    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(skill.getBody()).toBe("Review the changes.");
  });

  it("is targeted by the augmentcode-plugin target and the wildcard only", () => {
    expect(AugmentcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["*"]))).toBe(true);
    expect(
      AugmentcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["augmentcode-plugin"])),
    ).toBe(true);
    expect(
      AugmentcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["augmentcode"])),
    ).toBe(false);
  });
});
