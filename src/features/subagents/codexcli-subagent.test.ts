import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolSubagent } from "./tool-subagent.js";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodexCliSubagent, CodexCliSubagentTomlSchema } from "./codexcli-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("CodexCliSubagent", () => {
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

  describe("CodexCliSubagentTomlSchema", () => {
    it("should validate valid TOML data with all fields", () => {
      const validData = {
        name: "reviewer",
        description: "Code reviewer agent",
        developer_instructions: "Review code for bugs",
        model: "gpt-5",
        model_reasoning_effort: "high",
        sandbox_mode: "full",
      };

      const result = CodexCliSubagentTomlSchema.parse(validData);
      expect(result).toEqual(validData);
    });

    it("should validate with only required fields", () => {
      const minimalData = { name: "test" };
      const result = CodexCliSubagentTomlSchema.parse(minimalData);
      expect(result.name).toBe("test");
    });

    it("should throw for missing name", () => {
      expect(() => CodexCliSubagentTomlSchema.parse({ description: "test" })).toThrow();
    });

    it("should throw for invalid name type", () => {
      expect(() => CodexCliSubagentTomlSchema.parse({ name: 123 })).toThrow();
    });

    it("should allow additional properties (looseObject)", () => {
      const data = { name: "test", custom_field: "value" };
      const result = CodexCliSubagentTomlSchema.parse(data);
      expect(result).toHaveProperty("custom_field", "value");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for codexcli subagents", () => {
      const paths = CodexCliSubagent.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".codex", "agents"),
      });
    });

    it("should return same paths for global mode", () => {
      expect(CodexCliSubagent.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".codex", "agents"),
      });
    });
  });

  describe("constructor", () => {
    it("should create instance with valid TOML body", () => {
      const body = 'name = "Test Agent"\ndescription = "Test description"';
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "test-agent.toml",
        body,
        fileContent: body,
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CodexCliSubagent);
      expect(subagent.getBody()).toBe(body);
    });

    it("should create instance with invalid TOML body when validate is false", () => {
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "invalid.toml",
        body: "not valid toml",
        fileContent: "not valid toml",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(CodexCliSubagent);
      expect(subagent.validate().success).toBe(false);
    });

    it("should create instance without validation when validate is false", () => {
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "test.toml",
        body: "",
        fileContent: "",
        validate: false,
      });

      expect(subagent).toBeInstanceOf(CodexCliSubagent);
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert to RulesyncSubagent with codexcli target", () => {
      const toml = [
        'name = "reviewer"',
        'description = "Review agent"',
        'developer_instructions = "Review the code"',
        'model = "gpt-5"',
      ].join("\n");

      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "reviewer.toml",
        body: toml,
        fileContent: toml,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
        targets: ["codexcli"],
        name: "reviewer",
        description: "Review agent",
        codexcli: {
          model: "gpt-5",
        },
      });
      expect(rulesyncSubagent.getBody()).toBe("Review the code");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("reviewer.md");
    });

    it("should throw descriptive error for invalid TOML body", () => {
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "broken.toml",
        body: "not valid toml {{{}",
        fileContent: "",
        validate: false,
      });

      expect(() => subagent.toRulesyncSubagent()).toThrow(/Failed to parse TOML in/);
      expect(() => subagent.toRulesyncSubagent()).toThrow(/broken\.toml/);
    });

    it("should handle TOML without extra fields (no codexcli section)", () => {
      const toml = ['name = "simple"', 'description = "Simple agent"'].join("\n");

      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "simple.toml",
        body: toml,
        fileContent: toml,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toEqual({
        targets: ["codexcli"],
        name: "simple",
        description: "Simple agent",
      });
      expect(rulesyncSubagent.getBody()).toBe("");
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should create CodexCliSubagent from RulesyncSubagent with frontmatter", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "reviewer.md",
        frontmatter: {
          targets: ["codexcli"],
          name: "reviewer",
          description: "Code reviewer",
          codexcli: {
            model: "gpt-5",
            sandbox_mode: "full",
          },
        },
        body: "Review code changes",
        validate: true,
      });

      const codexcliSubagent = CodexCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        rulesyncSubagent,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      }) as CodexCliSubagent;

      expect(codexcliSubagent).toBeInstanceOf(CodexCliSubagent);
      expect(codexcliSubagent.getRelativeDirPath()).toBe(join(".codex", "agents"));
      expect(codexcliSubagent.getRelativeFilePath()).toBe("reviewer.toml");

      // Verify TOML body contains expected fields
      expect(codexcliSubagent.getBody()).toContain('name = "reviewer"');
      expect(codexcliSubagent.getBody()).toContain('description = "Code reviewer"');
      expect(codexcliSubagent.getBody()).toContain(
        'developer_instructions = "Review code changes"',
      );
      expect(codexcliSubagent.getBody()).toContain('model = "gpt-5"');
      expect(codexcliSubagent.getBody()).toContain('sandbox_mode = "full"');
    });

    it("should not allow codexcli section to override name or description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "override.md",
        frontmatter: {
          targets: ["codexcli"],
          name: "correct-name",
          description: "correct description",
          codexcli: {
            name: "wrong-name",
            description: "wrong description",
            model: "gpt-5",
          },
        },
        body: "Correct instructions",
        validate: true,
      });

      const codexcliSubagent = CodexCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        rulesyncSubagent,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      }) as CodexCliSubagent;

      expect(codexcliSubagent.getBody()).toContain('name = "correct-name"');
      expect(codexcliSubagent.getBody()).toContain('description = "correct description"');
      expect(codexcliSubagent.getBody()).toContain('model = "gpt-5"');
      expect(codexcliSubagent.getBody()).not.toContain("wrong-name");
      expect(codexcliSubagent.getBody()).not.toContain("wrong description");
    });

    it("should handle empty body and description", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "minimal.md",
        frontmatter: {
          targets: ["codexcli"],
          name: "minimal",
          description: "",
        },
        body: "",
        validate: true,
      });

      const codexcliSubagent = CodexCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        rulesyncSubagent,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      }) as CodexCliSubagent;

      expect(codexcliSubagent).toBeInstanceOf(CodexCliSubagent);
      expect(codexcliSubagent.getBody()).toContain('name = "minimal"');
      // Empty description and body should not produce those keys
      expect(codexcliSubagent.getBody()).not.toContain("description");
      expect(codexcliSubagent.getBody()).not.toContain("developer_instructions");
    });
  });

  describe("fromFile", () => {
    it("should load CodexCliSubagent from TOML file", async () => {
      const agentsDir = join(testDir, ".codex", "agents");
      const filePath = join(agentsDir, "planner.toml");
      const tomlContent = [
        'name = "planner"',
        'description = "Planning agent"',
        'developer_instructions = "You are a planner agent"',
      ].join("\n");

      await writeFileContent(filePath, tomlContent);

      const subagent = await CodexCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "planner.toml",
      });

      expect(subagent).toBeInstanceOf(CodexCliSubagent);
      expect(subagent.getBody()).toContain('name = "planner"');
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        CodexCliSubagent.fromFile({
          baseDir: testDir,
          relativeFilePath: "non-existent.toml",
          validate: true,
        }),
      ).rejects.toThrow();
    });

    it("should load file with invalid TOML content and fail validation", async () => {
      const agentsDir = join(testDir, ".codex", "agents");
      const filePath = join(agentsDir, "invalid.toml");

      await writeFileContent(filePath, "not valid toml");

      const subagent = await CodexCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "invalid.toml",
        validate: true,
      });

      expect(subagent).toBeInstanceOf(CodexCliSubagent);
      expect(subagent.validate().success).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return success for valid TOML body", () => {
      const body = 'name = "test"';
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "test.toml",
        body,
        fileContent: body,
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail validation for invalid TOML", () => {
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "invalid.toml",
        body: "not valid toml {{{}",
        fileContent: "",
        validate: false,
      });

      const result = subagent.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["*"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(CodexCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for codexcli target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["codexcli"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(CodexCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for different target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: { targets: ["cursor"], name: "Test", description: "Test" },
        body: "Body",
      });

      expect(CodexCliSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create deletable placeholder", () => {
      const subagent = CodexCliSubagent.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "obsolete.toml",
      });

      expect(subagent.isDeletable()).toBe(true);
      expect(subagent.getBody()).toBe("");
    });
  });

  describe("round-trip conversion", () => {
    it("should preserve tool-specific fields through round-trip", async () => {
      const agentsDir = join(testDir, ".codex", "agents");
      const filePath = join(agentsDir, "test-agent.toml");
      const tomlContent = [
        'name = "test-agent"',
        'description = "Test agent for import"',
        'developer_instructions = "You are a test agent"',
        'model = "gpt-5"',
        'sandbox_mode = "full"',
      ].join("\n");

      await writeFileContent(filePath, tomlContent);

      // TOML file → CodexCliSubagent → RulesyncSubagent
      const codexcliSubagent = await CodexCliSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-agent.toml",
      });

      const rulesyncSubagent = codexcliSubagent.toRulesyncSubagent();

      expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
        targets: ["codexcli"],
        name: "test-agent",
        description: "Test agent for import",
        codexcli: {
          model: "gpt-5",
          sandbox_mode: "full",
        },
      });
      expect(rulesyncSubagent.getBody()).toBe("You are a test agent");
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-agent.md");
    });

    it("should preserve fields through full round-trip (RulesyncSubagent → CodexCli → RulesyncSubagent)", () => {
      const originalRulesync = new RulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "round-trip.md",
        frontmatter: {
          targets: ["codexcli"],
          name: "round-trip-agent",
          description: "Round trip test",
          codexcli: {
            model: "gpt-5",
            sandbox_mode: "full",
            model_reasoning_effort: "high",
          },
        },
        body: "You are a round-trip agent",
        validate: true,
      });

      // RulesyncSubagent → CodexCliSubagent
      const codexcliSubagent = CodexCliSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        rulesyncSubagent: originalRulesync,
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      }) as CodexCliSubagent;

      // CodexCliSubagent → RulesyncSubagent
      const restored = codexcliSubagent.toRulesyncSubagent();

      expect(restored.getFrontmatter()).toMatchObject({
        targets: ["codexcli"],
        name: "round-trip-agent",
        description: "Round trip test",
        codexcli: {
          model: "gpt-5",
          sandbox_mode: "full",
          model_reasoning_effort: "high",
        },
      });
      expect(restored.getBody()).toBe("You are a round-trip agent");
    });
  });

  describe("edge cases", () => {
    it("should handle empty body content", () => {
      const body = 'name = "empty"';
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "empty.toml",
        body,
        fileContent: body,
        validate: true,
      });

      expect(subagent.getBody()).toBe(body);
    });

    it("should handle multiline developer_instructions in TOML", () => {
      const toml = [
        'name = "multi"',
        'developer_instructions = """',
        "Line 1",
        "Line 2",
        "Line 3",
        '"""',
      ].join("\n");

      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "multi.toml",
        body: toml,
        fileContent: toml,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getBody()).toContain("Line 1");
      expect(rulesyncSubagent.getBody()).toContain("Line 2");
    });

    it("should handle special characters in TOML values", () => {
      const toml = [
        'name = "special-agent"',
        'description = "Quotes: \\"Hello \'World\'\\""',
        'developer_instructions = "Unicode: \u4f60\u597d\u4e16\u754c"',
      ].join("\n");

      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "special.toml",
        body: toml,
        fileContent: toml,
        validate: true,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().name).toBe("special-agent");
      expect(rulesyncSubagent.getBody()).toContain("\u4f60\u597d\u4e16\u754c");
    });

    it("should be assignable to ToolSubagent type", () => {
      const body = 'name = "test"';
      const subagent = new CodexCliSubagent({
        baseDir: testDir,
        relativeDirPath: ".codex/agents",
        relativeFilePath: "test.toml",
        body,
        fileContent: body,
        validate: false,
      });

      const toolSubagent: ToolSubagent = subagent;
      expect(toolSubagent).toBeDefined();
    });
  });
});
