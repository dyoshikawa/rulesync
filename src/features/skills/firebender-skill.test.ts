import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderSkill } from "./firebender-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("FirebenderSkill", () => {
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

  it("should resolve .firebender/skills for both scopes", () => {
    expect(FirebenderSkill.getSettablePaths().relativeDirPath).toBe(join(".firebender", "skills"));
    expect(FirebenderSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".firebender", "skills"),
    );
  });

  it("should be targeted by firebender and wildcard skills only", () => {
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["firebender"]))).toBe(true);
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });

  it("should write a SKILL.md with name and description into .firebender/skills", () => {
    const skill = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["firebender"]),
    });

    expect(skill).toBeInstanceOf(FirebenderSkill);
    expect(skill.getDirPath()).toBe(join(testDir, ".firebender", "skills", "daily-report"));
    expect(skill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(skill.getBody()).toBe("Summarize my TODO items.");
  });

  it("should import a skill from .firebender/skills back into rulesync", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "skills", "daily-report", "SKILL.md"),
      "---\nname: daily-report\ndescription: Prepare a daily report\n---\n\nSummarize my TODO items.\n",
    );

    const skill = await FirebenderSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    const rulesyncSkill = skill.toRulesyncSkill();

    expect(skill).toBeInstanceOf(FirebenderSkill);
    expect(rulesyncSkill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(rulesyncSkill.getBody()).toBe("Summarize my TODO items.");
  });
});
