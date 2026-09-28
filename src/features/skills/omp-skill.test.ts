import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OmpSkill } from "./omp-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("OmpSkill", () => {
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
      dirName: "test-skill",
      frontmatter: {
        name: "test-skill",
        description: "Test skill description",
        targets,
        omp: { "allowed-tools": ["Bash"], license: "MIT" },
        pi: { "allowed-tools": ["Read"] },
      } as never,
      body: "Test body",
      validate: true,
    });

  it("should resolve project and global settable paths under the omp dirs", () => {
    expect(OmpSkill.getSettablePaths().relativeDirPath).toBe(join(".omp", "skills"));
    expect(OmpSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".omp", "agent", "skills"),
    );
  });

  it("should be targeted by omp and wildcard skills only", () => {
    expect(OmpSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["omp"]))).toBe(true);
    expect(OmpSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(OmpSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["pi"]))).toBe(false);
  });

  it("should read the omp section and round-trip it on import", () => {
    const skill = OmpSkill.fromRulesyncSkill({ rulesyncSkill: makeRulesyncSkill(["omp"]) });

    expect(skill).toBeInstanceOf(OmpSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".omp", "skills"));
    // Pi (and so oh-my-pi) writes `allowed-tools` as the Agent Skills string form.
    expect(skill.getFrontmatter()["allowed-tools"]).toBe("Bash");
    expect(skill.getFrontmatter().license).toBe("MIT");
    expect(skill.toRulesyncSkill().getFrontmatter().omp).toEqual({
      "allowed-tools": ["Bash"],
      license: "MIT",
    });
  });

  it("should load a skill directory from .omp/skills", async () => {
    await writeFileContent(
      join(testDir, ".omp", "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: Test skill description\n---\nTest body\n",
    );

    const skill = await OmpSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

    expect(skill).toBeInstanceOf(OmpSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".omp", "skills"));
    expect(skill.getBody()).toBe("Test body");
  });
});
