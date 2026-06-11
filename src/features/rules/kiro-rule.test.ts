import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { deriveKiroInclusion, KiroRule } from "./kiro-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("deriveKiroInclusion", () => {
  it("returns undefined when there are no globs (always-on, plain file)", () => {
    expect(deriveKiroInclusion({ globs: [] })).toBeUndefined();
    expect(deriveKiroInclusion({})).toBeUndefined();
  });

  it("treats wildcard globs as always-on (undefined)", () => {
    expect(deriveKiroInclusion({ globs: ["**/*"] })).toBeUndefined();
    expect(deriveKiroInclusion({ globs: ["*", "**"] })).toBeUndefined();
  });

  it("maps specific globs to fileMatch with a comma-joined pattern", () => {
    expect(deriveKiroInclusion({ globs: ["src/components/**/*.tsx"] })).toEqual({
      inclusion: "fileMatch",
      fileMatchPattern: "src/components/**/*.tsx",
    });
    expect(deriveKiroInclusion({ globs: ["a/**", "b/**", "**/*"] })).toEqual({
      inclusion: "fileMatch",
      fileMatchPattern: "a/**,b/**",
    });
  });

  it("honors an explicit kiro.inclusion block", () => {
    expect(deriveKiroInclusion({ kiro: { inclusion: "manual" }, globs: ["x/**"] })).toEqual({
      inclusion: "manual",
    });
    expect(deriveKiroInclusion({ kiro: { inclusion: "always" } })).toEqual({
      inclusion: "always",
    });
  });

  it("derives fileMatchPattern from globs when kiro.inclusion is fileMatch without a pattern", () => {
    expect(
      deriveKiroInclusion({ kiro: { inclusion: "fileMatch" }, globs: ["lib/**/*.ts"] }),
    ).toEqual({ inclusion: "fileMatch", fileMatchPattern: "lib/**/*.ts" });
    expect(
      deriveKiroInclusion({
        kiro: { inclusion: "fileMatch", fileMatchPattern: "explicit/**" },
        globs: ["ignored/**"],
      }),
    ).toEqual({ inclusion: "fileMatch", fileMatchPattern: "explicit/**" });
  });
});

