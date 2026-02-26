import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  RulesyncRule,
  type RulesyncRuleFrontmatterInput,
  RulesyncRuleFrontmatterSchema,
} from "./rulesync-rule.js";

describe("RulesyncRule", () => {
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
    it("should create a RulesyncRule with valid frontmatter and body", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        root: true,
        targets: ["copilot", "cursor"],
        description: "Test rule",
        globs: ["*.ts"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "This is a test rule body",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("This is a test rule body");
    });

    it("should validate frontmatter by default", () => {
      const invalidFrontmatter = {
        root: "invalid", // Should be boolean
        targets: "invalid", // Should be array
      } as any;

      expect(() => {
        const rule = new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: "rules",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter,
          body: "Test body",
        });
        return rule;
      }).toThrow();
    });

    it("should skip validation when validate is false", () => {
      const invalidFrontmatter = {
        root: "invalid",
        targets: "invalid",
      } as any;

      expect(() => {
        const rule = new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: "rules",
          relativeFilePath: "test.md",
          frontmatter: invalidFrontmatter,
          body: "Test body",
          validate: false,
        });
        return rule;
      }).not.toThrow();
    });

    it("should handle minimal frontmatter with default targets", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {};

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Minimal rule",
      });

      // Default targets should be applied
      expect(rule.getFrontmatter()).toEqual({ targets: ["*"] });
      expect(rule.getBody()).toBe("Minimal rule");
    });

    it("should handle localRoot field", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        localRoot: true,
        targets: ["claudecode"],
        description: "Local root rule",
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "local-root.md",
        frontmatter,
        body: "This is a local root rule",
      });

      expect(rule.getFrontmatter().localRoot).toBe(true);
    });

    it("should handle cursor-specific configuration", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        root: false,
        targets: ["cursor"],
        description: "Cursor-specific rule",
        globs: ["*.tsx"],
        cursor: {
          alwaysApply: true,
          description: "Always apply this rule",
          globs: ["src/**/*.tsx"],
        },
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "cursor-rule.md",
        frontmatter,
        body: "Cursor rule body",
      });

      expect(rule.getFrontmatter().cursor).toEqual({
        alwaysApply: true,
        description: "Always apply this rule",
        globs: ["src/**/*.tsx"],
      });
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        root: true,
        targets: ["*"],
        description: "Test description",
        globs: ["**/*.js"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test body",
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("getBody", () => {
    it("should return the rule body", () => {
      const body = "This is the rule content\nwith multiple lines";

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {},
        body,
      });

      expect(rule.getBody()).toBe(body);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: RulesyncRuleFrontmatterInput = {
        root: true,
        targets: ["copilot"],
        description: "Valid rule",
        globs: ["*.ts"],
      };

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter,
        body: "Test body",
        validate: false, // Skip constructor validation to test validate method
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        root: "not-a-boolean",
        targets: 123,
      } as any;

      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: invalidFrontmatter,
        body: "Test body",
        validate: false, // Skip constructor validation
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return success when frontmatter is undefined", () => {
      // Create a rule with undefined frontmatter by bypassing the constructor
      const rule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: {} as any,
        body: "Test body",
        validate: false,
      });

      // Manually set frontmatter to undefined
      (rule as any).frontmatter = undefined;

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("fromFile", () => {
    it("should load rule from file with valid frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: true
targets:
  - copilot
  - cursor
description: Test rule from file
globs:
  - "*.ts"
  - "*.tsx"
---

This is the rule body content.
It can span multiple lines.`;

      const filePath = join(rulesDir, "test-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "test-rule.md",
      });

      expect(rule.getFrontmatter()).toEqual({
        root: true,
        localRoot: false,
        targets: ["copilot", "cursor"],
        description: "Test rule from file",
        globs: ["*.ts", "*.tsx"],
        cursor: undefined,
      });
      expect(rule.getBody()).toBe("This is the rule body content.\nIt can span multiple lines.");
    });

    it("should apply default values for missing frontmatter fields", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
description: Minimal rule
---

Rule body`;

      const filePath = join(rulesDir, "minimal-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "minimal-rule.md",
      });

      expect(rule.getFrontmatter()).toEqual({
        root: false,
        localRoot: false,
        targets: ["*"],
        description: "Minimal rule",
        globs: [],
        cursor: undefined,
      });
      expect(rule.getBody()).toBe("Rule body");
    });

    it("should throw error for invalid frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: not-a-boolean
targets: not-an-array
---

Invalid rule`;

      const filePath = join(rulesDir, "invalid-rule.md");
      await writeFileContent(filePath, ruleContent);

      await expect(
        RulesyncRule.fromFile({
          relativeFilePath: "invalid-rule.md",
        }),
      ).rejects.toThrow("Invalid frontmatter");
    });

    it("should handle cursor configuration in frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: false
targets:
  - cursor
description: Cursor rule
cursor:
  alwaysApply: true
  description: "Always apply cursor config"
  globs:
    - "src/**/*.ts"
---

Cursor-specific rule body`;

      const filePath = join(rulesDir, "cursor-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "cursor-rule.md",
      });

      expect(rule.getFrontmatter().cursor).toEqual({
        alwaysApply: true,
        description: "Always apply cursor config",
        globs: ["src/**/*.ts"],
      });
    });

    it("should handle agentsmd configuration in frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: false
targets:
  - agentsmd
  - codexcli
description: Subproject rule
agentsmd:
  subprojectPath: "packages/my-app"
---

Subproject-specific rule body`;

      const filePath = join(rulesDir, "agentsmd-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "agentsmd-rule.md",
      });

      expect(rule.getFrontmatter()).toEqual({
        root: false,
        localRoot: false,
        targets: ["agentsmd", "codexcli"],
        description: "Subproject rule",
        globs: [],
        cursor: undefined,
        agentsmd: {
          subprojectPath: "packages/my-app",
        },
      });
      expect(rule.getBody()).toBe("Subproject-specific rule body");
    });

    it("should load rule with localRoot field", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
localRoot: true
targets:
  - claudecode
description: Local root rule
---

Local root rule body`;

      const filePath = join(rulesDir, "local-root.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "local-root.md",
      });

      expect(rule.getFrontmatter().localRoot).toBe(true);
      expect(rule.getBody()).toBe("Local root rule body");
    });

    it("should default localRoot to false when not specified", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: true
targets:
  - copilot
description: Rule without localRoot
---

Rule body`;

      const filePath = join(rulesDir, "no-local-root.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "no-local-root.md",
      });

      expect(rule.getFrontmatter().localRoot).toBe(false);
    });

    it("should trim whitespace from body content", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
description: Whitespace test
---

   
This has leading and trailing whitespace.   

   `;

      const filePath = join(rulesDir, "whitespace-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "whitespace-rule.md",
      });

      expect(rule.getBody()).toBe("This has leading and trailing whitespace.");
    });
  });

  describe("RulesyncRuleFrontmatterSchema", () => {
    it("should validate minimal valid frontmatter", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should validate complete valid frontmatter", () => {
      const frontmatter = {
        root: true,
        targets: ["copilot", "cursor"],
        description: "Test description",
        globs: ["*.ts", "*.js"],
        cursor: {
          alwaysApply: false,
          description: "Cursor desc",
          globs: ["src/**/*"],
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(frontmatter);
    });

    it("should validate frontmatter with agentsmd field", () => {
      const frontmatter = {
        root: false,
        targets: ["agentsmd"],
        description: "Test with agentsmd",
        globs: ["**/*.ts"],
        agentsmd: {
          subprojectPath: "packages/my-app",
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(frontmatter);
    });

    it("should validate frontmatter with empty agentsmd subprojectPath", () => {
      const frontmatter = {
        root: false,
        targets: ["agentsmd"],
        agentsmd: {
          subprojectPath: "",
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentsmd?.subprojectPath).toBe("");
      }
    });

    it("should validate frontmatter with agentsmd but no subprojectPath", () => {
      const frontmatter = {
        root: false,
        targets: ["agentsmd"],
        agentsmd: {},
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agentsmd).toEqual({});
      }
    });

    it("should validate frontmatter with localRoot field", () => {
      const frontmatter = {
        localRoot: true,
        targets: ["claudecode"],
        description: "Local root rule",
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data?.localRoot).toBe(true);
    });

    it("should reject invalid localRoot field", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({
        localRoot: "not-boolean",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid root field", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({
        root: "not-boolean",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid targets field", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({
        targets: "not-array",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid description field", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({
        description: 123,
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid globs field", () => {
      const result = RulesyncRuleFrontmatterSchema.safeParse({
        globs: "not-array",
      });
      expect(result.success).toBe(false);
    });

    it("should validate cursor configuration", () => {
      const frontmatter = {
        cursor: {
          alwaysApply: true,
          description: "Cursor description",
          globs: ["*.ts"],
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data?.cursor).toEqual(frontmatter.cursor);
    });

    it("should reject invalid cursor configuration", () => {
      const frontmatter = {
        cursor: {
          alwaysApply: "not-boolean",
          description: 123,
          globs: "not-array",
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(false);
    });

    it("should validate copilot configuration", () => {
      const frontmatter = {
        copilot: {
          excludeAgent: "code-review" as const,
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);

      expect(result.success).toBe(true);
      expect(result.data?.copilot).toEqual(frontmatter.copilot);
    });

    it("should reject invalid copilot configuration", () => {
      const frontmatter = {
        copilot: {
          excludeAgent: "unknown-agent",
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);

      expect(result.success).toBe(false);
    });

    it("should allow partial cursor configuration", () => {
      const frontmatter = {
        cursor: {
          alwaysApply: true,
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data?.cursor).toEqual({ alwaysApply: true });
    });
  });

  describe("integration", () => {
    it("should create and validate a complete rule workflow", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // Create a comprehensive rule file
      const ruleContent = `---
root: true
targets:
  - copilot
  - cursor
  - cline
description: "Comprehensive integration test rule"
globs:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "!**/*.test.ts"
cursor:
  alwaysApply: true
  description: "Special cursor behavior"
  globs:
    - "components/**/*.tsx"
---

# Integration Test Rule

This rule demonstrates comprehensive functionality:

1. **Root rule**: This is a project-level rule
2. **Multi-target**: Works with multiple AI tools
3. **File patterns**: Includes and excludes specific files
4. **Tool-specific**: Has special cursor configuration

## Guidelines

- Follow TypeScript best practices
- Use modern ES modules
- Implement comprehensive error handling
- Write descriptive commit messages

## Examples

\`\`\`typescript
// Example code structure
export interface ExampleInterface {
  id: string;
  name: string;
  isActive: boolean;
}
\`\`\``;

      const filePath = join(rulesDir, "integration-test.md");
      await writeFileContent(filePath, ruleContent);

      // Test loading from file
      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "integration-test.md",
      });

      // Validate frontmatter
      expect(rule.getFrontmatter().root).toBe(true);
      expect(rule.getFrontmatter().targets).toEqual(["copilot", "cursor", "cline"]);
      expect(rule.getFrontmatter().description).toBe("Comprehensive integration test rule");
      expect(rule.getFrontmatter().globs).toEqual(["src/**/*.ts", "src/**/*.tsx", "!**/*.test.ts"]);
      expect(rule.getFrontmatter().cursor).toEqual({
        alwaysApply: true,
        description: "Special cursor behavior",
        globs: ["components/**/*.tsx"],
      });

      // Validate body content
      const body = rule.getBody();
      expect(body).toContain("# Integration Test Rule");
      expect(body).toContain("Follow TypeScript best practices");
      expect(body).toContain("export interface ExampleInterface");

      // Test validation
      const validationResult = rule.validate();
      expect(validationResult.success).toBe(true);
      expect(validationResult.error).toBeNull();

      // Test that the rule can be recreated with constructor
      const recreatedRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "integration-test.md",
        frontmatter: rule.getFrontmatter(),
        body: rule.getBody(),
      });

      expect(recreatedRule.getFrontmatter()).toEqual(rule.getFrontmatter());
      expect(recreatedRule.getBody()).toBe(rule.getBody());
    });
  });
});
