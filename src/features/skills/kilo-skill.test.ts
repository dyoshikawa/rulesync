import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloSkill, KiloSkillFrontmatter, KiloSkillFrontmatterSchema } from "./kilo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("KiloSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

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

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new KiloSkill({
        outputRoot: testDir,
        relativeDirPath: join(".kilo", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          "allowed-tools": ["Bash", "Read"],
        },
        body: "This is the body of the kilo skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should create instance without validation when validate is false", () => {
      const skill = new KiloSkill({
        outputRoot: testDir,
        relativeDirPath: join(".kilo", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      expect(skill.getBody()).toBe("Test body");
    });

    it("should throw error for invalid frontmatter when validation is enabled", () => {
      expect(() => {
        new KiloSkill({
          outputRoot: testDir,
          relativeDirPath: join(".kilo", "skills"),
          dirName: "test-skill",
          frontmatter: {
            name: "",
            description: "",
            "allowed-tools": "invalid" as unknown as string[],
          },
          body: "Test body",
          validate: true,
        });
      }).toThrow(/Invalid frontmatter/);
    });
  });

  describe("getSettablePaths", () => {
    it("should return project and global paths", () => {
      expect(KiloSkill.getSettablePaths()).toEqual({
        relativeDirPath: join(".kilo", "skills"),
      });
      expect(KiloSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".kilo", "skills"),
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill and keep allowed-tools", () => {
      const skill = new KiloSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          "allowed-tools": ["Bash", "Read"],
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter().kilo).toEqual({
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should round-trip license, compatibility, and metadata via the kilo section", () => {
      const skill = new KiloSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          license: "MIT",
          compatibility: { network: "required" },
          metadata: { author: "rulesync" },
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().kilo).toEqual({
        license: "MIT",
        compatibility: { network: "required" },
        metadata: { author: "rulesync" },
      });

      const roundTripped = KiloSkill.fromRulesyncSkill({ rulesyncSkill });
      const fm = roundTripped.getFrontmatter();
      expect(fm.license).toBe("MIT");
      expect(fm.compatibility).toEqual({ network: "required" });
      expect(fm.metadata).toEqual({ author: "rulesync" });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill with project paths", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          kilo: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = KiloSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: false,
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".kilo", "skills"));
      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("should create instance from RulesyncSkill and respect global paths", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          kilo: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = KiloSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".kilo", "skills"));
      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("should fall back to the root-level license/compatibility/metadata when the kilo section omits them", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-fields",
        frontmatter: {
          name: "root-fields",
          description: "Root-level standard fields",
          license: "MIT",
          compatibility: { "kilo-version": ">=7.0.0" },
          metadata: { author: "root" },
        },
        body: "Body",
      });

      const frontmatter = KiloSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter.compatibility).toEqual({ "kilo-version": ">=7.0.0" });
      expect(frontmatter.metadata).toEqual({ author: "root" });
    });

    it("should let the kilo section override the root-level license/compatibility/metadata", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "section-wins",
        frontmatter: {
          name: "section-wins",
          description: "Section overrides the root-level fields",
          license: "MIT",
          compatibility: { "kilo-version": ">=7.0.0" },
          metadata: { author: "root" },
          kilo: {
            license: "Apache-2.0",
            compatibility: { "kilo-version": ">=8.0.0" },
            metadata: { author: "section" },
          },
        },
        body: "Body",
      });

      const frontmatter = KiloSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("Apache-2.0");
      expect(frontmatter.compatibility).toEqual({ "kilo-version": ">=8.0.0" });
      expect(frontmatter.metadata).toEqual({ author: "section" });
    });

    it("should forward a root-level string compatibility as-is, like the other Agent Skills targets", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-string-compatibility",
        frontmatter: {
          name: "root-string-compatibility",
          description: "Root-level string compatibility",
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "root" },
        },
        body: "Body",
      });

      const frontmatter = KiloSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter).toEqual({
        name: "root-string-compatibility",
        description: "Root-level string compatibility",
        license: "MIT",
        compatibility: "Requires git",
        metadata: { author: "root" },
      });
    });

    it("should round-trip a string compatibility through the kilo section", () => {
      const skill = new KiloSkill({
        outputRoot: testDir,
        dirName: "string-compatibility",
        frontmatter: {
          name: "string-compatibility",
          description: "String compatibility",
          compatibility: "Requires git",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().kilo).toEqual({ compatibility: "Requires git" });

      const roundTripped = KiloSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter().compatibility).toBe("Requires git");
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".kilo", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
allowed-tools:
  - Bash
  - Read
---

This is the body of the kilo skill.
It can be multiline.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await KiloSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(KiloSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
      expect(skill.getBody()).toBe("This is the body of the kilo skill.\nIt can be multiline.");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets include kilo", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["kilo"],
        },
        body: "Test body",
        validate: true,
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets include wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets do not include kilo or wildcard", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["claudecode", "cursor"],
        },
        body: "Test body",
        validate: true,
      });

      expect(KiloSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("validation schema", () => {
    it("should validate allowed-tools as optional array", () => {
      const validFrontmatter: KiloSkillFrontmatter = {
        name: "Test Skill",
        description: "Test description",
        "allowed-tools": ["Bash"],
      };

      const result = KiloSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });

    it("should accept packaging metadata shapes a typed schema would reject", () => {
      const result = KiloSkillFrontmatterSchema.safeParse({
        name: "Test Skill",
        description: "Test description",
        license: 2024,
        compatibility: ["kilo", "claude-code"],
        metadata: "platform-team",
      });

      expect(result.success).toBe(true);
    });
  });
});
