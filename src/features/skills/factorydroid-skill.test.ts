import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { FactorydroidSkill, FactorydroidSkillFrontmatterSchema } from "./factorydroid-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("FactorydroidSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  const validSkillContent = `---
name: Test Skill
description: Test skill description
user-invocable: true
disable-model-invocation: false
---

This is a test factorydroid skill content.`;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for factorydroid skills", () => {
      const paths = FactorydroidSkill.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "skills"),
      });
    });

    it("should return the same relative path in global mode", () => {
      const paths = FactorydroidSkill.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".factory", "skills"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Skill body",
        validate: true,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getBody()).toBe("Skill body");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create FactorydroidSkill from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill",
          targets: ["factorydroid"],
        },
        body: "This is a test factorydroid skill content.",
        validate: true,
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(factorydroidSkill).toBeInstanceOf(FactorydroidSkill);
      expect(factorydroidSkill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(factorydroidSkill.getRelativeDirPath()).toBe(join(".factory", "skills"));
      expect(factorydroidSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill",
      });
    });

    it("should convert from RulesyncSkill in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: {
          name: "Global Skill",
          description: "A globally available skill",
          targets: ["factorydroid"],
        },
        body: "Global content",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(factorydroidSkill.getGlobal()).toBe(true);
      expect(factorydroidSkill.getRelativeDirPath()).toBe(join(".factory", "skills"));
    });

    it("should pick up root-level disable-model-invocation", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-default",
        frontmatter: {
          name: "Root Default",
          description: "Root flag",
          targets: ["factorydroid"],
          "disable-model-invocation": true,
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should omit disable-model-invocation when the root value is not set", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "no-flag",
        frontmatter: {
          name: "No Flag",
          description: "No flag",
          targets: ["factorydroid"],
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBeUndefined();
    });

    it("should let the factorydroid section override the root disable-model-invocation", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "section-override",
        frontmatter: {
          name: "Section Override",
          description: "Section flag",
          targets: ["factorydroid"],
          "disable-model-invocation": false,
          factorydroid: {
            "disable-model-invocation": true,
          },
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should let a false factorydroid section override a true root value", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "section-false-override",
        frontmatter: {
          name: "Section False Override",
          description: "Section flag",
          targets: ["factorydroid"],
          "disable-model-invocation": true,
          factorydroid: {
            "disable-model-invocation": false,
          },
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["disable-model-invocation"]).toBe(false);
    });

    it("should carry enabled and allowed-tools from the factorydroid section", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "shelved",
        frontmatter: {
          name: "Shelved",
          description: "Kept on disk but disabled",
          targets: ["factorydroid"],
          factorydroid: { enabled: false, "allowed-tools": ["Read", "Execute"] },
        },
        body: "Body",
      });

      const frontmatter = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.enabled).toBe(false);
      expect(frontmatter["allowed-tools"]).toEqual(["Read", "Execute"]);
    });

    it("should write the packaging metadata fields from the factorydroid section", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "packaged",
        frontmatter: {
          name: "Packaged",
          description: "A skill shared through a catalog",
          targets: ["*"],
          factorydroid: {
            license: "MIT",
            compatibility: "droid",
            metadata: { owner: "platform-team" },
            version: "1.0.0",
          },
        },
        body: "Body",
        validate: true,
      });

      const skill = FactorydroidSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        validate: true,
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "Packaged",
        description: "A skill shared through a catalog",
        license: "MIT",
        compatibility: "droid",
        metadata: { owner: "platform-team" },
        version: "1.0.0",
      });
    });

    it("should let the section flag win while the root default fills the omitted one", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "packaged-flags",
        frontmatter: {
          name: "Packaged Flags",
          description: "Root flags with a packaged section",
          targets: ["*"],
          "disable-model-invocation": true,
          "user-invocable": true,
          factorydroid: {
            // A defined section value wins over the root default, so the
            // section spread must not be undone by the resolved override.
            "user-invocable": false,
            version: "2.1.0",
          },
        },
        body: "Body",
        validate: true,
      });

      const skill = FactorydroidSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        validate: true,
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "Packaged Flags",
        description: "Root flags with a packaged section",
        "disable-model-invocation": true,
        "user-invocable": false,
        version: "2.1.0",
      });
    });

    it("should pick up root-level user-invocable when factorydroid section omits it", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-user-invocable",
        frontmatter: {
          name: "Root User Invocable",
          description: "Root user-invocable",
          targets: ["factorydroid"],
          "user-invocable": false,
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["user-invocable"]).toBe(false);
    });

    it("should let the factorydroid section override the root-level user-invocable value", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "user-invocable-override",
        frontmatter: {
          name: "User Invocable Override",
          description: "Factorydroid overrides user-invocable",
          targets: ["factorydroid"],
          "user-invocable": true,
          factorydroid: {
            "user-invocable": false,
          },
        },
        body: "Body",
      });

      const factorydroidSkill = FactorydroidSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(factorydroidSkill.getFrontmatter()["user-invocable"]).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill with correct frontmatter", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });

    it("should round-trip disable-model-invocation into the factorydroid section", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "dmi-skill",
        frontmatter: {
          name: "DMI Skill",
          description: "DMI description",
          "disable-model-invocation": true,
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "DMI Skill",
        description: "DMI description",
        targets: ["*"],
        factorydroid: {
          "disable-model-invocation": true,
        },
      });
    });

    it("should round-trip enabled and allowed-tools into the factorydroid section", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "shelved",
        frontmatter: {
          name: "Shelved",
          description: "Kept on disk but disabled",
          enabled: false,
          "allowed-tools": "Read Execute",
        },
        body: "Test body",
        validate: true,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().factorydroid).toEqual({
        enabled: false,
        "allowed-tools": "Read Execute",
      });
    });

    it("should round-trip the packaging metadata fields into the factorydroid section", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "packaged",
        frontmatter: {
          name: "Packaged",
          description: "A skill shared through a catalog",
          license: "MIT",
          compatibility: "droid",
          metadata: { owner: "platform-team" },
          version: "1.0.0",
        },
        body: "Test body",
        validate: true,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().factorydroid).toEqual({
        license: "MIT",
        compatibility: "droid",
        metadata: { owner: "platform-team" },
        version: "1.0.0",
      });
    });

    it("should carry a frontmatter key beyond the schema into the factorydroid section", () => {
      const skill = new FactorydroidSkill({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "hand-written",
        frontmatter: {
          name: "Hand Written",
          description: "Carries a key rulesync does not model",
          "some-future-field": "kept",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().factorydroid).toEqual({
        "some-future-field": "kept",
      });

      // The emit direction has to write the key back out, otherwise the round
      // trip still loses it on the next generate.
      expect(
        FactorydroidSkill.fromRulesyncSkill({
          outputRoot: testDir,
          rulesyncSkill,
          validate: true,
        }).getFrontmatter(),
      ).toEqual({
        name: "Hand Written",
        description: "Carries a key rulesync does not model",
        "some-future-field": "kept",
      });
    });
  });

  describe("fromDir", () => {
    it("should load FactorydroidSkill from directory with passthrough frontmatter", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      const skillFile = join(skillDir, SKILL_FILE_NAME);

      await writeFileContent(skillFile, validSkillContent);

      const skill = await FactorydroidSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getBody()).toBe("This is a test factorydroid skill content.");
      expect(skill.getRelativeDirPath()).toBe(join(".factory", "skills"));
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "user-invocable": true,
        "disable-model-invocation": false,
      });
    });

    it("should import the packaging metadata in the shapes YAML actually produces", async () => {
      const skillDir = join(testDir, ".factory", "skills", "packaged-skill");
      // `version: 2026-01-01` parses as a Date, `compatibility` as an array and
      // `metadata` as a scalar. Droid never validates these fields, so none of
      // them may fail the import of a SKILL.md it happily loads.
      const skillContent = `---
name: packaged-skill
description: A skill shared through a catalog
license: MIT
compatibility:
  - droid
  - claude-code
metadata: platform-team
version: 2026-01-01
---

Packaged body`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await FactorydroidSkill.fromDir({
        outputRoot: testDir,
        dirName: "packaged-skill",
        global: false,
      });

      const section = skill.toRulesyncSkill().getFrontmatter().factorydroid;
      expect(section).toEqual({
        license: "MIT",
        compatibility: ["droid", "claude-code"],
        metadata: "platform-team",
        version: new Date("2026-01-01T00:00:00.000Z"),
      });
    });

    it("should throw error when SKILL.md does not exist", async () => {
      const skillDir = join(testDir, ".factory", "skills", "test-skill");
      await writeFileContent(join(skillDir, "other.md"), "content");

      await expect(
        FactorydroidSkill.fromDir({
          outputRoot: testDir,
          dirName: "test-skill",
          global: false,
        }),
      ).rejects.toThrow();
    });

    it("should create instance from directory in global mode", async () => {
      const skillDir = join(testDir, ".factory", "skills", "global-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Global Skill
description: A global skill
---

Global body content`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await FactorydroidSkill.fromDir({
        outputRoot: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getGlobal()).toBe(true);
      expect(skill.getBody()).toBe("Global body content");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for rulesync skill with wildcard target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["*"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(true);
    });

    it("should return true for rulesync skill with factorydroid target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["factorydroid"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(true);
    });

    it("should return false for rulesync skill with different target", () => {
      const rulesyncSkill = new RulesyncSkill({
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: {
          name: "Test",
          description: "Test",
          targets: ["cursor"],
        },
        body: "content",
      });

      const result = FactorydroidSkill.isTargetedByRulesyncSkill(rulesyncSkill);
      expect(result).toBe(false);
    });
  });

  describe("schema", () => {
    it("should accept valid frontmatter with behavior flags", () => {
      const result = FactorydroidSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
        "user-invocable": true,
        "disable-model-invocation": false,
      });

      expect(result.success).toBe(true);
    });

    it("should accept the packaging metadata shapes a typed schema would reject", () => {
      const result = FactorydroidSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
        license: 2024,
        compatibility: ["droid", "claude-code"],
        metadata: "platform-team",
        version: new Date("2026-01-01T00:00:00.000Z"),
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid frontmatter", () => {
      const result = FactorydroidSkillFrontmatterSchema.safeParse({ name: 123, description: true });

      expect(result.success).toBe(false);
    });
  });

  describe("isDirOwned", () => {
    const skillsDir = join(".factory", "skills");

    const writeSkillFile = async (dirName: string, content: string): Promise<void> => {
      await ensureDir(join(testDir, skillsDir, dirName));
      await writeFileContent(join(testDir, skillsDir, dirName, SKILL_FILE_NAME), content);
    };

    const isDirOwned = (dirName: string): Promise<boolean> =>
      FactorydroidSkill.isDirOwned({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName,
        inputRoots: ["."],
      });

    it("should own every directory other than review-guidelines", async () => {
      await writeSkillFile("other", "<!-- rulesync:check:security -->\n\n## security\n");

      expect(await isDirOwned("other")).toBe(true);
    });

    it("should disown a review-guidelines directory holding generated check sections", async () => {
      // The checks feature owns this path, so the skills feature must neither
      // delete it as an orphan nor import it as a skill.
      await writeSkillFile(
        "review-guidelines",
        "<!-- rulesync:check:security -->\n\n## security\n",
      );

      expect(await isDirOwned("review-guidelines")).toBe(false);
    });

    it("should disown a hand-authored review-guidelines directory too", async () => {
      // Factory's documented example has no frontmatter, so shape cannot tell a
      // hand-authored file from a generated one. The path decides instead, and
      // `import --features checks` is what reads this one.
      await writeSkillFile(
        "review-guidelines",
        "---\nname: review-guidelines\ndescription: Ours\n---\n\nOur guidelines.\n",
      );

      expect(await isDirOwned("review-guidelines")).toBe(false);
    });

    it("should disown a review-guidelines directory with no SKILL.md", async () => {
      await ensureDir(join(testDir, skillsDir, "review-guidelines"));

      expect(await isDirOwned("review-guidelines")).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletion marker", () => {
      const skill = FactorydroidSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "to-delete",
      });

      expect(skill).toBeInstanceOf(FactorydroidSkill);
      expect(skill.getDirName()).toBe("to-delete");
      expect(skill.getGlobal()).toBe(false);
    });

    it("should support global deletion", () => {
      const skill = FactorydroidSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".factory", "skills"),
        dirName: "cleanup",
        global: true,
      });

      expect(skill.getGlobal()).toBe(true);
    });
  });
});
