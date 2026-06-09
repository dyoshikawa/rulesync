import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AmpSkill } from "./amp-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AmpSkill", () => {
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

  describe("getSettablePaths", () => {
    it("uses .agents/skills in project mode", () => {
      expect(AmpSkill.getSettablePaths().relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("uses .config/agents/skills in global mode", () => {
      expect(AmpSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "agents", "skills"),
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a SKILL.md with name/description frontmatter under .agents/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const ampSkill = AmpSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(ampSkill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(ampSkill.getFrontmatter()).toEqual({ name: "my-skill", description: "Does a thing" });
      expect(ampSkill.getBody()).toBe("Skill body");
    });

    it("emits under .config/agents/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const ampSkill = AmpSkill.fromRulesyncSkill({ rulesyncSkill, validate: true, global: true });
      expect(ampSkill.getRelativeDirPath()).toBe(join(".config", "agents", "skills"));
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      [["*"], true],
      [["amp"], true],
      [["claudecode"], false],
    ] as const)("targets %j -> %s", (targets, expected) => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: [...targets] },
        body: "b",
        validate: true,
      });
      expect(AmpSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });

  describe("fromDir / toRulesyncSkill round-trip", () => {
    it("loads a SKILL.md directory and converts back to a RulesyncSkill", async () => {
      const skillDir = join(testDir, ".agents", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.`,
      );

      const ampSkill = await AmpSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" });
      const rulesyncSkill = ampSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Skill body.");
    });
  });
});
