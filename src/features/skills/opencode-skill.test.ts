import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  OpenCodeSkill,
  OpenCodeSkillFrontmatter,
  OpenCodeSkillFrontmatterSchema,
} from "./opencode-skill.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("OpenCodeSkill", () => {
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
      const skill = new OpenCodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".opencode", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          "allowed-tools": ["Bash", "Read"],
        },
        body: "This is the body of the opencode skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should create instance without validation when validate is false", () => {
      const skill = new OpenCodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".opencode", "skills"),
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
        new OpenCodeSkill({
          outputRoot: testDir,
          relativeDirPath: join(".opencode", "skills"),
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
      expect(OpenCodeSkill.getSettablePaths()).toEqual({
        relativeDirPath: join(".opencode", "skills"),
        alternativeSkillRoots: [join(".opencode", "skill")],
      });
      expect(OpenCodeSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "opencode", "skills"),
        alternativeSkillRoots: [join(".config", "opencode", "skill")],
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill and keep allowed-tools", () => {
      const skill = new OpenCodeSkill({
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
      expect(rulesyncSkill.getFrontmatter().opencode).toEqual({
        "allowed-tools": ["Bash", "Read"],
      });
    });

    it("should carry license/compatibility/metadata into the opencode section", () => {
      const skill = new OpenCodeSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          license: "MIT",
          compatibility: { opencode: ">=1.0.0" },
          metadata: { author: "rulesync" },
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().opencode).toEqual({
        license: "MIT",
        compatibility: { opencode: ">=1.0.0" },
        metadata: { author: "rulesync" },
      });
    });

    it("should carry a string compatibility into the opencode section (issue #2066)", () => {
      const skill = new OpenCodeSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          compatibility: "opencode",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().opencode).toEqual({
        compatibility: "opencode",
      });
    });

    it("should not attach an opencode section when no optional fields exist", () => {
      const skill = new OpenCodeSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().opencode).toBeUndefined();
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
          opencode: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: false,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".opencode", "skills"));
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
          opencode: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        global: true,
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getRelativeDirPath()).toBe(join(".config", "opencode", "skills"));
      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("should emit license/compatibility/metadata from the opencode section", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          opencode: {
            license: "Apache-2.0",
            compatibility: { opencode: ">=1.0.0" },
            metadata: { author: "rulesync" },
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({ rulesyncSkill, global: false });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.license).toBe("Apache-2.0");
      expect(frontmatter.compatibility).toEqual({ opencode: ">=1.0.0" });
      expect(frontmatter.metadata).toEqual({ author: "rulesync" });
    });

    it("should fall back to top-level license/compatibility/metadata (issue #1787)", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        // Top-level license/compatibility/metadata are accepted by the loose
        // schema even though they are not part of the typed input.
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          license: "MIT",
          compatibility: { opencode: ">=2.0.0" },
          metadata: { author: "top-level" },
        } as unknown as RulesyncSkillFrontmatterInput,
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({ rulesyncSkill, global: false });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter.compatibility).toEqual({ opencode: ">=2.0.0" });
      expect(frontmatter.metadata).toEqual({ author: "top-level" });
    });

    it("should emit a string compatibility from the opencode section (issue #2066)", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          opencode: {
            compatibility: "opencode",
          },
        },
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({ rulesyncSkill, global: false });

      expect(skill.getFrontmatter().compatibility).toBe("opencode");
    });

    it("should prefer the opencode section over top-level values", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        // `license` at the top level is accepted by the loose schema.
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          license: "MIT",
          opencode: {
            license: "Apache-2.0",
          },
        } as unknown as RulesyncSkillFrontmatterInput,
        body: "Test body",
        validate: true,
      });

      const skill = OpenCodeSkill.fromRulesyncSkill({ rulesyncSkill, global: false });

      expect(skill.getFrontmatter().license).toBe("Apache-2.0");
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".opencode", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
allowed-tools:
  - Bash
  - Read
---

This is the body of the opencode skill.
It can be multiline.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await OpenCodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(OpenCodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        "allowed-tools": ["Bash", "Read"],
      });
      expect(skill.getBody()).toBe("This is the body of the opencode skill.\nIt can be multiline.");
    });

    it("should round-trip license/compatibility/metadata through fromDir and toRulesyncSkill", async () => {
      const skillDir = join(testDir, ".opencode", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
license: MIT
compatibility:
  opencode: ">=1.0.0"
metadata:
  author: rulesync
---

Body content.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await OpenCodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter.compatibility).toEqual({ opencode: ">=1.0.0" });
      expect(frontmatter.metadata).toEqual({ author: "rulesync" });

      expect(skill.toRulesyncSkill().getFrontmatter().opencode).toEqual({
        license: "MIT",
        compatibility: { opencode: ">=1.0.0" },
        metadata: { author: "rulesync" },
      });
    });

    it("should import the documented `compatibility: opencode` string form (issue #2066)", async () => {
      const skillDir = join(testDir, ".opencode", "skills", "git-release");
      await ensureDir(skillDir);
      const skillContent = `---
name: git-release
description: Create consistent releases and changelogs
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
---

Body content.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await OpenCodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "git-release",
      });

      const frontmatter = skill.getFrontmatter();
      expect(frontmatter.compatibility).toBe("opencode");

      expect(skill.toRulesyncSkill().getFrontmatter().opencode).toEqual({
        license: "MIT",
        compatibility: "opencode",
        metadata: { audience: "maintainers" },
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets include opencode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          targets: ["opencode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
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

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets do not include opencode or wildcard", () => {
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

      expect(OpenCodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("validation schema", () => {
    it("should validate allowed-tools as optional array", () => {
      const validFrontmatter: OpenCodeSkillFrontmatter = {
        name: "Test Skill",
        description: "Test description",
        "allowed-tools": ["Bash"],
      };

      const result = OpenCodeSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });
  });
});
