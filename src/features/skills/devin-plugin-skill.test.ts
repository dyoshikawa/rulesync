import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { DevinPluginSkill } from "./devin-plugin-skill.js";
import { DevinSkill } from "./devin-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("DevinPluginSkill", () => {
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

  it("writes into the plugin's skills/ directory, while devin keeps .devin/skills/", () => {
    const rulesyncSkill = buildRulesyncSkill(["*"]);

    const pluginSkill = DevinPluginSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
    const projectSkill = DevinSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

    expect(pluginSkill).toBeInstanceOf(DevinPluginSkill);
    expect(pluginSkill.getRelativeDirPath()).toBe("skills");
    expect(projectSkill.getRelativeDirPath()).toBe(join(".devin", "skills"));
  });

  it("reads a skill back from the plugin's skills/ directory", async () => {
    await writeFileContent(
      join(testDir, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\nReview the changes.\n",
    );

    const skill = await DevinPluginSkill.fromDir({ outputRoot: testDir, dirName: "review" });

    expect(skill).toBeInstanceOf(DevinPluginSkill);
    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(skill.toRulesyncSkill().getFrontmatter()).toMatchObject({
      name: "review",
      description: "Review code",
    });
  });

  it("owns every skill directory, since the bundle has no commands sharing skills/", async () => {
    await expect(DevinPluginSkill.isDirOwned()).resolves.toBe(true);
  });

  it("is targeted by the wildcard and by devin-plugin, not by devin alone", () => {
    expect(DevinPluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["*"]))).toBe(true);
    expect(DevinPluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["devin-plugin"]))).toBe(
      true,
    );
    expect(DevinPluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["devin"]))).toBe(false);
    expect(DevinSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["devin-plugin"]))).toBe(false);
  });
});
