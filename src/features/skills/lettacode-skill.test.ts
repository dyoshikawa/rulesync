import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { LettacodeSkill } from "./lettacode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("LettacodeSkill", () => {
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

  it("uses .agents/skills for the project and .letta/skills for the user scope", () => {
    expect(LettacodeSkill.getSettablePaths().relativeDirPath).toBe(join(".agents", "skills"));
    expect(LettacodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".letta", "skills"),
    );
  });

  it("emits the lettacode section and the root invocation flags, and round-trips", () => {
    const rulesyncSkill = new RulesyncSkill({
      outputRoot: testDir,
      dirName: "review",
      frontmatter: {
        name: "review",
        description: "Review a pull request",
        targets: ["*"],
        "disable-model-invocation": true,
        lettacode: { when_to_use: "When asked for a review", "user-invocable": false },
      },
      body: "Skill body",
      validate: false,
    });

    const skill = LettacodeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
      global: true,
    });
    expect(skill.getRelativeDirPath()).toBe(join(".letta", "skills"));
    expect(skill.getFrontmatter()).toEqual({
      name: "review",
      description: "Review a pull request",
      when_to_use: "When asked for a review",
      "disable-model-invocation": true,
      "user-invocable": false,
    });

    const back = skill.toRulesyncSkill().getFrontmatter();
    expect(back.lettacode).toEqual({
      when_to_use: "When asked for a review",
      "disable-model-invocation": true,
      "user-invocable": false,
    });
  });

  it("imports a skill directory", async () => {
    const skillDir = join(testDir, ".agents", "skills", "review");
    await ensureDir(skillDir);
    await writeFileContent(
      join(skillDir, SKILL_FILE_NAME),
      "---\nname: review\ndescription: Review a pull request\n---\nSkill body\n",
    );

    const skill = await LettacodeSkill.fromDir({ outputRoot: testDir, dirName: "review" });
    const back = skill.toRulesyncSkill();
    expect(back.getFrontmatter()).toMatchObject({
      name: "review",
      description: "Review a pull request",
    });
    expect(back.getFrontmatter().lettacode).toBeUndefined();
  });

  it("is targeted by '*' and by lettacode", () => {
    const build = (targets: string[]) =>
      new RulesyncSkill({
        outputRoot: testDir,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: targets as never },
        body: "",
        validate: false,
      });
    expect(LettacodeSkill.isTargetedByRulesyncSkill(build(["lettacode"]))).toBe(true);
    expect(LettacodeSkill.isTargetedByRulesyncSkill(build(["claudecode"]))).toBe(false);
  });
});
