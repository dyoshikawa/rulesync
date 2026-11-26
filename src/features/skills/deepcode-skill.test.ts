import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { DeepcodeSkill } from "./deepcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("DeepcodeSkill", () => {
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

  it("should use .agents/skills in both scopes", () => {
    expect(DeepcodeSkill.getSettablePaths().relativeDirPath).toBe(join(".agents", "skills"));
    expect(DeepcodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".agents", "skills"),
    );
  });

  it("should write SKILL.md under .agents/skills/<name>", () => {
    const skill = DeepcodeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["deepcode"]),
    });

    expect(skill).toBeInstanceOf(DeepcodeSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
    expect(skill.getDirName()).toBe("release-checklist");
    expect(skill.getFrontmatter()).toMatchObject({
      name: "release-checklist",
      description: "Run the release checklist",
    });
  });

  it("should only target deepcode or wildcard skills", () => {
    expect(DeepcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(DeepcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["deepcode"]))).toBe(true);
    expect(DeepcodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
