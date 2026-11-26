import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { BbSkill } from "./bb-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("BbSkill", () => {
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
      dirName: "release-checklist",
      frontmatter: {
        name: "release-checklist",
        description: "Run the release checklist",
        targets,
      } as never,
      body: "Check every item before tagging.",
      validate: true,
    });

  it("should use .bb/skills in project scope", () => {
    expect(BbSkill.getSettablePaths().relativeDirPath).toBe(join(".bb", "skills"));
  });

  it("should use ~/.bb/skills in global scope", () => {
    expect(BbSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(join(".bb", "skills"));
  });

  it("should write SKILL.md under .bb/skills/<name>", () => {
    const skill = BbSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["bb"]),
    });

    expect(skill).toBeInstanceOf(BbSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".bb", "skills"));
    expect(skill.getDirName()).toBe("release-checklist");
    expect(skill.getFrontmatter()).toMatchObject({
      name: "release-checklist",
      description: "Run the release checklist",
    });
    expect(skill.getMainFile()?.body).toContain("Check every item before tagging.");
  });

  it("should only target bb or wildcard skills", () => {
    expect(BbSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(BbSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["bb"]))).toBe(true);
    expect(BbSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
