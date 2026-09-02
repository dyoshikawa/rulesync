import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RulesyncSkill } from "../src/features/skills/rulesync-skill.js";

/**
 * The repository root `skills/` directory holds the official skills that users
 * install with `rulesync fetch dyoshikawa/rulesync`. They are hand-authored and
 * never regenerated, so nothing else would catch a `SKILL.md` whose frontmatter
 * stopped satisfying the schema Rulesync itself enforces on fetched skills.
 *
 * This spec asserts against the repository's own committed files rather than a
 * scratch directory, since those files are exactly what it exists to guard. It
 * only reads, so it writes nothing into the working tree.
 */
const OFFICIAL_SKILLS_DIR = "skills";

async function listOfficialSkillDirNames(): Promise<string[]> {
  const entries = await readdir(join(process.cwd(), OFFICIAL_SKILLS_DIR), {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

describe("official skills", () => {
  it("ships at least one skill", async () => {
    expect(await listOfficialSkillDirNames()).not.toHaveLength(0);
  });

  it("has a valid SKILL.md in every skill directory", async () => {
    const dirNames = await listOfficialSkillDirNames();

    for (const dirName of dirNames) {
      const skill = await RulesyncSkill.fromDir({
        relativeDirPath: OFFICIAL_SKILLS_DIR,
        dirName,
      });

      const frontmatter = skill.getFrontmatter();

      // `name` is what every target tool writes the skill out as, so a mismatch
      // with the directory silently renames the skill on install.
      expect(frontmatter.name).toBe(dirName);
      expect(frontmatter.description.length).toBeGreaterThan(0);
      expect(skill.getBody().length).toBeGreaterThan(0);
    }
  });
});
