import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import {
  SimulatedSkill,
  SimulatedSkillFrontmatter,
  SimulatedSkillFrontmatterSchema,
} from "./simulated-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

// Create a concrete test implementation of SimulatedSkill
class TestSimulatedSkill extends SimulatedSkill {
  static getSettablePaths(): ToolSkillSettablePaths {
    return {
      relativeDirPath: ".test/skills",
    };
  }

  protected static override readonly toolTarget = "copilot"; // Use any valid target for testing
}

describe("SimulatedSkill", () => {
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
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the simulated skill.\nIt can be multiline.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(TestSimulatedSkill);
      expect(skill.getBody()).toBe(
        "This is the body of the simulated skill.\nIt can be multiline.",
      );
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance with empty name and description", () => {
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
        dirName: "test-skill",
        frontmatter: {
          name: "",
          description: "",
        },
        body: "This is a simulated skill without name or description.",
        validate: true,
      });

      expect(skill.getBody()).toBe("This is a simulated skill without name or description.");
      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
    });

    it("should create instance without validation when validate is false", () => {
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
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
        new TestSimulatedSkill({
          outputRoot: testDir,
          relativeDirPath: ".test/skills",
          dirName: "test-skill",
          frontmatter: {
            // Missing required fields
            invalid: true,
          } as any,
          body: "Test body",
          validate: true,
        });
      }).toThrow();
    });
  });

  describe("toRulesyncSkill", () => {
    it("should throw error because SimulatedSkill is simulated", () => {
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      expect(() => skill.toRulesyncSkill()).toThrow(
        "Not implemented because it is a SIMULATED skill.",
      );
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

      expect(TestSimulatedSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes the specific tool", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "copilot-skill",
        frontmatter: {
          name: "Copilot Skill",
          description: "Skill for copilot",
          targets: ["copilot", "cursor"],
        },
        body: "Test body",
        validate: true,
      });

      expect(TestSimulatedSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include the specific tool", () => {
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

      // TestSimulatedSkill uses "copilot" as target, so this should be false
      expect(TestSimulatedSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });

    it("should return true when targets is not specified (defaults to '*')", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "default-targets-skill",
        frontmatter: {
          name: "Default Targets Skill",
          description: "Skill with default targets",
          // targets not specified, should default to ["*"]
        },
        body: "Test body",
        validate: true,
      });

      expect(TestSimulatedSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const skill = new TestSimulatedSkill({
        outputRoot: testDir,
        relativeDirPath: ".test/skills",
        dirName: "test-skill",
        frontmatter: {
          // Missing required fields
          invalid: true,
        } as any,
        body: "Test body",
        validate: false,
      });

      const result = skill.validate();
      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });
  });

  describe("SimulatedSkillFrontmatterSchema", () => {
    it("should validate correct frontmatter", () => {
      const validFrontmatter: SimulatedSkillFrontmatter = {
        name: "Test Skill",
        description: "Test description",
      };

      const result = SimulatedSkillFrontmatterSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validFrontmatter);
      }
    });

    it("should reject frontmatter without name", () => {
      const invalidFrontmatter = {
        description: "Test description",
      };

      const result = SimulatedSkillFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });

    it("should reject frontmatter without description", () => {
      const invalidFrontmatter = {
        name: "Test Skill",
      };

      const result = SimulatedSkillFrontmatterSchema.safeParse(invalidFrontmatter);
      expect(result.success).toBe(false);
    });
  });
});
