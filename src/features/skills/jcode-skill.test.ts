import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { JcodeSkill } from "./jcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("JcodeSkill", () => {
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

  it("should use .jcode/skills in both scopes", () => {
    expect(JcodeSkill.getSettablePaths().relativeDirPath).toBe(join(".jcode", "skills"));
    expect(JcodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".jcode", "skills"),
    );
  });

  it("should write SKILL.md under .jcode/skills/<name>", () => {
    const skill = JcodeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["jcode"]),
    });
    expect(skill).toBeInstanceOf(JcodeSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".jcode", "skills"));
    expect(skill.getDirName()).toBe("release-checklist");
    expect(skill.getFrontmatter()).toMatchObject({
      name: "release-checklist",
      description: "Run the release checklist",
    });
  });

  it("should only target jcode or wildcard skills", () => {
    expect(JcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(JcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["jcode"]))).toBe(true);
    expect(JcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
