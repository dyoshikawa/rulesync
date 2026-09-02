import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotSkill, CopilotSkillFrontmatterSchema } from "./copilot-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CopilotSkill", () => {
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

  describe("constructor", () => {
    it("should create a CopilotSkill with valid frontmatter and body", () => {
      const skill = new CopilotSkill({
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
          license: "MIT",
        },
        body: "This is a test skill body",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "Test skill description",
        license: "MIT",
      });
      expect(skill.getBody()).toBe("This is a test skill body");
      expect(skill.getOtherFiles()).toEqual([]);
      expect(skill.getRelativeDirPath()).toBe(join(".github", "skills"));
    });

    it("should skip validation when validate is false", () => {
      expect(
        () =>
          new CopilotSkill({
            dirName: "invalid-skill",
            frontmatter: { name: 123 as unknown as string, description: true as unknown as string },
            body: "Test body",
            validate: false,
          }),
      ).not.toThrow();
    });
  });

  describe("validate", () => {
    it("should validate successfully with valid frontmatter", () => {
      const skill = new CopilotSkill({
        dirName: "valid-skill",
        frontmatter: {
          name: "valid-skill",
          description: "Valid skill description",
        },
        body: "Valid body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
    });

    it("should fail validation when mainFile is missing", () => {
      const skill = new CopilotSkill({
        dirName: "missing-main",
        frontmatter: {
          name: "missing-main",
          description: "Missing main file",
        },
        body: "content",
        validate: false,
      });

      (skill as unknown as { mainFile: undefined }).mainFile = undefined;

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("schema", () => {
    it("should accept frontmatter with license", () => {
      const result = CopilotSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
        license: "Apache-2.0",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid frontmatter", () => {
      const result = CopilotSkillFrontmatterSchema.safeParse({ name: 123, description: true });

      expect(result.success).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load a skill from directory", async () => {
      const skillDir = join(testDir, ".github", "skills", "webapp-testing");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: webapp-testing
description: Web application testing steps
license: Apache-2.0
---

Skill content goes here.`,
      );

      const skill = await CopilotSkill.fromDir({ outputRoot: testDir, dirName: "webapp-testing" });

      expect(skill).toBeInstanceOf(CopilotSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "webapp-testing",
        description: "Web application testing steps",
        license: "Apache-2.0",
      });
      expect(skill.getBody()).toBe("Skill content goes here.");
    });
  });

  describe("getSettablePaths", () => {
    it("should return the GitHub skills directory", () => {
      const paths = CopilotSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".github", "skills"));
    });

    it("should return the personal .copilot/skills directory for global mode", () => {
      const paths = CopilotSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".copilot", "skills"));
    });
  });

  describe("conversion", () => {
    it("should convert to RulesyncSkill with copilot metadata", () => {
      const skill = new CopilotSkill({
        dirName: "debugging",
        frontmatter: {
          name: "debugging",
          description: "Debug failing workflows",
          license: "MIT",
        },
        body: "Use workflow tools",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "debugging",
        description: "Debug failing workflows",
        targets: ["*"],
        copilot: { license: "MIT" },
      });
    });

    it("should convert from RulesyncSkill and preserve license", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "webapp-testing",
        frontmatter: {
          name: "webapp-testing",
          description: "Test web applications",
          targets: ["*"],
          copilot: { license: "Apache-2.0" },
        },
        body: "Follow the testing plan",
      });

      const copilotSkill = CopilotSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(copilotSkill.getFrontmatter()).toEqual({
        name: "webapp-testing",
        description: "Test web applications",
        license: "Apache-2.0",
      });
      expect(copilotSkill.getBody()).toBe("Follow the testing plan");
    });

    it("should write to ~/.copilot/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global", targets: ["*"] },
        body: "content",
      });

      const copilotSkill = CopilotSkill.fromRulesyncSkill({ rulesyncSkill, global: true });
      expect(copilotSkill.getRelativeDirPath()).toBe(join(".copilot", "skills"));
    });

    it("should round-trip the allowed-tools skill frontmatter", () => {
      const skill = new CopilotSkill({
        dirName: "shell-skill",
        frontmatter: {
          name: "shell-skill",
          description: "Runs shell",
          "allowed-tools": "shell",
        },
        body: "body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().copilot).toEqual({ "allowed-tools": "shell" });

      const roundTripped = CopilotSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter()["allowed-tools"]).toBe("shell");
    });

    it("should round-trip argument-hint, both invocation gates and context", () => {
      const skill = new CopilotSkill({
        dirName: "release",
        frontmatter: {
          name: "release",
          description: "Cut a release",
          "argument-hint": "<version>",
          "user-invocable": true,
          "disable-model-invocation": true,
          context: "fork",
        },
        body: "body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().copilot).toEqual({
        "argument-hint": "<version>",
        "user-invocable": true,
        "disable-model-invocation": true,
        context: "fork",
      });

      const roundTripped = CopilotSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter()).toEqual({
        name: "release",
        description: "Cut a release",
        "argument-hint": "<version>",
        "user-invocable": true,
        "disable-model-invocation": true,
        context: "fork",
      });
    });

    it("should round-trip a frontmatter field beyond the schema", () => {
      const skill = new CopilotSkill({
        dirName: "future",
        frontmatter: {
          name: "future",
          description: "Uses a field rulesync does not model",
          // Not modeled by rulesync: it used to be dropped on import and then
          // erased from the SKILL.md on the next generate.
          futureCopilotField: "keep-me",
        },
        body: "body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().copilot).toEqual({ futureCopilotField: "keep-me" });

      const roundTripped = CopilotSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter()).toEqual({
        name: "future",
        description: "Uses a field rulesync does not model",
        futureCopilotField: "keep-me",
      });
    });

    it("lets the canonical name and description win over the section", () => {
      // Assigned through a variable: the section type does not model these two
      // keys, which is exactly what makes them worth pinning here.
      const shadowingSection = {
        license: "MIT",
        name: "section-name",
        description: "Section description",
      };
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "shadowed",
        frontmatter: {
          name: "shadowed",
          description: "Canonical description",
          targets: ["*"],
          // A section is written before the canonical fields, so keys that
          // have a canonical home must not be shadowed by it.
          copilot: shadowingSection,
        },
        body: "body",
      });

      expect(CopilotSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "shadowed",
        description: "Canonical description",
        license: "MIT",
      });
    });

    it("should take the invocation gates from the top-level defaults, section wins", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "gated",
        frontmatter: {
          name: "gated",
          description: "Gated skill",
          targets: ["*"],
          // A `false` in the section must win over a `true` default rather
          // than reading as absent.
          "user-invocable": true,
          "disable-model-invocation": true,
          copilot: { "user-invocable": false },
        },
        body: "body",
      });

      const copilotSkill = CopilotSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(copilotSkill.getFrontmatter()["user-invocable"]).toBe(false);
      expect(copilotSkill.getFrontmatter()["disable-model-invocation"]).toBe(true);
    });

    it("should fall back to the root-level license/compatibility/metadata when the copilot section omits them", () => {
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

      const frontmatter = CopilotSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      // Copilot models `license` alone, so the other root-level fields
      // never reach its frontmatter.
      expect(frontmatter).toEqual({
        name: "root-fields",
        description: "Root-level standard fields",
        license: "MIT",
      });
    });

    it("should let the copilot section override the root-level license/compatibility/metadata", () => {
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
          copilot: {
            license: "Apache-2.0",
          },
        },
        body: "Body",
      });

      const frontmatter = CopilotSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter).toEqual({
        name: "section-wins",
        description: "Section overrides the root-level fields",
        license: "Apache-2.0",
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets include '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-skill",
        frontmatter: { name: "all-skill", description: "All targets", targets: ["*"] },
        body: "content",
      });

      expect(CopilotSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets include copilot", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "copilot-skill",
        frontmatter: { name: "copilot-skill", description: "Only copilot", targets: ["copilot"] },
        body: "content",
      });

      expect(CopilotSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when copilot is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "cursor-skill",
        frontmatter: { name: "cursor-skill", description: "Cursor only", targets: ["cursor"] },
        body: "content",
      });

      expect(CopilotSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = CopilotSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: ".github/skills",
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(".github/skills");
      expect(skill.getGlobal()).toBe(false);
    });
  });
});
