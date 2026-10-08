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

  describe("invocation flags", () => {
    const toReasonix = (frontmatter: Partial<RulesyncSkillFrontmatterInput>) =>
      ReasonixSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill: new RulesyncSkill({
          outputRoot: testDir,
          dirName: "flagged",
          frontmatter: { name: "flagged", description: "Flagged", targets: ["*"], ...frontmatter },
          body: "Body",
          validate: false,
        }),
      });

    // v2 reads `disable-model-invocation` natively; v1 reads only
    // `invocation: manual`, so both are written for the same intent.
    it("should write the root disable-model-invocation with invocation: manual beside it", () => {
      const skill = toReasonix({ "disable-model-invocation": true });

      expect(skill.getFrontmatter()).toEqual({
        name: "flagged",
        description: "Flagged",
        invocation: "manual",
        "disable-model-invocation": true,
      });
    });

    it("should write a false disable-model-invocation without invocation: manual", () => {
      const skill = toReasonix({ "disable-model-invocation": false });

      expect(skill.getFrontmatter()).toEqual({
        name: "flagged",
        description: "Flagged",
        "disable-model-invocation": false,
      });
    });

    it("should write user-invocable", () => {
      const skill = toReasonix({ "user-invocable": false });

      expect(skill.getFrontmatter()["user-invocable"]).toBe(false);
      expect(skill.getFrontmatter()).not.toHaveProperty("invocation");
    });

    it("should let the reasonix section override the root flags", () => {
      const skill = toReasonix({
        "disable-model-invocation": true,
        "user-invocable": true,
        reasonix: { "disable-model-invocation": false, "user-invocable": false },
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "flagged",
        description: "Flagged",
        "disable-model-invocation": false,
        "user-invocable": false,
      });
    });

    it("should write an authored reasonix.invocation verbatim", () => {
      const skill = toReasonix({
        reasonix: { invocation: "manual", "disable-model-invocation": false },
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "flagged",
        description: "Flagged",
        invocation: "manual",
        "disable-model-invocation": false,
      });
    });

    it("should import the native flags into the reasonix section, not the root", () => {
      const skill = new ReasonixSkill({
        outputRoot: testDir,
        dirName: "flagged",
        frontmatter: {
          name: "flagged",
          description: "Flagged",
          invocation: "manual",
          "disable-model-invocation": true,
          "user-invocable": false,
        },
        body: "Body",
      });

      const frontmatter = skill.toRulesyncSkill().getFrontmatter();

      // The `manual` that generate writes beside the flag is not kept: it would
      // pin the skill hidden after the flag is turned off.
      expect(frontmatter.reasonix).toEqual({
        "disable-model-invocation": true,
        "user-invocable": false,
      });
      expect(frontmatter).not.toHaveProperty("disable-model-invocation");
      expect(frontmatter).not.toHaveProperty("invocation");
    });

    // `manual` only hides the skill from the catalog; it stays callable, so it
    // is not the same switch as `disable-model-invocation: true`.
    it.each([["manual"], [" Manual "]])(
      "should keep a v1-only invocation of %j as reasonix.invocation",
      (invocation) => {
        const skill = new ReasonixSkill({
          outputRoot: testDir,
          dirName: "flagged",
          frontmatter: { name: "flagged", description: "Flagged", invocation },
          body: "Body",
        });

        expect(skill.toRulesyncSkill().getFrontmatter().reasonix).toEqual({ invocation });
      },
    );

    it("should keep invocation: manual beside an explicit false flag through a round-trip", () => {
      const skill = new ReasonixSkill({
        outputRoot: testDir,
        dirName: "flagged",
        frontmatter: {
          name: "flagged",
          description: "Flagged",
          invocation: "manual",
          "disable-model-invocation": false,
        },
        body: "Body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const regenerated = ReasonixSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(regenerated.getFrontmatter()).toEqual({
        name: "flagged",
        description: "Flagged",
        invocation: "manual",
        "disable-model-invocation": false,
      });
    });

    it.each([
      ["yes", true],
      [" OFF ", false],
      [1, true],
      ["false", false],
    ])("should read the Reasonix flag spelling %j as %j", (value, expected) => {
      const skill = new ReasonixSkill({
        outputRoot: testDir,
        dirName: "flagged",
        frontmatter: {
          name: "flagged",
          description: "Flagged",
          "disable-model-invocation": value,
          "user-invocable": value,
        },
        body: "Body",
      });

      expect(skill.toRulesyncSkill().getFrontmatter().reasonix).toEqual({
        "disable-model-invocation": expected,
        "user-invocable": expected,
      });
    });

    it("should ignore a flag value Reasonix cannot read", () => {
      const skill = new ReasonixSkill({
        outputRoot: testDir,
        dirName: "flagged",
        frontmatter: { name: "flagged", description: "Flagged", "user-invocable": "maybe" },
        body: "Body",
      });

      expect(skill.toRulesyncSkill().getFrontmatter()).not.toHaveProperty("reasonix");
    });

    it("should import a skill without flags with no reasonix section", () => {
      const skill = new ReasonixSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain" },
        body: "Body",
      });

      expect(skill.toRulesyncSkill().getFrontmatter()).not.toHaveProperty("reasonix");
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

  describe("isDirOwned", () => {
    const skillsDir = join(".reasonix", "skills");

    it("should own a regular skill directory", async () => {
      const skillDir = join(testDir, skillsDir, "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: A regular skill\n---\n\nBody`,
      );

      await expect(
        ReasonixSkill.isDirOwned({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "my-skill",
          inputRoots: [testDir],
        }),
      ).resolves.toBe(true);
    });

    it("should not own a subagent profile directory", async () => {
      const agentDir = join(testDir, skillsDir, "reviewer");
      await ensureDir(agentDir);
      await writeFileContent(
        join(agentDir, SKILL_FILE_NAME),
        `---\nname: reviewer\ndescription: A subagent\ninvocation: manual\nrunAs: subagent\n---\n\nBody`,
      );

      await expect(
        ReasonixSkill.isDirOwned({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "reviewer",
          inputRoots: [testDir],
        }),
      ).resolves.toBe(false);
    });

    it("should not own a subagent profile whose YAML needed repairing", async () => {
      // The loader recovers this file, so the ownership check has to read it
      // the same way; otherwise a subagent profile is imported as a skill.
      const agentDir = join(testDir, skillsDir, "colon-reviewer");
      await ensureDir(agentDir);
      await writeFileContent(
        join(agentDir, SKILL_FILE_NAME),
        `---\nname: colon-reviewer\ndescription: Use when: reviewing\ninvocation: manual\nrunAs: subagent\n---\n\nBody`,
      );

      await expect(
        ReasonixSkill.isDirOwned({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "colon-reviewer",
          inputRoots: [testDir],
        }),
      ).resolves.toBe(false);
    });

    it("should own a directory without a readable SKILL.md", async () => {
      const emptyDir = join(testDir, skillsDir, "empty");
      await ensureDir(emptyDir);

      await expect(
        ReasonixSkill.isDirOwned({
          outputRoot: testDir,
          relativeDirPath: skillsDir,
          dirName: "empty",
          inputRoots: [testDir],
        }),
      ).resolves.toBe(true);
    });
  });
});
