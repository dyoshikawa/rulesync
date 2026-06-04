import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  WindsurfRule,
  WindsurfRuleFrontmatter,
  WindsurfRuleFrontmatterSchema,
} from "./windsurf-rule.js";

describe("WindsurfRule", () => {
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
    it("should create instance with frontmatter and body", () => {
      const windsurfRule = new WindsurfRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: join(".windsurf", "rules"),
        relativeFilePath: "test-rule.md",
        body: "# Test Rule\n\nThis is a test rule.",
      });

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.getRelativeDirPath()).toBe(join(".windsurf", "rules"));
      expect(windsurfRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(windsurfRule.getFileContent().trim()).toBe(`---
trigger: always_on
---
# Test Rule

This is a test rule.`);
    });

    it("should emit a plain body without frontmatter for root (global) rules", () => {
      const windsurfRule = new WindsurfRule({
        frontmatter: {},
        relativeDirPath: join(".codeium", "windsurf", "memories"),
        relativeFilePath: "global_rules.md",
        body: "# Global\n\nPlain body.",
        root: true,
      });

      expect(windsurfRule.getFileContent().trim()).toBe("# Global\n\nPlain body.");
      expect(windsurfRule.getFileContent()).not.toContain("trigger:");
    });

    it("should throw for invalid frontmatter types", () => {
      expect(
        () =>
          new WindsurfRule({
            // Invalid: globs should be a string, pass a number to force schema failure.
            frontmatter: { trigger: "glob", globs: 123 } as any,
            relativeDirPath: join(".windsurf", "rules"),
            relativeFilePath: "test-rule.md",
            body: "# Test",
          }),
      ).toThrow();
    });

    it("should skip validation when requested", () => {
      expect(
        () =>
          new WindsurfRule({
            frontmatter: { trigger: "glob", globs: 123 } as any,
            relativeDirPath: join(".windsurf", "rules"),
            relativeFilePath: "test-rule.md",
            body: "# Test",
            validate: false,
          }),
      ).not.toThrow();
    });
  });

  describe("getSettablePaths", () => {
    it("should return nonRoot path under .windsurf/rules for project scope", () => {
      const paths = WindsurfRule.getSettablePaths();

      expect("root" in paths).toBe(false);
      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe(join(".windsurf", "rules"));
    });

    it("should return global root path under .codeium/windsurf/memories/global_rules.md", () => {
      const paths = WindsurfRule.getSettablePaths({ global: true });

      expect("nonRoot" in paths).toBe(false);
      const root = (paths as { root: { relativeDirPath: string; relativeFilePath: string } }).root;
      expect(root.relativeDirPath).toBe(join(".codeium", "windsurf", "memories"));
      expect(root.relativeFilePath).toBe("global_rules.md");
    });

    it("should exclude the tool dir for project scope when requested", () => {
      const paths = WindsurfRule.getSettablePaths({ excludeToolDir: true });

      const nonRoot = (paths as { nonRoot: { relativeDirPath: string } }).nonRoot;
      expect(nonRoot.relativeDirPath).toBe("rules");
    });
  });

  describe("fromFile", () => {
    it("should parse a project rule file with frontmatter", async () => {
      const rulesDir = join(testDir, ".windsurf", "rules");
      await ensureDir(rulesDir);
      const content = "---\ntrigger: glob\nglobs: '*.ts'\n---\n\n# Glob Rule";
      await writeFileContent(join(rulesDir, "glob.md"), content);

      const windsurfRule = await WindsurfRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "glob.md",
      });

      expect(windsurfRule.getRelativeDirPath()).toBe(join(".windsurf", "rules"));
      expect(windsurfRule.getRelativeFilePath()).toBe("glob.md");
      expect(windsurfRule.getFrontmatter()).toEqual({ trigger: "glob", globs: "*.ts" });
      expect(windsurfRule.getBody().trim()).toBe("# Glob Rule");
    });

    it("should parse all four supported triggers from files", async () => {
      const rulesDir = join(testDir, ".windsurf", "rules");
      await ensureDir(rulesDir);

      const testCases = [
        {
          file: "glob.md",
          content: "---\ntrigger: glob\nglobs: '*.ts'\n---\n# Glob",
          expected: { trigger: "glob", globs: "*.ts" },
        },
        {
          file: "manual.md",
          content: "---\ntrigger: manual\n---\n# Manual",
          expected: { trigger: "manual" },
        },
        {
          file: "always-on.md",
          content: "---\ntrigger: always_on\n---\n# Always On",
          expected: { trigger: "always_on" },
        },
        {
          file: "model-decision.md",
          content: "---\ntrigger: model_decision\ndescription: test desc\n---\n# Model Decision",
          expected: { trigger: "model_decision", description: "test desc" },
        },
      ];

      for (const testCase of testCases) {
        await writeFileContent(join(rulesDir, testCase.file), testCase.content);
        const rule = await WindsurfRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: testCase.file,
        });
        expect(rule.getFrontmatter()).toMatchObject(testCase.expected);
      }
    });

    it("should parse the global plain-markdown file as a root rule", async () => {
      const memoriesDir = join(testDir, ".codeium", "windsurf", "memories");
      await ensureDir(memoriesDir);
      const content = "# Global Rules\n\nNo frontmatter here.";
      await writeFileContent(join(memoriesDir, "global_rules.md"), content);

      const windsurfRule = await WindsurfRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "global_rules.md",
        global: true,
      });

      expect(windsurfRule.isRoot()).toBe(true);
      expect(windsurfRule.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "memories"));
      expect(windsurfRule.getRelativeFilePath()).toBe("global_rules.md");
      expect(windsurfRule.getBody().trim()).toBe(content);
      expect(windsurfRule.getFileContent()).not.toContain("trigger:");
    });

    it("should throw when the file does not exist", async () => {
      await expect(
        WindsurfRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule - trigger inference", () => {
    it("should infer glob trigger for specific globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "glob-rule.md",
        frontmatter: {
          globs: ["src/**/*.ts"],
        },
        body: "# Glob Rule",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: "src/**/*.ts",
      });
      expect(windsurfRule.getRelativeDirPath()).toBe(join(".windsurf", "rules"));
    });

    it("should infer always_on trigger for the **/* wildcard glob", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "always-on.md",
        frontmatter: {
          globs: ["**/*"],
        },
        body: "# Always On Rule",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({ trigger: "always_on" });
    });

    it("should infer always_on trigger when no globs are present", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "no-globs.md",
        frontmatter: {},
        body: "# No Globs",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({ trigger: "always_on" });
    });

    it("should kebab-case the filename", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "CodingGuidelines.md",
        frontmatter: {},
        body: "# Coding Guidelines",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getRelativeFilePath()).toBe("coding-guidelines.md");
    });

    it("should use a custom outputRoot for project scope", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom.md",
        frontmatter: { globs: [] },
        body: "# Custom",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(windsurfRule.getFilePath()).toBe(
        join("/custom/base", ".windsurf", "rules", "custom.md"),
      );
    });
  });

  describe("fromRulesyncRule - persisted trigger precedence", () => {
    it("should respect a persisted manual trigger regardless of globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "persisted.md",
        frontmatter: {
          globs: ["**/*"], // Would normally infer always_on.
          windsurf: {
            trigger: "manual",
          },
        },
        body: "# Persisted",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({ trigger: "manual" });
    });

    it("should respect explicit globs in the windsurf block", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "explicit-globs.md",
        frontmatter: {
          globs: ["**/*"], // Generic glob.
          windsurf: {
            trigger: "glob",
            globs: ["specific.ts"], // Specific glob overrides generic.
          },
        },
        body: "# Explicit Globs",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({
        trigger: "glob",
        globs: "specific.ts",
      });
    });

    it("should set model_decision trigger with description from generic frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "model-decision.md",
        frontmatter: {
          description: "Apply when reasoning about X",
          windsurf: {
            trigger: "model_decision",
          },
        },
        body: "# Model Decision",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect(windsurfRule.getFrontmatter()).toEqual({
        trigger: "model_decision",
        description: "Apply when reasoning about X",
      });
    });

    it("should pass through unknown custom triggers (loose schema)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "unknown-trigger.md",
        frontmatter: {
          windsurf: {
            trigger: "custom-trigger",
          },
        },
        body: "# Unknown Trigger",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule });

      expect((windsurfRule.getFrontmatter() as any).trigger).toBe("custom-trigger");
    });
  });

  describe("fromRulesyncRule - global scope", () => {
    it("should produce a plain root global_rules.md without frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Global Overview\n\nPlain body.",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule, global: true });

      expect(windsurfRule.getRelativeDirPath()).toBe(join(".codeium", "windsurf", "memories"));
      expect(windsurfRule.getRelativeFilePath()).toBe("global_rules.md");
      expect(windsurfRule.isRoot()).toBe(true);
      expect(windsurfRule.getFileContent().trim()).toBe("# Global Overview\n\nPlain body.");
      expect(windsurfRule.getFileContent()).not.toContain("trigger:");
    });

    it("should emit the body without frontmatter even when globs are present", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "non-root.md",
        frontmatter: {
          globs: ["src/**/*.ts"],
        },
        body: "# Global Body",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule, global: true });

      expect(windsurfRule.getFileContent().trim()).toBe("# Global Body");
      expect(windsurfRule.getFileContent()).not.toContain("trigger:");
      expect(windsurfRule.getFileContent()).not.toContain("globs:");
    });
  });

  describe("toRulesyncRule - round-trip of all four triggers", () => {
    it("should write a windsurf block for each trigger", () => {
      const testCases: {
        frontmatter: WindsurfRuleFrontmatter;
        expectedGlobs: string[];
        expectedTrigger: string;
      }[] = [
        {
          frontmatter: { trigger: "glob", globs: "*.ts" },
          expectedGlobs: ["*.ts"],
          expectedTrigger: "glob",
        },
        {
          frontmatter: { trigger: "manual" },
          expectedGlobs: [],
          expectedTrigger: "manual",
        },
        {
          frontmatter: { trigger: "always_on" },
          expectedGlobs: ["**/*"],
          expectedTrigger: "always_on",
        },
        {
          frontmatter: { trigger: "model_decision", description: "desc" },
          expectedGlobs: [],
          expectedTrigger: "model_decision",
        },
      ];

      for (const { frontmatter, expectedGlobs, expectedTrigger } of testCases) {
        const windsurfRule = new WindsurfRule({
          frontmatter,
          relativeDirPath: join(".windsurf", "rules"),
          relativeFilePath: "test.md",
          body: "# Test Rule",
        });

        const rulesyncRule = windsurfRule.toRulesyncRule();
        expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
        expect(rulesyncRule.getFrontmatter().globs).toEqual(expectedGlobs);
        expect(rulesyncRule.getFrontmatter().windsurf?.trigger).toBe(expectedTrigger);
        expect(rulesyncRule.getFrontmatter().root).toBe(false);
      }
    });

    it("should round-trip glob globs into the windsurf block as an array", () => {
      const windsurfRule = new WindsurfRule({
        frontmatter: { trigger: "glob", globs: "*.ts" },
        relativeDirPath: join(".windsurf", "rules"),
        relativeFilePath: "test.md",
        body: "# Test",
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();
      expect(rulesyncRule.getFrontmatter().windsurf?.globs).toEqual(["*.ts"]);
    });

    it("should round-trip a global root rule as a default root RulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          globs: ["**/*"],
        },
        body: "# Global Root",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule, global: true });
      const result = windsurfRule.toRulesyncRule();

      expect(result).toBeInstanceOf(RulesyncRule);
      expect(result.getFrontmatter().root).toBe(true);
      // Default conversion for a root rule does not carry the windsurf key.
      expect(result.getFrontmatter().windsurf).toBeUndefined();
      expect(result.getBody().trim()).toBe("# Global Root");
    });
  });

  describe("round trip (RulesyncRule -> WindsurfRule -> RulesyncRule)", () => {
    it("should preserve content and glob trigger through a full round-trip", () => {
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

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule: initialRulesyncRule });
      const finalRulesyncRule = windsurfRule.toRulesyncRule();

      expect(finalRulesyncRule.getRelativeFilePath()).toBe("round-trip.md");
      expect(finalRulesyncRule.getBody().trim()).toBe("# Round Trip\n\nContent");
      expect(finalRulesyncRule.getFrontmatter().globs).toEqual(["*.ts"]);
      expect(finalRulesyncRule.getFrontmatter().windsurf?.trigger).toBe("glob");
      expect(finalRulesyncRule.getFrontmatter().windsurf?.globs).toEqual(["*.ts"]);
    });

    it("should preserve a persisted manual trigger through a full round-trip", () => {
      const initialRulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "manual.md",
        frontmatter: {
          windsurf: { trigger: "manual" },
        },
        body: "# Manual",
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule({ rulesyncRule: initialRulesyncRule });
      const finalRulesyncRule = windsurfRule.toRulesyncRule();

      expect(finalRulesyncRule.getFrontmatter().windsurf?.trigger).toBe("manual");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const windsurfRule = new WindsurfRule({
        frontmatter: { trigger: "always_on" },
        relativeDirPath: join(".windsurf", "rules"),
        relativeFilePath: "test.md",
        body: "# Test",
      });

      const result = windsurfRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter types", () => {
      const windsurfRule = new WindsurfRule({
        frontmatter: { trigger: "glob", globs: 123 } as any,
        relativeDirPath: join(".windsurf", "rules"),
        relativeFilePath: "test.md",
        body: "# Test",
        validate: false,
      });

      const result = windsurfRule.validate();

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable project instance", () => {
      const windsurfRule = WindsurfRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".windsurf", "rules"),
        relativeFilePath: "old.md",
      });

      expect(windsurfRule).toBeInstanceOf(WindsurfRule);
      expect(windsurfRule.isRoot()).toBe(false);
    });

    it("should mark the instance as root for global deletion", () => {
      const windsurfRule = WindsurfRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".codeium", "windsurf", "memories"),
        relativeFilePath: "global_rules.md",
        global: true,
      });

      expect(windsurfRule.isRoot()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    const buildRule = (targets: string[]): RulesyncRule =>
      new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          root: false,
          targets: targets as any,
          globs: [],
        },
        body: "# Test",
        validate: false,
      });

    it("should return true for the wildcard target", () => {
      expect(WindsurfRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
    });

    it("should return true for the windsurf target", () => {
      expect(WindsurfRule.isTargetedByRulesyncRule(buildRule(["windsurf"]))).toBe(true);
    });

    it("should return false for other specific targets", () => {
      expect(WindsurfRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });
  });

  describe("schema", () => {
    it("should parse valid frontmatter for all four triggers", () => {
      const testCases = [
        { trigger: "glob", globs: "*.ts" },
        { trigger: "manual" },
        { trigger: "always_on" },
        { trigger: "model_decision", description: "desc" },
      ];

      for (const input of testCases) {
        const result = WindsurfRuleFrontmatterSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(input);
        }
      }
    });

    it("should allow arbitrary triggers and unknown fields (loose schema)", () => {
      const result = WindsurfRuleFrontmatterSchema.safeParse({
        trigger: "custom-trigger",
        extraField: "value",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trigger).toBe("custom-trigger");
        expect((result.data as any).extraField).toBe("value");
      }
    });
  });
});
