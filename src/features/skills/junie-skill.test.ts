import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { JunieSkill } from "./junie-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("JunieSkill", () => {
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
    it("should expose .junie/skills plus the shared .agents/skills import-only fallback at both scopes", () => {
      // Junie skills support global mode (~/.junie/skills/); the relative path
      // is identical to project mode, only the resolved outputRoot differs.
      // Junie CLI also loads skills from `<projectRoot>/.agents/skills/` and
      // `~/.agents/skills/`; rulesync reads but never writes or prunes them.
      expect(JunieSkill.getSettablePaths()).toEqual({
        relativeDirPath: join(".junie", "skills"),
        importOnlySkillRoots: [join(".agents", "skills")],
      });
      expect(JunieSkill.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".junie", "skills"),
        importOnlySkillRoots: [join(".agents", "skills")],
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new JunieSkill({
        outputRoot: testDir,
        relativeDirPath: join(".junie", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "This is the body of the junie skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getBody()).toBe("This is the body of the junie skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should throw error when frontmatter name does not match dirName", () => {
      expect(
        () =>
          new JunieSkill({
            outputRoot: testDir,
            relativeDirPath: join(".junie", "skills"),
            dirName: "test-skill",
            frontmatter: {
              name: "Different Name",
              description: "Test skill description",
            },
            body: "This is the body of the junie skill.",
            validate: true,
          }),
      ).toThrow(/frontmatter name \(Different Name\) must match directory name \(test-skill\)/);
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: test-skill
description: Test skill description
---

This is the body of the junie skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await JunieSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getBody()).toBe("This is the body of the junie skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
      });
    });

    it("should derive a missing description from the first body paragraph", async () => {
      // `description` is optional upstream: "If `description` is not provided in
      // the frontmatter, Junie CLI extracts the first paragraph of the body
      // content as the description." Importing such a skill used to abort.
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: test-skill\n---\n\nSummarizes a changelog\nfor a release.\n\nA second paragraph that is not part of the description.`,
      );

      const skill = await JunieSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

      // Wrapped lines are joined so the value is a single-line YAML scalar on
      // the next generate; the second paragraph is not included.
      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Summarizes a changelog for a release.",
      });
      expect(skill.toRulesyncSkill().getFrontmatter().description).toBe(
        "Summarizes a changelog for a release.",
      );
    });

    it("should skip markdown headings when deriving a missing description", async () => {
      // A body opening with its title would otherwise import "# Skill Name" as
      // the description — and the next generate would write that back
      // explicitly, replacing Junie's own correct fallback everywhere. Upstream
      // does not count headings: "If the body is also empty or contains only
      // headings, the skill will fail to load."
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: test-skill\n---\n\n# Test Skill\n\n## Overview\n\nSummarizes a changelog\nfor a release.\n\nA second paragraph.`,
      );

      const skill = await JunieSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

      expect(skill.getFrontmatter().description).toBe("Summarizes a changelog for a release.");
    });

    it("should take a leading code fence as content, having no heading to skip", async () => {
      // Fences are not special-cased: whatever the first non-heading paragraph
      // holds becomes the description, fence markers included.
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: test-skill\n---\n\n# Title\n\n\`\`\`bash\nnpm install\n\`\`\`\n\nProse after the fence.`,
      );

      const skill = await JunieSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" });

      expect(skill.getFrontmatter().description).toBe("```bash npm install ```");
    });

    it.each([
      ["a headings-only body", `---\nname: test-skill\n---\n\n# Title\n\n## Section\n`],
      ["an empty body", `---\nname: test-skill\n---\n`],
    ])("should refuse to import a skill with %s", async (_label, fileContent) => {
      // Junie cannot load such a skill either. The throw is turned into a
      // single skipped skill by the processor's lenientImport flag, so it never
      // aborts the whole import.
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), fileContent);

      await expect(
        JunieSkill.fromDir({ outputRoot: testDir, dirName: "test-skill" }),
      ).rejects.toThrow(/no description and its body has no paragraph/);
    });

    it("should throw error when frontmatter name does not match dirName", async () => {
      const skillDir = join(testDir, ".junie", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Different Name
description: Test skill description
---

This is the body of the junie skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        JunieSkill.fromDir({
          outputRoot: testDir,
          dirName: "test-skill",
        }),
      ).rejects.toThrow(
        /Frontmatter name \(Different Name\) must match directory name \(test-skill\)/,
      );
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".junie", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        JunieSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });

    it("should load from the shared .agents/skills import fallback, including the description fallback", async () => {
      // The shared root is where foreign-authored skills live, so it is also
      // the most likely place for a `SKILL.md` that omits `description` —
      // Junie's own optional-description rule has to keep working there.
      const skillDir = join(testDir, ".agents", "skills", "fallback");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: fallback\n---\n\nA shared skill body.`,
      );

      const skill = await JunieSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "fallback",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getFrontmatter()).toEqual({
        name: "fallback",
        description: "A shared skill body.",
      });
      expect(skill.getBody()).toBe("A shared skill body.");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "some-other-name",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const junieSkill = JunieSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(junieSkill).toBeInstanceOf(JunieSkill);
      expect(junieSkill.getDirName()).toBe("test-skill");
      expect(junieSkill.getBody()).toBe("Test body content");
      expect(junieSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
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

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'junie'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "junie-skill",
        frontmatter: {
          name: "Junie Skill",
          description: "Skill for junie",
          targets: ["copilot", "junie"],
        },
        body: "Test body",
        validate: true,
      });

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'junie'", () => {
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

      expect(JunieSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new JunieSkill({
        outputRoot: testDir,
        relativeDirPath: join(".junie", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = JunieSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".junie", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = JunieSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill).toBeInstanceOf(JunieSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = JunieSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".junie", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
