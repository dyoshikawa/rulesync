import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CopilotcliSkill, CopilotcliSkillFrontmatterSchema } from "./copilotcli-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CopilotcliSkill", () => {
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
    it("should create a CopilotcliSkill with valid frontmatter and body", () => {
      const skill = new CopilotcliSkill({
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
          new CopilotcliSkill({
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
      const skill = new CopilotcliSkill({
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
      const skill = new CopilotcliSkill({
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
      const result = CopilotcliSkillFrontmatterSchema.safeParse({
        name: "skill-name",
        description: "Skill description",
        license: "Apache-2.0",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid frontmatter", () => {
      const result = CopilotcliSkillFrontmatterSchema.safeParse({ name: 123, description: true });

      expect(result.success).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should load a skill from the project .github/skills directory", async () => {
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

      const skill = await CopilotcliSkill.fromDir({
        outputRoot: testDir,
        dirName: "webapp-testing",
      });

      expect(skill).toBeInstanceOf(CopilotcliSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "webapp-testing",
        description: "Web application testing steps",
        license: "Apache-2.0",
      });
      expect(skill.getBody()).toBe("Skill content goes here.");
    });
  });

  describe("getSettablePaths", () => {
    it("should return the project .github/skills directory", () => {
      const paths = CopilotcliSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".github", "skills"));
    });

    it("should return the personal .copilot/skills directory for global mode", () => {
      const paths = CopilotcliSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".copilot", "skills"));
    });
  });

  describe("conversion", () => {
    it("should convert to RulesyncSkill with copilotcli metadata", () => {
      const skill = new CopilotcliSkill({
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
        copilotcli: { license: "MIT" },
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
          copilotcli: { license: "Apache-2.0" },
        },
        body: "Follow the testing plan",
      });

      const copilotcliSkill = CopilotcliSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(copilotcliSkill.getFrontmatter()).toEqual({
        name: "webapp-testing",
        description: "Test web applications",
        license: "Apache-2.0",
      });
      expect(copilotcliSkill.getBody()).toBe("Follow the testing plan");
    });

    it("should write to ~/.copilot/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: { name: "global-skill", description: "Global", targets: ["*"] },
        body: "content",
      });

      const copilotcliSkill = CopilotcliSkill.fromRulesyncSkill({ rulesyncSkill, global: true });
      expect(copilotcliSkill.getRelativeDirPath()).toBe(join(".copilot", "skills"));
    });

    it("should round-trip the allowed-tools skill frontmatter", () => {
      const skill = new CopilotcliSkill({
        dirName: "shell-skill",
        frontmatter: {
          name: "shell-skill",
          description: "Runs shell",
          "allowed-tools": "shell",
        },
        body: "body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().copilotcli).toEqual({ "allowed-tools": "shell" });

      const roundTripped = CopilotcliSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter()["allowed-tools"]).toBe("shell");
    });

    it("should round-trip the argument-hint skill frontmatter", () => {
      const skill = new CopilotcliSkill({
        dirName: "hint-skill",
        frontmatter: {
          name: "hint-skill",
          description: "Takes an argument",
          "argument-hint": "[message]",
        },
        body: "body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().copilotcli).toEqual({
        "argument-hint": "[message]",
      });

      const roundTripped = CopilotcliSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter()["argument-hint"]).toBe("[message]");
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

      expect(CopilotcliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets include copilotcli", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "copilotcli-skill",
        frontmatter: {
          name: "copilotcli-skill",
          description: "Only copilotcli",
          targets: ["copilotcli"],
        },
        body: "content",
      });

      expect(CopilotcliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when copilotcli is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "cursor-skill",
        frontmatter: { name: "cursor-skill", description: "Cursor only", targets: ["cursor"] },
        body: "content",
      });

      expect(CopilotcliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = CopilotcliSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: ".github/skills",
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(".github/skills");
      expect(skill.getGlobal()).toBe(false);
    });
  });
});
