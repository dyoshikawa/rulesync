import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DshSkill } from "./dsh-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("DshSkill", () => {
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

  const skillsDir = join(".dsh", "skills");

  describe("getSettablePaths", () => {
    it("should return .dsh/skills for both project and global mode", () => {
      expect(DshSkill.getSettablePaths().relativeDirPath).toBe(skillsDir);
      expect(DshSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(skillsDir);
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

      const skill = DshSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getRelativeDirPath()).toBe(skillsDir);
      expect(skill.getFrontmatter()).toEqual({ name: "test-skill", description: "A test skill" });
      expect(skill.getBody()).toBe("Skill body");

      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter().name).toBe("test-skill");
      expect(back.getFrontmatter().description).toBe("A test skill");
      expect(back.getFrontmatter().dsh).toBeUndefined();
      expect(back.getBody()).toBe("Skill body");
    });

    it("should emit whenToUse from the dsh section and the flags/metadata from the root", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "A test skill",
          targets: ["*"],
          license: "MIT",
          metadata: { author: "example-org" },
          "disable-model-invocation": true,
          "user-invocable": false,
          dsh: { whenToUse: "When the user asks to review a PR" },
        },
        body: "Skill body",
        validate: false,
      });

      const skill = DshSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      // The harness documents no `license` field, so it is deliberately dropped.
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "A test skill",
        whenToUse: "When the user asks to review a PR",
        metadata: { author: "example-org" },
        "disable-model-invocation": true,
        "user-invocable": false,
      });

      // Imported values land in the `dsh` section, never on the shared root.
      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
      expect(back.getFrontmatter()["user-invocable"]).toBeUndefined();
      expect(back.getFrontmatter().metadata).toBeUndefined();
      expect(back.getFrontmatter().dsh).toEqual({
        whenToUse: "When the user asks to review a PR",
        metadata: { author: "example-org" },
        "disable-model-invocation": true,
        "user-invocable": false,
      });
    });

    it("should let the dsh section override the root flags and metadata", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "A test skill",
          targets: ["*"],
          metadata: { author: "example-org" },
          "disable-model-invocation": true,
          "user-invocable": true,
          dsh: {
            metadata: { version: "1.0.0" },
            "disable-model-invocation": false,
            "user-invocable": false,
          },
        },
        body: "Skill body",
        validate: false,
      });

      const skill = DshSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "A test skill",
        metadata: { version: "1.0.0" },
        "disable-model-invocation": false,
        "user-invocable": false,
      });
    });

    it("should keep the same directory in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: { name: "test-skill", description: "A test skill", targets: ["*"] },
        body: "Skill body",
        validate: false,
      });

      const skill = DshSkill.fromRulesyncSkill({
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
        `---\nname: my-skill\ndescription: Loaded from disk\nwhenToUse: On demand\nuser-invocable: false\n---\n\nBody here`,
      );

      const skill = await DshSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Loaded from disk",
        whenToUse: "On demand",
        "user-invocable": false,
      });
      expect(skill.getBody().trim()).toBe("Body here");
    });

    it("should preserve extra frontmatter keys (the schema is loose)", async () => {
      const skillDir = join(testDir, skillsDir, "extra");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: extra\ndescription: Has extras\nlicense: MIT\n---\n\nBody`,
      );

      const skill = await DshSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "extra",
      });

      // `license` is undeclared on purpose — the harness documents no such
      // field — so it doubles as the fixture for the schema's loose passthrough.
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
        DshSkill.fromDir({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "broken",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw for a non-boolean invocation flag", async () => {
      const skillDir = join(testDir, skillsDir, "flag");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: flag\ndescription: Bad flag\ndisable-model-invocation: maybe\n---\n\nBody`,
      );

      await expect(
        DshSkill.fromDir({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "flag",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("validate", () => {
    it("should fail for frontmatter that does not match the schema", () => {
      const skill = new DshSkill({
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
      const skill = new DshSkill({
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
    it("should target dsh for wildcard and explicit targets, not others", () => {
      const make = (targets: ("*" | "dsh" | "claudecode")[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets },
          body: "b",
          validate: false,
        });

      expect(DshSkill.isTargetedByRulesyncSkill(make(["*"]))).toBe(true);
      expect(DshSkill.isTargetedByRulesyncSkill(make(["dsh"]))).toBe(true);
      expect(DshSkill.isTargetedByRulesyncSkill(make(["claudecode"]))).toBe(false);
    });
  });
});
