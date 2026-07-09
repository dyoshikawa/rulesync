import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReasonixSkill } from "./reasonix-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("ReasonixSkill", () => {
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
    it("should return .reasonix/skills for both project and global mode", () => {
      expect(ReasonixSkill.getSettablePaths().relativeDirPath).toBe(join(".reasonix", "skills"));
      expect(ReasonixSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".reasonix", "skills"),
      );
    });
  });

  describe("fromRulesyncSkill / toRulesyncSkill", () => {
    it("should emit a name/description SKILL.md and round-trip back", () => {
      const frontmatter: RulesyncSkillFrontmatterInput = {
        name: "test-skill",
        description: "A test skill",
        targets: ["*"],
      };
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter,
        body: "Skill body",
        validate: false,
      });

      const skill = ReasonixSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getRelativeDirPath()).toBe(join(".reasonix", "skills"));
      expect(skill.getFrontmatter()).toEqual({ name: "test-skill", description: "A test skill" });
      expect(skill.getBody()).toBe("Skill body");

      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter().name).toBe("test-skill");
      expect(back.getFrontmatter().description).toBe("A test skill");
      expect(back.getBody()).toBe("Skill body");
    });
  });

  describe("fromDir", () => {
    it("should load a directory-layout SKILL.md", async () => {
      const skillDir = join(testDir, ".reasonix", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Loaded from disk\n---\n\nBody here`,
      );

      const skill = await ReasonixSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: join(".reasonix", "skills"),
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter()).toEqual({ name: "my-skill", description: "Loaded from disk" });
      expect(skill.getBody().trim()).toBe("Body here");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target reasonix for wildcard and explicit targets, not others", () => {
      const make = (targets: ("*" | "reasonix" | "claudecode")[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets },
          body: "b",
          validate: false,
        });

      expect(ReasonixSkill.isTargetedByRulesyncSkill(make(["*"]))).toBe(true);
      expect(ReasonixSkill.isTargetedByRulesyncSkill(make(["reasonix"]))).toBe(true);
      expect(ReasonixSkill.isTargetedByRulesyncSkill(make(["claudecode"]))).toBe(false);
    });
  });
});
