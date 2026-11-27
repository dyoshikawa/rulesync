import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { GajaecodeSkill } from "./gajaecode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("GajaecodeSkill", () => {
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
        gajaecode: { "allowed-tools": ["Bash"], license: "MIT" },
        pi: { "allowed-tools": ["Read"] },
      } as never,
      body: "Test body",
      validate: true,
    });

  it("should resolve project and global settable paths under the .gjc dirs", () => {
    expect(GajaecodeSkill.getSettablePaths().relativeDirPath).toBe(join(".gjc", "skills"));
    expect(GajaecodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".gjc", "agent", "skills"),
    );
  });

  it("should be targeted by gajaecode and wildcard skills only", () => {
    expect(GajaecodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["gajaecode"]))).toBe(true);
    expect(GajaecodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(GajaecodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["pi"]))).toBe(false);
  });

  it("should read the gajaecode section and round-trip it on import", () => {
    const skill = GajaecodeSkill.fromRulesyncSkill({
      rulesyncSkill: makeRulesyncSkill(["gajaecode"]),
    });

    expect(skill).toBeInstanceOf(GajaecodeSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".gjc", "skills"));
    // Pi (and so Gajae-Code) writes `allowed-tools` as the Agent Skills string form.
    expect(skill.getFrontmatter()["allowed-tools"]).toBe("Bash");
    expect(skill.getFrontmatter().license).toBe("MIT");
    expect(skill.toRulesyncSkill().getFrontmatter().gajaecode).toEqual({
      "allowed-tools": ["Bash"],
      license: "MIT",
    });
  });

  it("should load a skill directory from .gjc/skills", async () => {
    await writeFileContent(
      join(testDir, ".gjc", "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: Test skill description\n---\nTest body\n",
    );

    const skill = await GajaecodeSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

    expect(skill).toBeInstanceOf(GajaecodeSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".gjc", "skills"));
    expect(skill.getBody()).toBe("Test body");
  });
});
