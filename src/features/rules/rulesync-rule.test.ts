import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { WarningCollectingLogger, withFallbackLoggerTarget } from "../../utils/logger.js";
import {
  AUTO_SUBPROJECT_PATH,
  RulesyncRule,
  type RulesyncRuleFrontmatterInput,
  RulesyncRuleFrontmatterSchema,
} from "./rulesync-rule.js";

/** The warnings `operation` sends through the shared fallback logger. */
const collectWarnings = async (operation: () => void): Promise<string[]> => {
  const warnings = new WarningCollectingLogger({ verbose: false, silent: true });
  await withFallbackLoggerTarget({
    logger: warnings,
    operation: async () => {
      operation();
    },
  });
  return warnings.getWarnings();
};

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
        outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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

    it("should throw error when frontmatter is missing (issue #316)", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      // A markdown file without any YAML frontmatter fence
      const ruleContent = "This is just plain markdown without frontmatter.";

      const filePath = join(rulesDir, "no-frontmatter.md");
      await writeFileContent(filePath, ruleContent);

      await expect(
        RulesyncRule.fromFile({
          relativeFilePath: "no-frontmatter.md",
        }),
      ).rejects.toThrow("Missing frontmatter");
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

    it("should handle copilot configuration in frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: false
targets:
  - copilot
description: Copilot rule
copilot:
  excludeAgent: "code-review"
---

Copilot-specific rule body`;

      const filePath = join(rulesDir, "copilot-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "copilot-rule.md",
      });

      expect(rule.getFrontmatter().copilot).toEqual({
        excludeAgent: "code-review",
      });
      expect(rule.getBody()).toBe("Copilot-specific rule body");
    });

    it("should handle claudecode configuration in frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: false
targets:
  - claudecode
description: Claude Code rule
claudecode:
  paths:
    - "src/**/*.ts"
---

Claude Code-specific rule body`;

      const filePath = join(rulesDir, "claudecode-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "claudecode-rule.md",
      });

      expect(rule.getFrontmatter().claudecode).toEqual({
        paths: ["src/**/*.ts"],
      });
      expect(rule.getBody()).toBe("Claude Code-specific rule body");
    });

    it("should handle antigravity configuration in frontmatter", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);

      const ruleContent = `---
root: false
targets:
  - antigravity-ide
description: Antigravity rule
antigravity:
  trigger: "glob"
  globs:
    - "*.md"
---

Antigravity-specific rule body`;

      const filePath = join(rulesDir, "antigravity-rule.md");
      await writeFileContent(filePath, ruleContent);

      const rule = await RulesyncRule.fromFile({
        relativeFilePath: "antigravity-rule.md",
      });

      expect(rule.getFrontmatter().antigravity).toEqual({
        trigger: "glob",
        globs: ["*.md"],
      });
      expect(rule.getBody()).toBe("Antigravity-specific rule body");
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

  describe("agentsmd.subprojectPath resolution", () => {
    const buildRule = ({
      frontmatter,
      deriveSubprojectPathFromGlobs,
      relativeFilePath = "scoped.md",
    }: {
      frontmatter: RulesyncRuleFrontmatterInput;
      deriveSubprojectPathFromGlobs?: boolean;
      relativeFilePath?: string;
    }): RulesyncRule =>
      new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath,
        frontmatter,
        body: "# Scoped rule",
        deriveSubprojectPathFromGlobs,
      });

    it("leaves the frontmatter alone when nothing asks for a derivation", () => {
      const rule = buildRule({
        frontmatter: { root: false, globs: ["packages/api/**/*"] },
      });

      expect(rule.getFrontmatter().agentsmd).toBeUndefined();
    });

    it("derives the path from globs when the config option is on", () => {
      const rule = buildRule({
        frontmatter: { root: false, globs: ["packages/api/**/*.ts"] },
        deriveSubprojectPathFromGlobs: true,
      });

      expect(rule.getFrontmatter().agentsmd).toEqual({ subprojectPath: "packages/api" });
      // The file itself keeps what the author wrote.
      expect(rule.getFileContent()).not.toContain("subprojectPath");
    });

    it("derives the path from globs for a rule that says auto, with the option off", () => {
      const rule = buildRule({
        frontmatter: {
          root: false,
          globs: ["path/to/*"],
          agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH, other: "kept" },
        },
      });

      expect(rule.getFrontmatter().agentsmd).toEqual({ subprojectPath: "path/to", other: "kept" });
      expect(rule.getFileContent()).toContain("subprojectPath: auto");
    });

    it("prefers an explicit path over the derived one", () => {
      const rule = buildRule({
        frontmatter: {
          root: false,
          globs: ["packages/api/**/*"],
          agentsmd: { subprojectPath: "apps/api" },
        },
        deriveSubprojectPathFromGlobs: true,
      });

      expect(rule.getFrontmatter().agentsmd?.subprojectPath).toBe("apps/api");
    });

    it("treats an explicit empty path as an opt-out from the config option", async () => {
      const warnings = await collectWarnings(() => {
        const rule = buildRule({
          frontmatter: {
            root: false,
            globs: ["packages/api/**/*"],
            agentsmd: { subprojectPath: "" },
          },
          deriveSubprojectPathFromGlobs: true,
        });

        // Consumers read "" as "no nesting", exactly as they did before
        // derivation existed, so it passes through unchanged.
        expect(rule.getFrontmatter().agentsmd).toEqual({ subprojectPath: "" });
        expect(rule.getFileContent()).toContain("subprojectPath: ''");
      });
      expect(warnings).toEqual([]);
    });

    it("never derives for a root rule", async () => {
      const derived = buildRule({
        frontmatter: { root: true, globs: ["packages/api/**/*"] },
        deriveSubprojectPathFromGlobs: true,
      });
      expect(derived.getFrontmatter().agentsmd).toBeUndefined();

      const warnings = await collectWarnings(() => {
        const requested = buildRule({
          frontmatter: {
            root: true,
            globs: ["packages/api/**/*"],
            agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH },
          },
          relativeFilePath: "overview.md",
        });
        // The request never leaks to a consumer as if it were a directory, and
        // an `agentsmd` block that held nothing else goes with it.
        expect(requested.getFrontmatter().agentsmd).toBeUndefined();
      });
      expect(warnings).toEqual([expect.stringContaining("root rule")]);
    });

    it.each([
      { name: "no globs", globs: undefined },
      { name: "empty globs", globs: [] },
      { name: "globs without a static prefix", globs: ["**/*.ts"] },
      { name: "globs naming different directories", globs: ["packages/api/**", "packages/web/**"] },
      { name: "a negated glob", globs: ["!packages/api/**"] },
      { name: "a glob escaping the root", globs: ["../packages/api/**"] },
    ])("warns once and falls back to no nesting for $name", async ({ globs }) => {
      const build = (): RulesyncRule =>
        buildRule({
          frontmatter: { root: false, globs, agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH } },
        });

      const warnings = await collectWarnings(() => {
        expect(build().getFrontmatter().agentsmd).toBeUndefined();
        // A generate reads the same file once per target; the warning describes
        // the file, so it is printed once.
        build();
      });

      expect(warnings).toEqual([
        expect.stringContaining(
          `Could not derive agentsmd.subprojectPath for ${join(RULESYNC_RULES_RELATIVE_DIR_PATH, "scoped.md")}`,
        ),
      ]);
    });

    it("keeps the other agentsmd keys when an unresolvable auto is dropped", async () => {
      const warnings = await collectWarnings(() => {
        const rule = buildRule({
          frontmatter: {
            root: false,
            globs: ["**/*.ts"],
            agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH, other: "kept" },
          },
        });
        expect(rule.getFrontmatter().agentsmd).toEqual({ other: "kept" });
      });
      expect(warnings).toEqual([expect.stringContaining("Could not derive")]);
    });

    it("stays quiet when the config option is on and a rule has nothing to derive from", async () => {
      // With the option on every non-root rule is a candidate, and most rules
      // have no directory-scoped globs at all; those must not each warn.
      const warnings = await collectWarnings(() => {
        const rule = buildRule({
          frontmatter: { root: false, description: "General guidance" },
          deriveSubprojectPathFromGlobs: true,
        });
        expect(rule.getFrontmatter().agentsmd).toBeUndefined();
      });
      expect(warnings).toEqual([]);
    });

    it.each([
      { name: "globs without a static prefix", globs: ["src/**/*.ts", "test/**/*.ts"] },
      { name: "globs that disagree", globs: ["packages/api/**", "**/*.md"] },
      { name: "a negated glob", globs: ["!packages/api/**"] },
    ])(
      "falls back silently when the config option is on and a rule has $name",
      async ({ globs }) => {
        // Cursor- and Cline-style activation globs are the norm, not a mistake
        // to be reported on every generate; only an explicit "auto" is a
        // request that deserves a warning when it cannot be honored.
        const warnings = await collectWarnings(() => {
          const rule = buildRule({
            frontmatter: { root: false, globs },
            deriveSubprojectPathFromGlobs: true,
          });
          expect(rule.getFrontmatter().agentsmd).toBeUndefined();
        });
        expect(warnings).toEqual([]);
      },
    );

    it("still warns for an explicit auto when the config option is on", async () => {
      const warnings = await collectWarnings(() => {
        buildRule({
          frontmatter: {
            root: false,
            globs: ["src/**/*.ts", "test/**/*.ts"],
            agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH },
          },
          deriveSubprojectPathFromGlobs: true,
        });
      });
      expect(warnings).toEqual([expect.stringContaining("Could not derive")]);
    });

    it("applies the option to rules loaded with fromFile", async () => {
      const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
      await ensureDir(rulesDir);
      await writeFileContent(
        join(rulesDir, "api.md"),
        `---
root: false
targets: ["*"]
globs: ["packages/api/**/*"]
---

# API`,
      );

      const derived = await RulesyncRule.fromFile({
        relativeFilePath: "api.md",
        deriveSubprojectPathFromGlobs: true,
      });
      expect(derived.getFrontmatter().agentsmd).toEqual({ subprojectPath: "packages/api" });

      const plain = await RulesyncRule.fromFile({ relativeFilePath: "api.md" });
      expect(plain.getFrontmatter().agentsmd).toBeUndefined();
    });
  });

  describe("getAuthoredFrontmatter", () => {
    const buildRule = (frontmatter: RulesyncRuleFrontmatterInput): RulesyncRule =>
      new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "scoped.md",
        frontmatter,
        body: "# Scoped rule",
        deriveSubprojectPathFromGlobs: true,
      });

    it("keeps auto verbatim where getFrontmatter carries the resolved directory", () => {
      const rule = buildRule({
        root: false,
        globs: ["packages/api/**/*"],
        agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH },
      });

      expect(rule.getAuthoredFrontmatter().agentsmd).toEqual({
        subprojectPath: AUTO_SUBPROJECT_PATH,
      });
      expect(rule.getFrontmatter().agentsmd).toEqual({ subprojectPath: "packages/api" });
    });

    it("keeps an unresolvable auto that getFrontmatter drops", async () => {
      await collectWarnings(() => {
        const rule = buildRule({
          root: false,
          globs: ["**/*.ts"],
          agentsmd: { subprojectPath: AUTO_SUBPROJECT_PATH },
        });

        expect(rule.getAuthoredFrontmatter().agentsmd).toEqual({
          subprojectPath: AUTO_SUBPROJECT_PATH,
        });
        expect(rule.getFrontmatter().agentsmd).toBeUndefined();
      });
    });

    it("leaves a config-derived directory out, as the file does", () => {
      const rule = buildRule({ root: false, globs: ["packages/api/**/*"] });

      expect(rule.getAuthoredFrontmatter().agentsmd).toBeUndefined();
      expect(rule.getFileContent()).not.toContain("subprojectPath");
    });

    it("carries the schema defaults the file content is written with", () => {
      const rule = buildRule({ root: false });

      expect(rule.getAuthoredFrontmatter().targets).toEqual(["*"]);
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

    it("should preserve unknown keys in tool-specific sub-schemas via z.looseObject", () => {
      const frontmatter = {
        cursor: {
          alwaysApply: true,
          futureField: "preserved",
        },
        copilot: {
          excludeAgent: "code-review" as const,
          newOption: 42,
        },
        claudecode: {
          paths: ["src/**/*.ts"],
          experimentalFlag: true,
        },
        antigravity: {
          trigger: "glob",
          globs: ["*.md"],
          extraSetting: "kept",
        },
        agentsmd: {
          subprojectPath: "packages/app",
          unknownProp: ["a", "b"],
        },
      };

      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
      expect(result.success).toBe(true);
      expect(result.data?.cursor).toEqual({
        alwaysApply: true,
        futureField: "preserved",
      });
      expect(result.data?.copilot).toEqual({
        excludeAgent: "code-review",
        newOption: 42,
      });
      expect(result.data?.claudecode).toEqual({
        paths: ["src/**/*.ts"],
        experimentalFlag: true,
      });
      expect(result.data?.antigravity).toEqual({
        trigger: "glob",
        globs: ["*.md"],
        extraSetting: "kept",
      });
      expect(result.data?.agentsmd).toEqual({
        subprojectPath: "packages/app",
        unknownProp: ["a", "b"],
      });
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
        outputRoot: testDir,
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
