import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";
import { ZcodeSkill } from "./zcode-skill.js";

describe("ZcodeSkill", () => {
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

  const skillsDir = join(".zcode", "skills");

  describe("getSettablePaths", () => {
    it("should return .zcode/skills for both project and global mode", () => {
      expect(ZcodeSkill.getSettablePaths().relativeDirPath).toBe(skillsDir);
      expect(ZcodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(skillsDir);
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

      const skill = ZcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getRelativeDirPath()).toBe(skillsDir);
      expect(skill.getFrontmatter()).toEqual({ name: "test-skill", description: "A test skill" });
      expect(skill.getBody()).toBe("Skill body");

      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter().name).toBe("test-skill");
      expect(back.getFrontmatter().description).toBe("A test skill");
      expect(back.getBody()).toBe("Skill body");
    });

    it("should keep the same directory in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "A test skill", targets: ["*"] },
        body: "Skill body",
        validate: false,
      });

      const skill = ZcodeSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(skillsDir);
    });
  });

  describe("fromDir", () => {
    it("should load a directory-layout SKILL.md", async () => {
      const skillDir = join(testDir, skillsDir, "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Loaded from disk\n---\n\nBody here`,
      );

      const skill = await ZcodeSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter()).toEqual({ name: "my-skill", description: "Loaded from disk" });
      expect(skill.getBody().trim()).toBe("Body here");
    });

    it("should preserve extra frontmatter keys (the schema is loose)", async () => {
      const skillDir = join(testDir, skillsDir, "extra");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: extra\ndescription: Has extras\nlicense: MIT\n---\n\nBody`,
      );

      const skill = await ZcodeSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "extra",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "extra",
        description: "Has extras",
        license: "MIT",
      });
    });

    it("should throw for frontmatter missing the required pair", async () => {
      const skillDir = join(testDir, skillsDir, "broken");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: broken\n---\n\nNo description`,
      );

      await expect(
        ZcodeSkill.fromDir({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "broken",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("validate", () => {
    it("should fail for frontmatter that does not match the schema", () => {
      const skill = new ZcodeSkill({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "broken",
        frontmatter: { name: "broken" } as never,
        body: "Body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Invalid frontmatter");
    });

    it("should succeed for a well-formed skill", () => {
      const skill = new ZcodeSkill({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "ok",
        frontmatter: { name: "ok", description: "Fine" },
        body: "Body",
      });

      expect(skill.validate()).toEqual({ success: true, error: null });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target zcode for wildcard and explicit targets, not others", () => {
      const make = (targets: ("*" | "zcode" | "claudecode")[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets },
          body: "b",
          validate: false,
        });

      expect(ZcodeSkill.isTargetedByRulesyncSkill(make(["*"]))).toBe(true);
      expect(ZcodeSkill.isTargetedByRulesyncSkill(make(["zcode"]))).toBe(true);
      expect(ZcodeSkill.isTargetedByRulesyncSkill(make(["claudecode"]))).toBe(false);
    });
  });
});
