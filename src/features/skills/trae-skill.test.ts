import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { TraeSkill } from "./trae-skill.js";

describe("TraeSkill", () => {
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

  const makeRulesyncSkill = (targets: string[]) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "daily-report",
      frontmatter: {
        name: "daily-report",
        description: "Prepare a daily report",
        targets,
      },
      body: "Summarize my TODO items.",
      validate: true,
    });

  it("should resolve .trae/skills for both scopes", () => {
    expect(TraeSkill.getSettablePaths().relativeDirPath).toBe(join(".trae", "skills"));
    expect(TraeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".trae", "skills"),
    );
  });

  it("should be targeted by trae and wildcard skills only", () => {
    expect(TraeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["trae"]))).toBe(true);
    expect(TraeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(TraeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });

  it("should write a SKILL.md with name and description into .trae/skills", () => {
    const skill = TraeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["trae"]),
    });

    expect(skill).toBeInstanceOf(TraeSkill);
    expect(skill.getDirPath()).toBe(join(testDir, ".trae", "skills", "daily-report"));
    expect(skill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(skill.getBody()).toBe("Summarize my TODO items.");
  });

  it("should import a skill from .trae/skills back into rulesync", async () => {
    await writeFileContent(
      join(testDir, ".trae", "skills", "daily-report", "SKILL.md"),
      "---\nname: daily-report\ndescription: Prepare a daily report\n---\n\nSummarize my TODO items.\n",
    );

    const skill = await TraeSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    const rulesyncSkill = skill.toRulesyncSkill();

    expect(skill).toBeInstanceOf(TraeSkill);
    expect(rulesyncSkill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(rulesyncSkill.getBody()).toBe("Summarize my TODO items.");
  });
});
