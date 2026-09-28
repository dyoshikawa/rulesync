import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GitlabduoSkill } from "./gitlabduo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("GitlabduoSkill", () => {
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
        metadata: { "slash-command": "enabled" },
      } as never,
      body: "Summarize my TODO items.",
      validate: true,
    });

  it("should resolve skills/ for the project and .gitlab/duo/skills globally", () => {
    expect(GitlabduoSkill.getSettablePaths().relativeDirPath).toBe("skills");
    expect(GitlabduoSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".gitlab", "duo", "skills"),
    );
  });

  it("should be targeted by gitlabduo and wildcard skills only", () => {
    expect(GitlabduoSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["gitlabduo"]))).toBe(true);
    expect(GitlabduoSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(GitlabduoSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["agentsskills"]))).toBe(
      false,
    );
  });

  it("should write an Agent Skills SKILL.md into the GitLab Duo location", () => {
    const skill = GitlabduoSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["gitlabduo"]),
      global: true,
    });

    expect(skill).toBeInstanceOf(GitlabduoSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".gitlab", "duo", "skills"));
    expect(skill.getFrontmatter()).toEqual({
      name: "daily-report",
      description: "Prepare a daily report",
      metadata: { "slash-command": "enabled" },
    });
  });

  it("should load a skill from skills/ and build deletion entries there", async () => {
    await writeFileContent(
      join(testDir, "skills", "daily-report", "SKILL.md"),
      "---\nname: daily-report\ndescription: Prepare a daily report\n---\n\nBody",
    );

    const skill = await GitlabduoSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    expect(skill).toBeInstanceOf(GitlabduoSkill);
    expect(skill.getRelativeDirPath()).toBe("skills");
    expect(skill.toRulesyncSkill().getFrontmatter().name).toBe("daily-report");

    const forDeletion = GitlabduoSkill.forDeletion({
      outputRoot: testDir,
      relativeDirPath: "skills",
      dirName: "old",
    });
    expect(forDeletion).toBeInstanceOf(GitlabduoSkill);
  });

  it("should only own skills/ subdirectories that hold a SKILL.md", async () => {
    await writeFileContent(
      join(testDir, "skills", "real", "SKILL.md"),
      "---\nname: real\ndescription: d\n---\n",
    );
    await ensureDir(join(testDir, "skills", "unrelated"));

    const owned = (dirName: string) =>
      GitlabduoSkill.isDirOwned({ outputRoot: testDir, relativeDirPath: "skills", dirName });
    await expect(owned("real")).resolves.toBe(true);
    await expect(owned("unrelated")).resolves.toBe(false);
  });
});
