import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { loadRulesyncSkillOnce, withRulesyncSkillCache } from "./rulesync-skill-cache.js";
import { RulesyncSkill } from "./rulesync-skill.js";

const loaded = { frontmatter: { name: "a" }, body: "body", otherFiles: [] };

describe("loadRulesyncSkillOnce", () => {
  it("loads on every call outside a scope", async () => {
    const load = vi.fn(async () => loaded);

    await loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load });
    await loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads each skill directory once inside a scope", async () => {
    const load = vi.fn(async () => loaded);

    await withRulesyncSkillCache(async () => {
      await loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load });
      await loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load });
      await loadRulesyncSkillOnce({ skillDirPath: "/skills/b", load });
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails every call the same way when the load failed", async () => {
    const load = vi.fn(async () => {
      throw new Error("broken skill");
    });

    await withRulesyncSkillCache(async () => {
      await expect(loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load })).rejects.toThrow(
        "broken skill",
      );
      await expect(loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load })).rejects.toThrow(
        "broken skill",
      );
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts each scope empty", async () => {
    const load = vi.fn(async () => loaded);

    await withRulesyncSkillCache(() => loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load }));
    await withRulesyncSkillCache(() => loadRulesyncSkillOnce({ skillDirPath: "/skills/a", load }));

    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("RulesyncSkill.fromDir inside withRulesyncSkillCache", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("gives each caller its own frontmatter and companion file list", async () => {
    const skillsDir = join(testDir, ".rulesync", "skills");
    await writeFileContent(
      join(skillsDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill\nclaudecode:\n  model: opus\n---\nBody\n",
    );
    await writeFileContent(join(skillsDir, "my-skill", "notes.md"), "notes\n");

    const [first, second] = await withRulesyncSkillCache(async () => [
      await RulesyncSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" }),
      await RulesyncSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" }),
    ]);

    expect(second.getFrontmatter()).toEqual(first.getFrontmatter());
    expect(second.getFrontmatter()).not.toBe(first.getFrontmatter());
    expect(second.getFrontmatter().claudecode).not.toBe(first.getFrontmatter().claudecode);
    expect(second.getOtherFiles()).toEqual(first.getOtherFiles());
    expect(second.getOtherFiles()).not.toBe(first.getOtherFiles());
    expect(second.getBody()).toBe("Body");
  });
});
