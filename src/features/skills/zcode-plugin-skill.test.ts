import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ZcodePluginSkill } from "./zcode-plugin-skill.js";
import { ZcodeSkill } from "./zcode-skill.js";

describe("ZcodePluginSkill", () => {
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

  it("writes into the plugin's skills/ directory, while zcode keeps .zcode/skills/", () => {
    const rulesyncSkill = buildRulesyncSkill(["*"]);

    const pluginSkill = ZcodePluginSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
    const projectSkill = ZcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

    expect(pluginSkill.getRelativeDirPath()).toBe("skills");
    expect(projectSkill.getRelativeDirPath()).toBe(join(".zcode", "skills"));
  });

  it("reads a skill back from the plugin's skills/ directory", async () => {
    await writeFileContent(
      join(testDir, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code\nwhen_to_use: Before merging\n---\nReview the changes.\n",
    );

    const skill = await ZcodePluginSkill.fromDir({ outputRoot: testDir, dirName: "review" });

    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(skill.toRulesyncSkill().getFrontmatter()).toMatchObject({
      name: "review",
      zcode: { when_to_use: "Before merging" },
    });
  });

  it("is targeted by the wildcard and by zcode-plugin, not by zcode alone", () => {
    expect(ZcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["*"]))).toBe(true);
    expect(ZcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["zcode-plugin"]))).toBe(
      true,
    );
    expect(ZcodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["zcode"]))).toBe(false);
  });
});