describe("KiroRule", () => {
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
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Product Guidelines\n\nThis is a product guideline.",
      });

      expect(kiroRule).toBeInstanceOf(KiroRule);
      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("product.md");
      expect(kiroRule.getFileContent()).toBe(
        "# Product Guidelines\n\nThis is a product guideline.",
      );
    });

    it("should create instance with custom outputRoot", () => {
      const kiroRule = new KiroRule({
        outputRoot: "/custom/path",
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "structure.md",
        fileContent: "# Structure Guidelines",
      });

      expect(kiroRule.getFilePath()).toBe("/custom/path/.kiro/steering/structure.md");
    });

    it("should create instance for steering documents", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "tech.md",
        fileContent: "# Technology Guidelines\n\nTech stack guidelines.",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("tech.md");
      expect(kiroRule.getFileContent()).toBe("# Technology Guidelines\n\nTech stack guidelines.");
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new KiroRule({
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "product.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new KiroRule({
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "product.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Product Guidelines",
        root: true,
      });

      expect(kiroRule.getFileContent()).toBe("# Product Guidelines");
      expect(kiroRule.isRoot()).toBe(true);
    });

    it("should default to non-root rule", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Product Guidelines",
      });

      expect(kiroRule.isRoot()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should create instance from steering document file", async () => {
      // Setup test file in .kiro/steering directory
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Product Steering\n\nProduct guidelines from file.";
      await writeFileContent(join(steeringDir, "product.md"), testContent);

      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "product.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("product.md");
      expect(kiroRule.getFileContent()).toBe(testContent);
      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro/steering/product.md"));
      expect(kiroRule.isRoot()).toBe(false);
    });

    it("should create instance from structure document", async () => {
      // Setup test file in .kiro/steering directory
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Structure Guidelines\n\nProject structure guidelines.";
      await writeFileContent(join(steeringDir, "structure.md"), testContent);

      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "structure.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("structure.md");
      expect(kiroRule.getFileContent()).toBe(testContent);
      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro/steering/structure.md"));
      expect(kiroRule.isRoot()).toBe(false);
    });

    it("should create instance from tech document", async () => {
      // Setup test file in .kiro/steering directory
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Tech Stack\n\nTechnology choices and guidelines.";
      await writeFileContent(join(steeringDir, "tech.md"), testContent);

      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "tech.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("tech.md");
      expect(kiroRule.getFileContent()).toBe(testContent);
      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro/steering/tech.md"));
      expect(kiroRule.isRoot()).toBe(false);
    });

    it("should use default outputRoot when not provided", async () => {
      // Setup test file in test directory's .kiro/steering
      // Since process.cwd() is mocked to return testDir, the default outputRoot will use testDir
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Default OutputRoot Test";
      await writeFileContent(join(steeringDir, "product.md"), testContent);

      const kiroRule = await KiroRule.fromFile({
        relativeFilePath: "product.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("product.md");
      expect(kiroRule.getFileContent()).toBe(testContent);
      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro/steering/product.md"));
    });

    it("should handle validation parameter", async () => {
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const testContent = "# Validation Test";
      await writeFileContent(join(steeringDir, "product.md"), testContent);

      const kiroRuleWithValidation = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "product.md",
        validate: true,
      });

      const kiroRuleWithoutValidation = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "product.md",
        validate: false,
      });

      expect(kiroRuleWithValidation.getFileContent()).toBe(testContent);
      expect(kiroRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        KiroRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should handle nested directory structure", async () => {
      // Test nested directory within steering
      const nestedDir = join(testDir, ".kiro/steering/nested");
      await ensureDir(nestedDir);
      const testContent = "# Nested Steering Document";
      await writeFileContent(join(nestedDir, "nested-product.md"), testContent);

      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "nested/nested-product.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("nested/nested-product.md");
      expect(kiroRule.getFileContent()).toBe(testContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["kiro"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const kiroRule = KiroRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiroRule).toBeInstanceOf(KiroRule);
      expect(kiroRule.getRelativeDirPath()).toBe(".");
      expect(kiroRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(kiroRule.getFileContent()).toContain("# Test RulesyncRule\n\nContent from rulesync.");
      expect(kiroRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Test detail rule",
          globs: [],
        },
        body: "# Detail RulesyncRule\n\nContent from detail rulesync.",
      });

      const kiroRule = KiroRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiroRule).toBeInstanceOf(KiroRule);
      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(kiroRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(kiroRule.isRoot()).toBe(false);
    });

    it("emits fileMatch inclusion frontmatter for a non-root rule with specific globs", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "frontend.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Frontend rule",
          globs: ["src/components/**/*.tsx"],
        },
        body: "# Frontend\n\nUse functional components.",
      });

      const kiroRule = KiroRule.fromRulesyncRule({ rulesyncRule });
      const content = kiroRule.getFileContent();

      expect(content).toContain("inclusion: fileMatch");
      expect(content).toContain("fileMatchPattern: src/components/**/*.tsx");
      expect(content).toContain("# Frontend\n\nUse functional components.");
    });

    it("emits no frontmatter for a non-root rule without globs (always-on)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "general.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "General rule",
          globs: [],
        },
        body: "# General\n\nBe consistent.",
      });

      const kiroRule = KiroRule.fromRulesyncRule({ rulesyncRule });

      expect(kiroRule.getFileContent()).toBe("# General\n\nBe consistent.");
    });

    it("round-trips a fileMatch rule through toRulesyncRule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "frontend.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          globs: ["src/**/*.ts"],
        },
        body: "# Frontend body",
      });

      const generated = KiroRule.fromRulesyncRule({ rulesyncRule });
      const roundTrip = generated.toRulesyncRule();

      expect(roundTrip.getFrontmatter().globs).toEqual(["src/**/*.ts"]);
      expect(roundTrip.getFrontmatter().kiro).toEqual({
        inclusion: "fileMatch",
        fileMatchPattern: "src/**/*.ts",
      });
      expect(roundTrip.getBody()).toContain("# Frontend body");
    });

    it("should use custom outputRoot", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const kiroRule = KiroRule.fromRulesyncRule({
        outputRoot: "/custom/base",
        rulesyncRule,
      });

      expect(kiroRule.getFilePath()).toBe("/custom/base/.kiro/steering/custom-base.md");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const kiroRuleWithValidation = KiroRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const kiroRuleWithoutValidation = KiroRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(kiroRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(kiroRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });

    it("should handle kiro target specification", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "target-test.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Kiro specific rule",
          globs: [],
        },
        body: "# Kiro specific rule",
      });

      const kiroRule = KiroRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiroRule.getFileContent()).toContain("# Kiro specific rule");
    });

    it("should handle wildcard target specification", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "target-test.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Universal rule",
          globs: [],
        },
        body: "# Universal rule",
      });

      const kiroRule = KiroRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(kiroRule.getFileContent()).toContain("# Universal rule");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert KiroRule to RulesyncRule for root rule", () => {
      const kiroRule = new KiroRule({
        outputRoot: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert KiroRule to RulesyncRule for steering document", () => {
      const kiroRule = new KiroRule({
        outputRoot: testDir,
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "structure-convert.md",
        fileContent: "# Structure Convert Test\n\nThis structure will be converted.",
        root: false,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("structure-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Structure Convert Test\n\nThis structure will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const kiroRule = new KiroRule({
        outputRoot: "/test/path",
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "metadata-test.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      );
      expect(rulesyncRule.getFileContent()).toContain(
        "# Metadata Test\n\nWith metadata preserved.",
      );
    });

    it("should convert different types of steering documents", () => {
      const documents = [
        { filename: "product.md", content: "# Product Guidelines" },
        { filename: "structure.md", content: "# Structure Guidelines" },
        { filename: "tech.md", content: "# Tech Stack Guidelines" },
      ];

      for (const doc of documents) {
        const kiroRule = new KiroRule({
          outputRoot: testDir,
          relativeDirPath: ".kiro/steering",
          relativeFilePath: doc.filename,
          fileContent: doc.content,
          root: false,
        });

        const rulesyncRule = kiroRule.toRulesyncRule();

        expect(rulesyncRule.getRelativeFilePath()).toBe(doc.filename);
        expect(rulesyncRule.getFileContent()).toContain(doc.content);
      }
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "product.md",
        fileContent: "# Any content is valid",
      });

      const result = kiroRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = kiroRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for any content format", () => {
      const contents = [
        "# Markdown content",
        "Plain text content",
        "---\nfrontmatter: true\n---\nContent with frontmatter",
        "/* Code comments */",
        "Invalid markdown ### ###",
        "Special characters: éñ中文🎉",
        "Multi-line\ncontent\nwith\nbreaks",
      ];

      for (const content of contents) {
        const kiroRule = new KiroRule({
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "product.md",
          fileContent: content,
        });

        const result = kiroRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(steeringDir, "product.md"), originalContent);

      // Load from file
      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "product.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = kiroRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("product.md");
    });

    it("should handle complete workflow from structure file to rulesync rule", async () => {
      // Create structure file
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);
      const originalContent = "# Structure Integration Test\n\nStructure workflow test.";
      await writeFileContent(join(steeringDir, "structure.md"), originalContent);

      // Load from file
      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "structure.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = kiroRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("structure.md");
    });

    it("should handle roundtrip conversion rulesync -> kiro -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule (root)
      const originalRulesync = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["kiro"],
          description: "Roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to kiro rule
      const kiroRule = KiroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = kiroRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe(RULESYNC_OVERVIEW_FILE_NAME);
    });

    it("should handle roundtrip conversion rulesync -> kiro -> rulesync for detail rule", () => {
      const originalBody = "# Detail Roundtrip Test\n\nDetail content should remain the same.";

      // Start with rulesync rule (non-root)
      const originalRulesync = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["kiro"],
          description: "Detail roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to kiro rule
      const kiroRule = KiroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = kiroRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".kiro/steering/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Steering Document\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-product.md"), content);

      const kiroRule = await KiroRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "nested/nested-product.md",
      });

      expect(kiroRule.getRelativeDirPath()).toBe(".kiro/steering");
      expect(kiroRule.getRelativeFilePath()).toBe("nested/nested-product.md");
      expect(kiroRule.getFileContent()).toBe(content);
    });

    it("should work with different steering document types", async () => {
      const steeringDir = join(testDir, ".kiro/steering");
      await ensureDir(steeringDir);

      const documents = [
        { filename: "product.md", content: "# Product Specs\n\nProduct requirements." },
        { filename: "structure.md", content: "# Project Structure\n\nDirectory layout." },
        { filename: "tech.md", content: "# Tech Stack\n\nTechnology decisions." },
      ];

      for (const doc of documents) {
        await writeFileContent(join(steeringDir, doc.filename), doc.content);

        const kiroRule = await KiroRule.fromFile({
          outputRoot: testDir,
          relativeFilePath: doc.filename,
        });

        expect(kiroRule.getFileContent()).toBe(doc.content);
        expect(kiroRule.getRelativeFilePath()).toBe(doc.filename);

        const rulesyncRule = kiroRule.toRulesyncRule();
        expect(rulesyncRule.getFileContent()).toContain(doc.content);
      }
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting kiro", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["kiro"],
        },
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting kiro", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including kiro", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "kiro", "copilot"],
        },
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(KiroRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(kiroRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(kiroRule.getFileContent()).toBe(longContent);
      expect(kiroRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const kiroRule = new KiroRule({
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(kiroRule.validate().success).toBe(true);
        expect(kiroRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(kiroRule.getFileContent()).toBe(unicodeContent);
      expect(kiroRule.validate().success).toBe(true);
    });

    it("should handle empty filename edge cases", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: ".md", // Just extension
        fileContent: "# Just extension",
      });

      expect(kiroRule.getRelativeFilePath()).toBe(".md");
      expect(kiroRule.validate().success).toBe(true);
    });

    it("should handle deeply nested paths", () => {
      const kiroRule = new KiroRule({
        relativeDirPath: ".kiro/steering",
        relativeFilePath: "deep/nested/path/document.md",
        fileContent: "# Deeply Nested Document",
      });

      expect(kiroRule.getRelativeFilePath()).toBe("deep/nested/path/document.md");
      expect(kiroRule.validate().success).toBe(true);
    });

    it("should handle content with null and undefined values when converted to string", () => {
      // Testing edge case where content might contain unusual values
      const specialContents = ["null", "undefined", "0", "false", "", " ", "\t", "\n"];

      for (const content of specialContents) {
        const kiroRule = new KiroRule({
          relativeDirPath: ".kiro/steering",
          relativeFilePath: "special.md",
          fileContent: content,
        });

        expect(kiroRule.getFileContent()).toBe(content);
        expect(kiroRule.validate().success).toBe(true);
      }
    });
  });
});
