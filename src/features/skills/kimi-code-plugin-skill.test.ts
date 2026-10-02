import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { KimiCodePluginSkill } from "./kimi-code-plugin-skill.js";
import { KimiCodeSkill } from "./kimi-code-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("KimiCodePluginSkill", () => {
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

  it("writes into the plugin's skills/ directory, while kimi-code keeps .kimi-code/skills/", () => {
    const rulesyncSkill = buildRulesyncSkill(["*"]);

    const pluginSkill = KimiCodePluginSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
    });
    const projectSkill = KimiCodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

    expect(pluginSkill).toBeInstanceOf(KimiCodePluginSkill);
    expect(pluginSkill.getRelativeDirPath()).toBe("skills");
    expect(projectSkill.getRelativeDirPath()).toBe(join(".kimi-code", "skills"));
  });

  it("imports a plugin skill into the project's .rulesync/, not into the plugin root", async () => {
    await writeFileContent(
      join(testDir, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\nReview the changes.\n",
    );

    const skill = await KimiCodePluginSkill.fromDir({ outputRoot: testDir, dirName: "review" });
    const rulesyncSkill = skill.toRulesyncSkill();

    expect(skill).toBeInstanceOf(KimiCodePluginSkill);
    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(rulesyncSkill.getOutputRoot()).toBe(".");
    expect(rulesyncSkill.getFrontmatter()).toMatchObject({
      name: "review",
      description: "Review code",
    });
  });

  it("reads a flat skill file as a plugin skill", async () => {
    await writeFileContent(
      join(testDir, "skills", "triage.md"),
      "---\ndescription: Triage issues\n---\nTriage the issue.\n",
    );

    const skill = await KimiCodePluginSkill.fromFlatFile({
      outputRoot: testDir,
      relativeDirPath: "skills",
      relativeFilePath: "triage.md",
    });

    expect(skill).toBeInstanceOf(KimiCodePluginSkill);
    expect(skill.toRulesyncSkill().getOutputRoot()).toBe(".");
  });

  it("is targeted by the wildcard and by kimi-code-plugin, not by kimi-code alone", () => {
    expect(KimiCodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["*"]))).toBe(true);
    expect(
      KimiCodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["kimi-code-plugin"])),
    ).toBe(true);
    expect(KimiCodePluginSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["kimi-code"]))).toBe(
      false,
    );
    expect(KimiCodeSkill.isTargetedByRulesyncSkill(buildRulesyncSkill(["kimi-code-plugin"]))).toBe(
      false,
    );
  });
});
