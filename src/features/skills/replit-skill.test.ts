import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ReplitSkill } from "./replit-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("ReplitSkill", () => {
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

  describe("getSettablePaths", () => {
    it("should return .agents/skills as relativeDirPath", () => {
      const paths = ReplitSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return .agents/skills as relativeDirPath when global is true", () => {
      const paths = ReplitSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new ReplitSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the replit skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getBody()).toBe("This is the body of the replit skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the replit skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await ReplitSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getBody()).toBe("This is the body of the replit skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        ReplitSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const replitSkill = ReplitSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(replitSkill).toBeInstanceOf(ReplitSkill);
      expect(replitSkill.getBody()).toBe("Test body content");
      expect(replitSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should emit standard optional frontmatter from the replit block", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          replit: {
            "allowed-tools": ["read", "write"],
            license: "MIT",
            compatibility: { "agent-skills": ">=1.0.0" },
            metadata: { author: "rulesync" },
          },
        },
        body: "Test body content",
        validate: true,
      });

      const replitSkill = ReplitSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(replitSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        // Joined into the space-separated form the Agent Skills spec requires.
        "allowed-tools": "read write",
        license: "MIT",
        compatibility: { "agent-skills": ">=1.0.0" },
        metadata: { author: "rulesync" },
      });
    });

    it("should accept the spec's string forms and keep them as-is", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "spec-skill",
        frontmatter: {
          name: "spec-skill",
          description: "Spec-conformant skill",
          replit: {
            "allowed-tools": "Bash(git:*) Read",
            compatibility: "Requires git and docker",
          },
        },
        body: "Body",
        validate: true,
      });

      expect(ReplitSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "spec-skill",
        description: "Spec-conformant skill",
        "allowed-tools": "Bash(git:*) Read",
        compatibility: "Requires git and docker",
      });
    });

    it("should fall back to the root-level license/compatibility/metadata when the replit section omits them", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-fields",
        frontmatter: {
          name: "root-fields",
          description: "Root-level standard fields",
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "root" },
        },
        body: "Body",
      });

      const frontmatter = ReplitSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter.compatibility).toBe("Requires git");
      expect(frontmatter.metadata).toEqual({ author: "root" });
    });

    it("should let the replit section override the root-level license/compatibility/metadata", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "section-wins",
        frontmatter: {
          name: "section-wins",
          description: "Section overrides the root-level fields",
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "root" },
          replit: {
            license: "Apache-2.0",
            compatibility: "Requires jq",
            metadata: { author: "section" },
          },
        },
        body: "Body",
      });

      const frontmatter = ReplitSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("Apache-2.0");
      expect(frontmatter.compatibility).toBe("Requires jq");
      expect(frontmatter.metadata).toEqual({ author: "section" });
    });

    it("should keep the root-level license when the replit section sets only an unrelated key", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "partial-section",
        frontmatter: {
          name: "partial-section",
          description: "Section sets only an unrelated key",
          license: "MIT",
          replit: {
            "allowed-tools": ["Bash", "Read"],
          },
        },
        body: "Body",
      });

      const frontmatter = ReplitSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter["allowed-tools"]).toBe("Bash Read");
    });
  });

  describe("spec-conformant frontmatter", () => {
    it("should round-trip a canonical list through generate and import", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "round-trip-skill",
        frontmatter: {
          name: "round-trip-skill",
          description: "Round trip",
          replit: { "allowed-tools": ["Bash", "Read"], license: "MIT" },
        },
        body: "Body",
        validate: true,
      });

      const emitted = ReplitSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(emitted.getFrontmatter()["allowed-tools"]).toBe("Bash Read");
      expect(emitted.toRulesyncSkill().getFrontmatter().replit).toEqual({
        "allowed-tools": ["Bash", "Read"],
        license: "MIT",
      });
    });

    it("should drop an empty allowed-tools list rather than emitting an empty value", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "empty-skill",
        frontmatter: {
          name: "empty-skill",
          description: "Empty",
          replit: { "allowed-tools": [] },
        },
        body: "Body",
        validate: true,
      });

      expect(ReplitSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "empty-skill",
        description: "Empty",
      });
    });

    it("should import a spec-conformant SKILL.md from disk", async () => {
      // The path a real user hits: `fromDir` re-parses the frontmatter, so the
      // widened schema has to hold there too, not only in the constructor.
      const skillDir = join(testDir, ".agents", "skills", "spec-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: spec-skill
description: Spec-conformant skill
allowed-tools: Bash(git:*) Read
compatibility: Requires git and docker
---

Body.`,
      );

      const skill = await ReplitSkill.fromDir({ outputRoot: testDir, dirName: "spec-skill" });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Bash(git:*) Read");
      expect(skill.getFrontmatter().compatibility).toBe("Requires git and docker");
    });

    it("should construct from the spec's string forms without throwing", () => {
      const skill = new ReplitSkill({
        outputRoot: testDir,
        dirName: "spec-skill",
        frontmatter: {
          name: "spec-skill",
          description: "Spec-conformant skill",
          "allowed-tools": "Bash(git:*) Read",
          compatibility: "Requires git and docker",
        },
        body: "Body",
        validate: true,
      });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Bash(git:*) Read");
      expect(skill.getFrontmatter().compatibility).toBe("Requires git and docker");
    });

    it("should normalize a space-separated allowed-tools back to the canonical array on import", () => {
      const skill = new ReplitSkill({
        outputRoot: testDir,
        dirName: "spec-skill",
        frontmatter: {
          name: "spec-skill",
          description: "Spec-conformant skill",
          "allowed-tools": "Bash(git:*) Read",
        },
        body: "Body",
        validate: true,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().replit).toEqual({
        "allowed-tools": ["Bash(git:*)", "Read"],
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-targets-skill",
        frontmatter: {
          name: "All Targets Skill",
          description: "Skill for all targets",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'replit'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "replit-skill",
        frontmatter: {
          name: "Replit Skill",
          description: "Skill for replit",
          targets: ["copilot", "replit"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'replit'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "claudecode-only-skill",
        frontmatter: {
          name: "ClaudeCode Only Skill",
          description: "Skill for claudecode only",
          targets: ["claudecode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(ReplitSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new ReplitSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
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

    it("should carry standard optional frontmatter into the replit block", () => {
      const skill = new ReplitSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          "allowed-tools": ["read", "write"],
          license: "MIT",
          compatibility: { "agent-skills": ">=1.0.0" },
          metadata: { author: "rulesync" },
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
        replit: {
          "allowed-tools": ["read", "write"],
          license: "MIT",
          compatibility: { "agent-skills": ">=1.0.0" },
          metadata: { author: "rulesync" },
        },
      });
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill).toBeInstanceOf(ReplitSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = ReplitSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
