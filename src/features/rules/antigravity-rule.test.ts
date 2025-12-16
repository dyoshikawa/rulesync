import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  AntigravityRule,
  AntigravityRuleFrontmatter,
  AntigravityRuleFrontmatterSchema,
} from "./antigravity-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AntigravityRule", () => {
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
    it("should create instance with default parameters", () => {
      const antigravityRule = new AntigravityRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(antigravityRule).toBeInstanceOf(AntigravityRule);
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(antigravityRule.getFileContent().trim()).toBe(`---
trigger: always_on
---
# Test Rule

This is a test rule.`);
    });

    it("should create instance with custom baseDir", () => {
      const antigravityRule = new AntigravityRule({
        frontmatter: { trigger: "always_on" },
        baseDir: "/custom/path",
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        body: "# Custom Rule",
      });

      expect(antigravityRule.getFilePath()).toBe("/custom/path/.agent/rules/test-rule.md");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new AntigravityRule({
          frontmatter: { trigger: "always_on" },
          relativeDirPath: ".agent/rules",
          relativeFilePath: "test-rule.md",
          body: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new AntigravityRule({
          frontmatter: { trigger: "always_on" },
          relativeDirPath: ".agent/rules",
          relativeFilePath: "test-rule.md",
          body: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const antigravityRule = new AntigravityRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test-rule.md",
        body: "# Root Rule",
        root: false,
      });

      expect(antigravityRule.getFileContent().trim()).toBe(`---
trigger: always_on
---
# Root Rule`);
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing file", async () => {
      // Setup test file
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent =
        "---\ntrigger: always_on\n---\n\n# Test Rule from File\n\nContent from file.";
      await writeFileContent(join(rulesDir, "test.md"), testContent);

      const antigravityRule = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test.md",
      });

      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test.md");
      expect(antigravityRule.getFileContent().trim()).toBe(testContent);
      expect(antigravityRule.getFilePath()).toBe(join(testDir, ".agent/rules/test.md"));
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file using testDir
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent = "---\ntrigger: always_on\n---\n\n# Default BaseDir Test";
      const testFilePath = join(rulesDir, "default-test.md");
      await writeFileContent(testFilePath, testContent);

      // process.cwd() is already mocked in beforeEach
      const antigravityRule = await AntigravityRule.fromFile({
        relativeFilePath: "default-test.md",
      });

      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("default-test.md");
      expect(antigravityRule.getFileContent().trim()).toBe(testContent);
      expect(antigravityRule.getFilePath()).toBe(join(testDir, ".agent/rules/default-test.md"));
    });

    it("should handle validation parameter", async () => {
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const testContent = "---\ntrigger: always_on\n---\n\n# Validation Test";
      await writeFileContent(join(rulesDir, "validation-test.md"), testContent);

      const antigravityRuleWithValidation = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: true,
      });

      const antigravityRuleWithoutValidation = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "validation-test.md",
        validate: false,
      });

      expect(antigravityRuleWithValidation.getFileContent().trim()).toBe(testContent);
      expect(antigravityRuleWithoutValidation.getFileContent().trim()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        AntigravityRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule).toBeInstanceOf(AntigravityRule);
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(antigravityRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(antigravityRule.getFilePath()).toBe("/custom/base/.agent/rules/custom-base.md");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const withValidation = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const withoutValidation = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(withValidation.getFileContent()).toContain("# Validation Test");
      expect(withoutValidation.getFileContent()).toContain("# Validation Test");
    });

    it("should place root rules in .agent/rules directory", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Project overview",
          globs: ["**/*"],
        },
        body: "# Project Overview\n\nThis is the root rule.",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Root rules are also placed in .agent/rules directory
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
      expect(antigravityRule.getRelativeFilePath()).toBe("overview.md");
      expect(antigravityRule.isRoot()).toBe(false);
      expect(antigravityRule.getFileContent()).toContain("# Project Overview");
    });

    it("should maintain original filename for root rules", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "my-custom-root.md",
        frontmatter: {
          root: true,
          targets: ["antigravity"],
          description: "",
          globs: ["**/*"],
        },
        body: "# Custom Root Rule",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        baseDir: "/project",
        rulesyncRule,
      });

      expect(antigravityRule.getFilePath()).toBe("/project/.agent/rules/my-custom-root.md");
      expect(antigravityRule.getRelativeFilePath()).toBe("my-custom-root.md");
    });

    it("should convert PascalCase filenames to kebab-case", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "CodingGuidelines.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Coding Guidelines",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getRelativeFilePath()).toBe("coding-guidelines.md");
      expect(antigravityRule.getRelativeDirPath()).toBe(".agent/rules");
    });

    it("should convert snake_case filenames to kebab-case", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "api_reference.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# API Reference",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getRelativeFilePath()).toBe("api-reference.md");
    });

    it("should convert mixed case filenames with numbers to kebab-case", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "API_Guide_v2.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# API Guide v2",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      // es-toolkit's kebabCase adds hyphens before numbers
      expect(antigravityRule.getRelativeFilePath()).toBe("api-guide-v-2.md");
    });

    it("should preserve already kebab-case filenames", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-guidelines.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Coding Guidelines",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getRelativeFilePath()).toBe("coding-guidelines.md");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule for all triggers", () => {
      const testCases: {
        frontmatter: AntigravityRuleFrontmatter;
        expectedGlobs: string[];
        expectedAntigravityTrigger: string;
      }[] = [
        {
          frontmatter: { trigger: "glob", globs: "*.ts" },
          expectedGlobs: ["*.ts"],
          expectedAntigravityTrigger: "glob",
        },
        {
          frontmatter: { trigger: "manual" },
          expectedGlobs: [],
          expectedAntigravityTrigger: "manual",
        },
        {
          frontmatter: { trigger: "always_on" },
          expectedGlobs: ["**/*"],
          expectedAntigravityTrigger: "always_on",
        },
        {
          frontmatter: { trigger: "model_decision", description: "desc" },
          expectedGlobs: [],
          expectedAntigravityTrigger: "model_decision",
        },
      ];

      for (const { frontmatter, expectedGlobs, expectedAntigravityTrigger } of testCases) {
        const antigravityRule = new AntigravityRule({
          frontmatter,
          relativeDirPath: ".agent/rules",
          relativeFilePath: "test.md",
          body: "# Test Rule",
        });

        const rulesyncRule = antigravityRule.toRulesyncRule();
        expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
        expect(rulesyncRule.getFrontmatter().globs).toEqual(expectedGlobs);
        expect(rulesyncRule.getFrontmatter().antigravity?.trigger).toBe(expectedAntigravityTrigger);
      }
    });

    it("should always convert to root: false", () => {
      // Test with a rule that was created from a root RulesyncRule
      const rootRulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Project overview",
          globs: ["**/*"],
        },
        body: "# Project Overview",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule: rootRulesyncRule,
      });

      const convertedRulesyncRule = antigravityRule.toRulesyncRule();

      // All Antigravity rules are converted to root: false
      expect(convertedRulesyncRule.getFrontmatter().root).toBe(false);
      expect(convertedRulesyncRule.getBody()).toBe("# Project Overview");
      expect(convertedRulesyncRule.getRelativeFilePath()).toBe("overview.md");
    });

    it("should preserve non-root status when converting", () => {
      const nonRootRulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Coding style guide",
          globs: ["**/*.ts"],
        },
        body: "# Coding Style",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule: nonRootRulesyncRule,
      });

      const convertedRulesyncRule = antigravityRule.toRulesyncRule();

      expect(convertedRulesyncRule.getFrontmatter().root).toBe(false);
      expect(convertedRulesyncRule.getBody()).toBe("# Coding Style");
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const antigravityRule = new AntigravityRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test.md",
        body: "# Test",
      });

      const result = antigravityRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter types", () => {
      const antigravityRule = new AntigravityRule({
        // Invalid: globs should be string, pass number to force schema failure
        frontmatter: { trigger: "glob", globs: 123 } as any,
        relativeDirPath: ".agent/rules",
        relativeFilePath: "test.md",
        body: "# Test",
        validate: false,
      });

      const result = antigravityRule.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain("expected string, received number");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for wildcard target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for antigravity target", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["antigravity"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for other specific targets", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: ["cursor"],
          description: "",
          globs: [],
        },
        body: "# Test",
      });

      expect(AntigravityRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct nonRoot path", () => {
      const paths = AntigravityRule.getSettablePaths();

      expect(paths.nonRoot.relativeDirPath).toBe(".agent/rules");
    });
  });
  describe("frontmatter", () => {
    it("should parse frontmatter from file", async () => {
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const content = `---
trigger: glob
globs: '*.ts'
---

# Frontmatter Rule`;
      await writeFileContent(join(rulesDir, "frontmatter.md"), content);

      const antigravityRule = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "frontmatter.md",
      });

      const frontmatter = antigravityRule.getFrontmatter();
      expect(frontmatter).toEqual({
        trigger: "glob",
        globs: "*.ts",
      });
      expect(antigravityRule.getFileContent().trim()).toBe(content.trim());
    });

    it("should handle all supported triggers", async () => {
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);

      const testCases = [
        {
          file: "glob.md",
          content: "---\ntrigger: glob\nglobs: '*.ts'\n---\n# Glob",
          expectedFrontmatter: { trigger: "glob", globs: "*.ts" },
        },
        {
          file: "manual.md",
          content: "---\ntrigger: manual\n---\n# Manual",
          expectedFrontmatter: { trigger: "manual" },
        },
        {
          file: "always-on.md",
          content: "---\ntrigger: always_on\n---\n# Always On",
          expectedFrontmatter: { trigger: "always_on" }, // globs are optional
        },
        {
          file: "model-decision.md",
          content: "---\ntrigger: model_decision\ndescription: test desc\n---\n# Model Decision",
          expectedFrontmatter: { trigger: "model_decision", description: "test desc" },
        },
      ];

      for (const testCase of testCases) {
        await writeFileContent(join(rulesDir, testCase.file), testCase.content);
        const rule = await AntigravityRule.fromFile({
          baseDir: testDir,
          relativeFilePath: testCase.file,
        });
        expect(rule.getFrontmatter()).toMatchObject(testCase.expectedFrontmatter);
      }
    });

    it("should use default trigger for file without frontmatter", async () => {
      const rulesDir = join(testDir, ".agent/rules");
      await ensureDir(rulesDir);
      const content = "# No Frontmatter";
      await writeFileContent(join(rulesDir, "no-frontmatter.md"), content);

      const antigravityRule = await AntigravityRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "no-frontmatter.md",
        validate: false, // Skip validation as it might fail without frontmatter
      });

      // Default behavior might depend on implementation, but checking if it handles it
      expect(antigravityRule.getFileContent().trim()).toBe("# No Frontmatter");
    });
  });

  describe("mapping", () => {
    it("should map RulesyncRule with specific globs to glob trigger", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "glob-rule.md",
        frontmatter: {
          globs: ["src/**/*.ts"],
        },
        body: "# Glob Rule",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: "src/**/*.ts",
      });
    });

    it("should map RulesyncRule with wildcard glob to always_on trigger", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "always-on.md",
        frontmatter: {
          globs: ["**/*"],
        },
        body: "# Always On Rule",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "always_on",
      });
    });

    it("should map RulesyncRule without globs to always_on trigger", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-globs.md",
        frontmatter: {},
        body: "# No Globs",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "always_on",
      });
    });

    it("should map RulesyncRule with persisted trigger regardless of globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "persisted.md",
        frontmatter: {
          globs: ["**/*"], // Would normally infer always_on
          antigravity: {
            trigger: "manual", // Explicitly set to manual
          },
        },
        body: "# Persisted",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "manual",
      });
    });

    it("should respect explicit globs in antigravity key", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "explicit-globs.md",
        frontmatter: {
          globs: ["**/*"], // Generic glob
          antigravity: {
            trigger: "glob",
            globs: ["specific.ts"], // Specific glob overrides generic
          },
        },
        body: "# Explicit Globs",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: "specific.ts",
      });
    });

    it("should handle unknown string trigger gracefully (cast to any)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "unknown-trigger.md",
        frontmatter: {
          antigravity: {
            trigger: "unknown-trigger",
          },
        },
        body: "# Unknown Trigger",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
        validate: true, // Validation should pass with loose schema
      });

      expect((antigravityRule.getFrontmatter() as any).trigger).toBe("unknown-trigger");
    });
  });

  describe("round trip", () => {
    it("should maintain content through RulesyncRule -> AntigravityRule -> RulesyncRule conversion", () => {
      const initialRulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "round-trip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Round trip test",
          globs: ["*.ts"],
        },
        body: "# Round Trip\n\nContent",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule: initialRulesyncRule,
      });

      const finalRulesyncRule = antigravityRule.toRulesyncRule();

      // Verify essential properties are preserved or correctly mapped
      expect(finalRulesyncRule.getRelativeFilePath()).toBe("round-trip.md");
      expect(finalRulesyncRule.getBody().trim()).toBe("# Round Trip\n\nContent");
      expect(finalRulesyncRule.getFrontmatter().globs).toEqual(["*.ts"]);
      expect(finalRulesyncRule.getFrontmatter().targets).toEqual(["*"]);
      expect(finalRulesyncRule.getFrontmatter().antigravity?.trigger).toBe("glob");
      expect(finalRulesyncRule.getFrontmatter().antigravity?.globs).toEqual(["*.ts"]);
    });

    it("should pass through extra properties in antigravity config", () => {
      const extraProps = {
        customField: "customValue",
        nested: { foo: "bar" },
      };

      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "passthrough.md",
        frontmatter: {
          antigravity: {
            trigger: "manual",
            ...extraProps,
          } as any, // Cast because RulesyncRule schema is loose but TypeScript might strict check generic Record if not defined
        },
        body: "# Passthrough",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Verify AntigravityRule preserved them
      expect(antigravityRule.getFrontmatter()).toMatchObject(extraProps);

      // Verify round trip
      const finalRulesyncRule = antigravityRule.toRulesyncRule();
      expect(finalRulesyncRule.getFrontmatter().antigravity).toMatchObject(extraProps);
    });

    it("should handle empty globs array explicitly", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "empty-globs.md",
        frontmatter: {
          antigravity: {
            trigger: "glob",
            globs: [],
          },
        },
        body: "# Empty Globs",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: undefined,
      });
    });

    it("should handle model_decision without description", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-desc.md",
        frontmatter: {
          antigravity: {
            trigger: "model_decision",
          },
          // No generic description either
        },
        body: "# No Desc",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "model_decision",
        description: undefined,
      });
    });

    it("should handle single wildcard glob when explicitly persisted", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "wildcard.md",
        frontmatter: {
          globs: ["*"],
          antigravity: {
            trigger: "glob",
            // Implicitly uses generic globs if not overridden
          },
        },
        body: "# Wildcard",
      });

      const antigravityRule = AntigravityRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Even though * usually implies always_on, explicit trigger: glob should be respected
      expect(antigravityRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: "*",
      });
    });
  });

  describe("schema", () => {
    it("should parse valid frontmatter", () => {
      const testCases = [
        {
          name: "glob",
          input: { trigger: "glob", globs: "*.ts" },
          expected: { trigger: "glob", globs: "*.ts" },
        },
        {
          name: "manual",
          input: { trigger: "manual" },
          expected: { trigger: "manual" },
        },
        {
          name: "always_on",
          input: { trigger: "always_on" },
          expected: { trigger: "always_on" },
        },
        {
          name: "model_decision",
          input: { trigger: "model_decision", description: "desc" },
          expected: { trigger: "model_decision", description: "desc" },
        },
      ];

      for (const { input, expected } of testCases) {
        const result = AntigravityRuleFrontmatterSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(expected);
        }
      }
    });

    it("should allow arbitrary triggers (loose schema)", () => {
      const result = AntigravityRuleFrontmatterSchema.safeParse({
        trigger: "custom-trigger",
        extraField: "value",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe("custom-trigger");
        expect((result.data as any).extraField).toBe("value");
      }
    });

    it("should allow missing glob for glob trigger (schema is loose)", () => {
      // Logic layer might enforce it, but schema doesn't anymore
      const result = AntigravityRuleFrontmatterSchema.safeParse({
        trigger: "glob",
        // missing globs
      });
      expect(result.success).toBe(true);
    });

    it("should strip invalid fields? No, allow them (loose object)", () => {
      const result = AntigravityRuleFrontmatterSchema.safeParse({
        trigger: "always_on",
        unknownField: "value",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).unknownField).toBe("value");
      }
    });
  });
});
