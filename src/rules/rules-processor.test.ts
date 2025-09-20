import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { RulesProcessor, type RulesProcessorToolTarget } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WarpRule } from "./warp-rule.js";

describe("RulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should filter out rules not targeted for the specific tool", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "copilot",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "all-tools-rule.md",
          frontmatter: {
            targets: ["*"],
          },
          body: "Rule for all tools",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should include copilot-specific rule and all-tools rule, but not cursor-specific rule
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(CopilotRule);
      expect(result[1]).toBeInstanceOf(CopilotRule);
    });

    it("should return empty array when no rules match the tool target", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "warp",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(0);
    });

    it("should handle mixed targets correctly", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "mixed-rule.md",
          frontmatter: {
            targets: ["cursor", "claudecode", "copilot"],
          },
          body: "Mixed targets rule",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "other-rule.md",
          frontmatter: {
            targets: ["warp", "augmentcode"],
          },
          body: "Other tools rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ClaudecodeRule);
    });

    it("should handle undefined targets in frontmatter", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "augmentcode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "no-targets.md",
          frontmatter: {},
          body: "Rule without targets",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should include the rule since undefined targets means it applies to all
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AugmentcodeLegacyRule);
    });

    it("should handle empty targets array", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "warp",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "empty-targets.md",
          frontmatter: {
            targets: [],
          },
          body: "Rule with empty targets",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should not include the rule since empty targets means it doesn't apply to any tool
      expect(result).toHaveLength(0);
    });

    it("should throw error for unsupported tool target", () => {
      expect(() => {
        new RulesProcessor({
          baseDir: "/test",
          toolTarget: "unsupported-tool" as any,
        });
      }).toThrow();
    });

    it("should correctly validate and filter rules for each supported tool", async () => {
      const testCases = [
        { toolTarget: "copilot" as const, ruleClass: CopilotRule },
        { toolTarget: "cursor" as const, ruleClass: CursorRule },
        { toolTarget: "claudecode" as const, ruleClass: ClaudecodeRule },
        { toolTarget: "warp" as const, ruleClass: WarpRule },
        { toolTarget: "augmentcode-legacy" as const, ruleClass: AugmentcodeLegacyRule },
      ];

      for (const { toolTarget, ruleClass } of testCases) {
        const processor = new RulesProcessor({
          baseDir: "/test",
          toolTarget: toolTarget,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: "/test",
            relativeDirPath: ".rulesync/rules",
            relativeFilePath: "targeted-rule.md",
            frontmatter: {
              targets: [toolTarget],
            },
            body: `${toolTarget} specific rule`,
          }),
          new RulesyncRule({
            baseDir: "/test",
            relativeDirPath: ".rulesync/rules",
            relativeFilePath: "non-targeted-rule.md",
            frontmatter: {
              targets: ["windsurf"],
            },
            body: "Other tool rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ruleClass);
      }
    });
  });

  describe("generateReferencesSection", () => {
    it("should generate references section with description and globs for claudecode", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "root-rule.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Root rule description",
            globs: ["**/*"],
          },
          body: "# Root rule content",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "feature-rule.md",
          frontmatter: {
            root: false,
            targets: ["claudecode"],
            description: "Feature specific rule",
            globs: ["src/**/*.ts", "tests/**/*.test.ts"],
          },
          body: "# Feature rule content",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "minimal-rule.md",
          frontmatter: {
            root: false,
            targets: ["*"],
          },
          body: "# Minimal rule content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Find the root rule
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      expect(rootRule).toBeDefined();

      // Check that the root rule contains the references section
      const content = rootRule?.getFileContent();
      expect(content).toContain("Please also reference the following documents as needed:");
      expect(content).toContain(
        '@.claude/memories/feature-rule.md description: "Feature specific rule" globs: "src/**/*.ts,tests/**/*.test.ts"',
      );
      expect(content).toContain(
        '@.claude/memories/minimal-rule.md description: "undefined" globs: "undefined"',
      );
      expect(content).toContain("# Root rule content");
    });

    it("should handle rules with undefined description and globs", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "no-metadata.md",
          frontmatter: {
            root: false,
            targets: ["*"],
          },
          body: "# No metadata",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/no-metadata.md description: "undefined" globs: "undefined"',
      );
    });

    it("should escape double quotes in description", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "quoted.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: 'Rule with "quotes" in description',
            globs: ["**/*.ts"],
          },
          body: "# Quoted",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/quoted.md description: "Rule with \\"quotes\\" in description" globs: "**/*.ts"',
      );
    });

    it("should not generate references section when only root rule exists", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Only root rule",
            globs: ["**/*"],
          },
          body: "# Root only content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toBe("# Root only content");
      expect(content).not.toContain("Please also reference the following documents");
    });

    it("should handle multiple globs correctly", async () => {
      const processor = new RulesProcessor({
        baseDir: "/test",
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: "/test",
          relativeDirPath: ".rulesync/rules",
          relativeFilePath: "multi-glob.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: "Multiple glob patterns",
            globs: ["src/**/*.ts", "tests/**/*.test.ts", "**/*.config.js"],
          },
          body: "# Multi glob",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/multi-glob.md description: "Multiple glob patterns" globs: "src/**/*.ts,tests/**/*.test.ts,**/*.config.js"',
      );
    });
  });

  describe("loadToolFilesToDelete", () => {
    it("should return the same files as loadToolFiles", async () => {
      await writeFileContent(
        join(testDir, ".claude", "README.md"),
        "# Root\n\n@.claude/memories/memory1.md\n@.claude/memories/memory2.md",
      );
      await ensureDir(join(testDir, ".claude", "memories"));
      await writeFileContent(join(testDir, ".claude", "memories", "memory1.md"), "# Memory 1");
      await writeFileContent(join(testDir, ".claude", "memories", "memory2.md"), "# Memory 2");

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = await processor.loadToolFiles();
      const filesToDelete = await processor.loadToolFilesToDelete();

      expect(filesToDelete).toEqual(toolFiles);
      expect(filesToDelete.length).toBeGreaterThan(0);
    });

    it("should work for all supported tool targets", async () => {
      const targets: RulesProcessorToolTarget[] = [
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "claudecode",
        "cline",
        "copilot",
        "cursor",
        "codexcli",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "warp",
        "windsurf",
      ];

      for (const target of targets) {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        const filesToDelete = await processor.loadToolFilesToDelete();

        // Should return empty array since no files exist
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should handle errors gracefully", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const filesToDelete = await processor.loadToolFilesToDelete();

      // Should return empty array when no files exist
      expect(filesToDelete).toEqual([]);
    });
  });
});
