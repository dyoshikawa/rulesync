import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesProcessor, type RulesProcessorToolTarget } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WarpRule } from "./warp-rule.js";

const logger = createMockLogger();

describe("RulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should filter out rules not targeted for the specific tool", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "copilot" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const processor = new RulesProcessor({ logger, toolTarget: "warp" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "mixed-rule.md",
          frontmatter: {
            targets: ["cursor", "claudecode", "copilot"],
          },
          body: "Mixed targets rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const processor = new RulesProcessor({ logger, toolTarget: "augmentcode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const processor = new RulesProcessor({ logger, toolTarget: "warp" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
        new RulesProcessor({ logger, toolTarget: "unsupported-tool" as any });
      }).toThrow();
    });

    it("should correctly validate and filter rules for each supported tool", async () => {
      const testCases = [
        { toolTarget: "copilot" as const, ruleClass: CopilotRule },
        { toolTarget: "cursor" as const, ruleClass: CursorRule },
        { toolTarget: "claudecode" as const, ruleClass: ClaudecodeRule },
        { toolTarget: "warp" as const, ruleClass: WarpRule },
        {
          toolTarget: "augmentcode-legacy" as const,
          ruleClass: AugmentcodeLegacyRule,
        },
      ];

      for (const { toolTarget, ruleClass } of testCases) {
        const processor = new RulesProcessor({ logger, toolTarget: toolTarget });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "targeted-rule.md",
            frontmatter: {
              targets: [toolTarget],
            },
            body: `${toolTarget} specific rule`,
          }),
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
    it("should generate references section with description and globs for claudecode-legacy", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "feature-rule.md",
          frontmatter: {
            root: false,
            targets: ["claudecode-legacy"],
            description: "Feature specific rule",
            globs: ["src/**/*.ts", "tests/**/*.test.ts"],
          },
          body: "# Feature rule content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      expect(rootRule).toBeDefined();

      // Check that the root rule contains the references section
      const content = rootRule?.getFileContent();
      expect(content).toContain("Please also reference the following rules as needed:");
      expect(content).toContain(
        '@.claude/memories/feature-rule.md description: "Feature specific rule" applyTo: "src/**/*.ts,tests/**/*.test.ts"',
      );
      expect(content).toContain(
        '@.claude/memories/minimal-rule.md description: "undefined" applyTo: "undefined"',
      );
      expect(content).toContain("# Root rule content");
    });

    it("should handle rules with undefined description and globs", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "no-metadata.md",
          frontmatter: {
            root: false,
            targets: ["*"],
          },
          body: "# No metadata",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/no-metadata.md description: "undefined" applyTo: "undefined"',
      );
    });

    it("should escape double quotes in description", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/quoted.md description: "Rule with \\"quotes\\" in description" applyTo: "**/*.ts"',
      );
    });

    it("should not generate references section when only root rule exists for claudecode-legacy", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toBe("# Root only content");
      expect(content).not.toContain("Please also reference the following documents");
    });

    it("should not generate references section for claudecode (modular rules)", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Root rule",
            globs: ["**/*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "feature.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: "Feature rule",
            globs: ["src/**/*.ts"],
          },
          body: "# Feature content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // Modular rules should NOT include references section (files are auto-loaded)
      expect(content).toBe("# Root content");
      expect(content).not.toContain("Please also reference");
      expect(content).not.toContain("@.claude/");
    });

    it("should handle multiple globs correctly for claudecode-legacy", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
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
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/multi-glob.md description: "Multiple glob patterns" applyTo: "src/**/*.ts,tests/**/*.test.ts,**/*.config.js"',
      );
    });
  });

  describe("loadToolFiles", () => {
    it("should load nested non-root tool rules for cursor and claudecode", async () => {
      await ensureDir(join(testDir, ".cursor", "rules", "frontend"));
      await writeFileContent(
        join(testDir, ".cursor", "rules", "frontend", "react-rule.mdc"),
        "# Frontend Rule",
      );
      await ensureDir(join(testDir, ".claude", "rules", "backend"));
      await writeFileContent(
        join(testDir, ".claude", "rules", "backend", "api-rule.md"),
        "# Backend Rule",
      );

      const cursorProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "cursor",
      });
      const claudecodeProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const cursorFiles = await cursorProcessor.loadToolFiles();
      const claudecodeFiles = await claudecodeProcessor.loadToolFiles();

      const cursorPaths = cursorFiles.map((file) => file.getRelativeFilePath());
      const claudecodePaths = claudecodeFiles.map((file) => file.getRelativeFilePath());

      expect(cursorPaths).toContain(join("frontend", "react-rule.mdc"));
      expect(claudecodePaths).toContain(join("backend", "api-rule.md"));
    });

    it("should load CLAUDE.md from .claude/ directory when only .claude/CLAUDE.md exists", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Project from .claude dir");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const files = await processor.loadToolFiles();
      const rootFiles = files.filter((f) => f.getRelativeFilePath() === "CLAUDE.md");

      expect(rootFiles.length).toBe(1);
      expect(rootFiles[0]?.getRelativeDirPath()).toBe(".claude");
      expect(rootFiles[0]?.getFilePath()).toBe(join(testDir, ".claude", "CLAUDE.md"));
    });

    it("should prefer ./CLAUDE.md over .claude/CLAUDE.md when both exist", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root CLAUDE.md");
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# .claude/CLAUDE.md");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const files = await processor.loadToolFiles();
      const rootFiles = files.filter((f) => f.getRelativeFilePath() === "CLAUDE.md");

      expect(rootFiles.length).toBe(1);
      expect(rootFiles[0]?.getRelativeDirPath()).toBe(".");
    });

    it("should load CLAUDE.md from .claude/ directory for claudecode-legacy", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Legacy from .claude dir");

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const files = await processor.loadToolFiles();
      const rootFiles = files.filter((f) => f.getRelativeFilePath() === "CLAUDE.md");

      expect(rootFiles.length).toBe(1);
      expect(rootFiles[0]?.getRelativeDirPath()).toBe(".claude");
    });

    it("should return empty when neither ./CLAUDE.md nor .claude/CLAUDE.md exist", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const files = await processor.loadToolFiles();
      const rootFiles = files.filter((f) => f.getRelativeFilePath() === "CLAUDE.md");

      expect(rootFiles.length).toBe(0);
    });

    it("should load Rovodev modular rules but skip reserved memory names with warning", async () => {
      const modularDir = join(testDir, ".rovodev", ".rulesync", "modular-rules");
      await ensureDir(modularDir);
      await writeFileContent(join(modularDir, "ok.md"), "# OK");
      await writeFileContent(join(modularDir, "AGENTS.md"), "# misplaced");
      await writeFileContent(join(modularDir, "AGENTS.local.md"), "# misplaced local");

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "rovodev" });
      const files = await processor.loadToolFiles();
      const nonRoot = files.filter(
        (f): f is RovodevRule => f instanceof RovodevRule && !f.isRoot(),
      );

      expect(nonRoot.map((f) => f.getRelativeFilePath())).toEqual(["ok.md"]);
      expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      warnSpy.mockRestore();
    });
  });

  describe("loadToolFiles with forDeletion: true", () => {
    it("should return nested non-root files for deletion", async () => {
      await ensureDir(join(testDir, ".cursor", "rules", "frontend"));
      await writeFileContent(
        join(testDir, ".cursor", "rules", "frontend", "react-rule.mdc"),
        "# Frontend Rule",
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "cursor" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });
      const filePaths = filesToDelete.map((file) => file.getRelativeFilePath());

      expect(filePaths).toContain(join("frontend", "react-rule.mdc"));
    });

    it("should return files with correct paths for deletion for claudecode-legacy", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        "# Root\n\n@.claude/memories/memory1.md\n@.claude/memories/memory2.md",
      );
      await ensureDir(join(testDir, ".claude", "memories"));
      await writeFileContent(join(testDir, ".claude", "memories", "memory1.md"), "# Memory 1");
      await writeFileContent(join(testDir, ".claude", "memories", "memory2.md"), "# Memory 2");

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      expect(filesToDelete.length).toBeGreaterThan(0);
      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("memory1.md");
      expect(filePaths).toContain("memory2.md");
    });

    it("should work for all supported tool targets", async () => {
      const targets: RulesProcessorToolTarget[] = [
        "agentsmd",
        "augmentcode",
        "augmentcode-legacy",
        "claudecode",
        "claudecode-legacy",
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
        const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: target });

        const filesToDelete = await processor.loadToolFiles({
          forDeletion: true,
        });

        // Should return empty array since no files exist
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should handle errors gracefully", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      // Should return empty array when no files exist
      expect(filesToDelete).toEqual([]);
    });

    it("should succeed even when file has broken frontmatter", async () => {
      // File with broken YAML frontmatter (unclosed bracket, invalid syntax)
      const brokenFrontmatter = `---
root: [true
globs: This frontmatter is invalid YAML
  - unclosed bracket
  invalid: : syntax
---
Content that would fail parsing`;

      await writeFileContent(join(testDir, "CLAUDE.md"), brokenFrontmatter);

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      // forDeletion should succeed without parsing file content
      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      expect(filesToDelete.length).toBeGreaterThan(0);
      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
    });

    it("should include CLAUDE.local.md for deletion for claudecode", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Local");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("CLAUDE.local.md");
    });

    it("should include CLAUDE.local.md for deletion for claudecode-legacy", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Local");

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("CLAUDE.local.md");
    });

    it("should include AGENTS.local.md for deletion for rovodev", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Local");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "rovodev" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("AGENTS.local.md");
    });

    it("should include project-root AGENTS.md for deletion when .rovodev/AGENTS.md exists (mirror)", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "AGENTS.md"), "# Primary");
      await writeFileContent(join(testDir, "AGENTS.md"), "# Mirror");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "rovodev" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const rootAgents = filesToDelete.filter((f) => f.getRelativeFilePath() === "AGENTS.md");
      expect(rootAgents.length).toBeGreaterThanOrEqual(1);
      expect(rootAgents.some((f) => f.getRelativeDirPath() === ".")).toBe(true);
    });

    it("should include .claude/CLAUDE.local.md for deletion when only in .claude/ directory", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Root from .claude");
      await writeFileContent(join(testDir, ".claude", "CLAUDE.local.md"), "# Local from .claude");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("CLAUDE.local.md");

      const localFile = filesToDelete.find((f) => f.getRelativeFilePath() === "CLAUDE.local.md");
      expect(localFile?.getRelativeDirPath()).toBe(".claude");
    });

    it("should prefer primary root CLAUDE.md over alternative when both exist", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Primary Root");
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Alternative Root");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
      expect(toolFiles[0]?.getRelativeDirPath()).toBe(".");
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return global-capable rule targets in map order", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });

      expect(globalTargets).toEqual([
        "claudecode",
        "claudecode-legacy",
        "codexcli",
        "copilot",
        "factorydroid",
        "geminicli",
        "goose",
        "kilo",
        "opencode",
        "rovodev",
      ]);
    });

    it("should return a subset of regular tool targets", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });
      const regularTargets = RulesProcessor.getToolTargets();

      // All global targets should be in regular targets
      for (const target of globalTargets) {
        expect(regularTargets).toContain(target);
      }

      // Global targets should be fewer than regular targets
      expect(globalTargets.length).toBeLessThan(regularTargets.length);
    });

    it("should only include targets that support global mode", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });

      // These are the targets that support global mode
      expect(globalTargets).toContain("claudecode");
      expect(globalTargets).toContain("claudecode-legacy");
      expect(globalTargets).toContain("codexcli");
      expect(globalTargets).toContain("copilot");
      expect(globalTargets).toContain("factorydroid");
      expect(globalTargets).toContain("geminicli");
      expect(globalTargets).toContain("kilo");
      expect(globalTargets).toContain("goose");
      expect(globalTargets).toContain("opencode");
      expect(globalTargets).toContain("rovodev");
      expect(globalTargets.length).toBe(10);

      // These targets should NOT be in global mode
      expect(globalTargets).not.toContain("cursor");
      expect(globalTargets).not.toContain("warp");
    });
  });

  describe("RulesProcessor with global flag", () => {
    describe("constructor", () => {
      it("should accept global parameter", () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });

      it("should default global to false when not specified", () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });
    });

    describe("loadRulesyncFiles in global mode", () => {
      it("should accept global parameter in constructor", () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });
    });

    describe("convertRulesyncFilesToToolFiles in global mode", () => {
      it("should convert using global paths when global=true for claudecode", async () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Global Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ClaudecodeRule);
        expect(result[0]?.getRelativeDirPath()).toBe(".claude");
        expect(result[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
      });

      it("should convert using global paths when global=true for codexcli", async () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "codexcli",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Global Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        const codexcliRule = result[0];
        expect(codexcliRule?.getRelativeDirPath()).toBe(".codex");
        expect(codexcliRule?.getRelativeFilePath()).toBe("AGENTS.md");
      });

      it("should use regular paths when global=false", async () => {
        const processor = new RulesProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
          global: false,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Regular Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ClaudecodeRule);
        // Modular rules use project root directory for root file
        expect(result[0]?.getRelativeDirPath()).toBe(".");
        expect(result[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
      });
    });
  });

  describe("localRoot validation", () => {
    it("should throw error when multiple localRoot rules exist", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["*"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local1.md"),
        `---
localRoot: true
targets: ["*"]
---
# Local 1`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local2.md"),
        `---
localRoot: true
targets: ["*"]
---
# Local 2`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow("Multiple localRoot rules found");
    });

    it("should throw error when localRoot exists without root rule", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local.md"),
        `---
localRoot: true
targets: ["*"]
---
# Local without root`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "localRoot: true requires a root: true rule to exist",
      );
    });

    it("should warn and ignore localRoot in global mode", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["*"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local.md"),
        `---
localRoot: true
targets: ["*"]
---
# Local`,
      );

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();

      // Should only return root rule, ignoring localRoot
      expect(result).toHaveLength(1);
      const rulesyncRule = result[0] as RulesyncRule;
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });

    it("should load rulesync files from cwd even when baseDir is different (global mode)", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["*"]
---
# Root rule`,
      );

      // Use a different baseDir to simulate global mode (baseDir = homeDir)
      const differentBaseDir = join(testDir, "fake-home");
      await ensureDir(differentBaseDir);

      const processor = new RulesProcessor({
        logger,
        baseDir: differentBaseDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(1);
      const rulesyncRule = result[0] as RulesyncRule;
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });
  });

  describe("localRoot content generation", () => {
    it("should generate CLAUDE.local.md for claudecode", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["*"],
          },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should generate both root and local rules
      expect(result).toHaveLength(2);

      const rootRule = result.find(
        (r) => r instanceof ClaudecodeRule && r.getRelativeFilePath() === "CLAUDE.md",
      );
      const localRule = result.find(
        (r) => r instanceof ClaudecodeRule && r.getRelativeFilePath() === "CLAUDE.local.md",
      );

      expect(rootRule).toBeDefined();
      expect(localRule).toBeDefined();
      expect(localRule?.getRelativeDirPath()).toBe(".");
      expect(localRule?.getFileContent()).toBe("# Local content");
    });

    it("should generate CLAUDE.local.md for claudecode-legacy", async () => {
      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["*"],
          },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should generate both root and local rules
      expect(result).toHaveLength(2);

      const rootRule = result.find(
        (r) => r instanceof ClaudecodeLegacyRule && r.getRelativeFilePath() === "CLAUDE.md",
      );
      const localRule = result.find(
        (r) => r instanceof ClaudecodeLegacyRule && r.getRelativeFilePath() === "CLAUDE.local.md",
      );

      expect(rootRule).toBeDefined();
      expect(localRule).toBeDefined();
      expect(localRule?.getRelativeDirPath()).toBe(".");
      expect(localRule?.getFileContent()).toBe("# Local content");
    });

    it("should write .rovodev/AGENTS.md and mirror ./AGENTS.md for rovodev project mode", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "rovodev" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["rovodev"],
          },
          body: "# Rovodev root",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      const primary = result.find(
        (r) =>
          r instanceof RovodevRule &&
          r.getRelativeDirPath() === ".rovodev" &&
          r.getRelativeFilePath() === "AGENTS.md",
      );
      const mirror = result.find(
        (r) =>
          r instanceof RovodevRule &&
          r.getRelativeDirPath() === "." &&
          r.getRelativeFilePath() === "AGENTS.md",
      );

      expect(primary).toBeDefined();
      expect(mirror).toBeDefined();
      expect(mirror?.getFileContent()).toBe(primary?.getFileContent());
      expect(mirror?.getFileContent()).toContain("# Rovodev root");
    });

    it("should generate AGENTS.local.md for rovodev localRoot rule", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "rovodev" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["rovodev"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["rovodev"],
          },
          body: "# Local memory",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      const localRule = result.find(
        (r) => r instanceof RovodevRule && r.getRelativeFilePath() === "AGENTS.local.md",
      );
      expect(localRule).toBeDefined();
      expect(localRule?.getFileContent()).toBe("# Local memory");
      expect(localRule?.getRelativeDirPath()).toBe(".");
    });

    it("should append localRoot content to root file for other tools", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "copilot" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["*"],
          },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should only generate root rule with appended content
      expect(result).toHaveLength(1);

      const rootRule = result.find((r) => r instanceof CopilotRule && r.isRoot());
      expect(rootRule).toBeDefined();
      expect(rootRule?.getFileContent()).toContain("# Root content");
      expect(rootRule?.getFileContent()).toContain("\n\n# Local content");
    });

    it("should not generate localRoot rule in global mode", async () => {
      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["*"],
          },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should only generate root rule (localRoot is filtered in loadRulesyncFiles, but here we test convertRulesyncFilesToToolFiles directly)
      // In global mode, localRoot rules should not generate CLAUDE.local.md
      expect(result).toHaveLength(1);
      expect(result[0]?.getFileContent()).toBe("# Root content");
    });

    it("should filter out localRoot when target does not match", async () => {
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: {
            localRoot: true,
            targets: ["cursor"], // Only for cursor, not claudecode
          },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should only generate root rule, localRoot is not targeted
      expect(result).toHaveLength(1);
      expect(result[0]?.getFileContent()).toBe("# Root content");
    });
  });

  describe("last-wins behavior for overlapping targets", () => {
    it("should overwrite AGENTS.md when agentsmd and opencode both target the same file", async () => {
      // Setup: Create rulesync rules directory
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["agentsmd", "opencode"]
---
# Shared Content`,
      );

      // Process agentsmd first
      const agentsMdProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "agentsmd",
      });
      const agentsMdRulesyncFiles = await agentsMdProcessor.loadRulesyncFiles();
      const agentsMdToolFiles =
        await agentsMdProcessor.convertRulesyncFilesToToolFiles(agentsMdRulesyncFiles);
      await agentsMdProcessor.writeAiFiles(agentsMdToolFiles);

      // Verify agentsmd wrote the file
      const agentsMdContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(agentsMdContent).toContain("# Shared Content");
      expect(agentsMdToolFiles[0]).toBeInstanceOf(AgentsMdRule);

      // Process opencode second (should overwrite)
      const openCodeProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "opencode",
      });
      const openCodeRulesyncFiles = await openCodeProcessor.loadRulesyncFiles();
      const openCodeToolFiles =
        await openCodeProcessor.convertRulesyncFilesToToolFiles(openCodeRulesyncFiles);
      await openCodeProcessor.writeAiFiles(openCodeToolFiles);

      // Verify opencode overwrote the file
      const finalContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(finalContent).toContain("# Shared Content");
      expect(openCodeToolFiles[0]).toBeInstanceOf(OpenCodeRule);

      // Both targets should have written to the same file path
      expect(agentsMdToolFiles[0]?.getFilePath()).toBe(openCodeToolFiles[0]?.getFilePath());
    });

    it("should apply last-wins in reverse order when targets are reversed", async () => {
      // Setup: Create rulesync rules directory
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["opencode", "agentsmd"]
---
# Reversed Order Content`,
      );

      // Process opencode first
      const openCodeProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "opencode",
      });
      const openCodeRulesyncFiles = await openCodeProcessor.loadRulesyncFiles();
      const openCodeToolFiles =
        await openCodeProcessor.convertRulesyncFilesToToolFiles(openCodeRulesyncFiles);
      await openCodeProcessor.writeAiFiles(openCodeToolFiles);

      // Process agentsmd second (should overwrite)
      const agentsMdProcessor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "agentsmd",
      });
      const agentsMdRulesyncFiles = await agentsMdProcessor.loadRulesyncFiles();
      const agentsMdToolFiles =
        await agentsMdProcessor.convertRulesyncFilesToToolFiles(agentsMdRulesyncFiles);
      await agentsMdProcessor.writeAiFiles(agentsMdToolFiles);

      // Verify agentsmd's content is the final result
      const finalContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(finalContent).toContain("# Reversed Order Content");
      expect(agentsMdToolFiles[0]).toBeInstanceOf(AgentsMdRule);
    });
  });

  describe("loadRulesyncFiles warning for missing root rule", () => {
    it("should load nested rulesync rule files", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "frontend"));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "frontend", "feature.md"),
        `---
root: false
targets: ["*"]
---
# Feature rule`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const paths = rulesyncFiles.map((file) => file.getRelativeFilePath());

      expect(paths).toContain(join("frontend", "feature.md"));
    });

    it("should warn when rulesync rules exist but no root rule is set", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "feature.md"),
        `---
root: false
targets: ["*"]
---
# Feature rule`,
      );

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await processor.loadRulesyncFiles();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No root rulesync rule file found"),
      );
    });

    it("should not warn when a root rule exists", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"),
        `---
root: true
targets: ["*"]
---
# Root rule`,
      );

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await processor.loadRulesyncFiles();

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("No root rulesync rule file found"),
      );
    });

    it("should not warn when no rulesync rules exist", async () => {
      // Ensure the directory exists but is empty
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await processor.loadRulesyncFiles();

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("No root rulesync rule file found"),
      );
    });
  });

  describe("loadRulesyncFiles with per-target root rules", () => {
    it("should allow two root rules with different targets", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "claude-root.md"),
        `---
root: true
targets: ["claudecode"]
---
# Claude Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "opencode-root.md"),
        `---
root: true
targets: ["opencode"]
---
# OpenCode Root`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const result = await processor.loadRulesyncFiles();
      const rootRules = result.filter((r) => r instanceof RulesyncRule && r.getFrontmatter().root);
      expect(rootRules).toHaveLength(1);
      expect((rootRules[0] as RulesyncRule).getFrontmatter().targets).toEqual(["claudecode"]);
    });

    it("should throw when two root rules target the same tool", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root1.md"),
        `---
root: true
targets: ["claudecode"]
---
# Root 1`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root2.md"),
        `---
root: true
targets: ["claudecode"]
---
# Root 2`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "Multiple root rulesync rules found for target 'claudecode'",
      );
    });

    it("should throw when wildcard and specific target both match", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "wildcard-root.md"),
        `---
root: true
targets: ["*"]
---
# Wildcard Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "claude-root.md"),
        `---
root: true
targets: ["claudecode"]
---
# Claude Root`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "Multiple root rulesync rules found for target 'claudecode'",
      );
    });

    it("should allow wildcard root when queried for non-overlapping target", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "wildcard-root.md"),
        `---
root: true
targets: ["*"]
---
# Wildcard Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "opencode-root.md"),
        `---
root: true
targets: ["opencode"]
---
# OpenCode Root`,
      );

      // From claudecode's perspective, only the wildcard root matches
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const result = await processor.loadRulesyncFiles();
      const rootRules = result.filter((r) => r instanceof RulesyncRule && r.getFrontmatter().root);
      expect(rootRules).toHaveLength(1);
      expect((rootRules[0] as RulesyncRule).getFrontmatter().targets).toEqual(["*"]);
    });

    it("should return only matching root in global mode with different targets", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "claude-root.md"),
        `---
root: true
targets: ["claudecode"]
---
# Claude Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "opencode-root.md"),
        `---
root: true
targets: ["opencode"]
---
# OpenCode Root`,
      );

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(1);
      expect((result[0] as RulesyncRule).getFrontmatter().targets).toEqual(["claudecode"]);
    });

    it("should warn with target name when no root matches specific target", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "opencode-root.md"),
        `---
root: true
targets: ["opencode"]
---
# OpenCode Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "non-root.md"),
        `---
targets: ["claudecode"]
---
# Non-root`,
      );

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await processor.loadRulesyncFiles();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No root rulesync rule file found for target 'claudecode'"),
      );
    });

    it("should throw localRoot conflict only for matching target", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["claudecode"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local1.md"),
        `---
localRoot: true
targets: ["claudecode"]
---
# Local 1`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local2.md"),
        `---
localRoot: true
targets: ["opencode"]
---
# Local 2`,
      );

      // claudecode sees only one localRoot targeting it — no error
      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      const result = await processor.loadRulesyncFiles();
      expect(result).toBeDefined();
    });

    it("should return root and non-root rules in global mode for copilot (supports global nonRoot)", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["copilot"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "non-root.md"),
        `---
targets: ["copilot"]
---
# Non-root`,
      );

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "copilot",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(2);
      const rootRule = result.find((r) => (r as RulesyncRule).getFrontmatter().root);
      const nonRootRule = result.find((r) => !(r as RulesyncRule).getFrontmatter().root);
      expect(rootRule).toBeDefined();
      expect(nonRootRule).toBeDefined();
    });

    it("should exclude non-root rules in global mode for claudecode (no global nonRoot support)", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["claudecode"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "non-root.md"),
        `---
targets: ["claudecode"]
---
# Non-root`,
      );

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(1);
      expect((result[0] as RulesyncRule).getFrontmatter().root).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-root rulesync rules found, but it's in global mode"),
      );
    });

    it("should filter non-root rules by target in global mode", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["copilot"]
---
# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "copilot-nonroot.md"),
        `---
targets: ["copilot"]
---
# Copilot Non-root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "claude-nonroot.md"),
        `---
targets: ["claudecode"]
---
# Claude Non-root`,
      );

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "copilot",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      // Should include root + copilot non-root, but NOT claude non-root
      expect(result).toHaveLength(2);
      expect(
        result.every((r) => {
          const targets = (r as RulesyncRule).getFrontmatter().targets;
          return !targets || targets.includes("copilot") || targets.includes("*");
        }),
      ).toBe(true);
    });

    it("should generate copilot global non-root files via round-trip", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["copilot"]
---
# Root Rule`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
        `---
targets: ["copilot"]
---
# Detail Rule`,
      );

      const processor = new RulesProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "copilot",
        global: true,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toHaveLength(2);

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles.length).toBeGreaterThanOrEqual(1);

      // Verify root file targets global copilot path
      const rootToolFile = toolFiles.find(
        (f) => f.getRelativeFilePath() === "copilot-instructions.md",
      );
      expect(rootToolFile).toBeDefined();
      expect(rootToolFile?.getRelativeDirPath()).toBe(".copilot");

      // Verify non-root file targets global copilot instructions directory
      const nonRootToolFile = toolFiles.find(
        (f) => f.getRelativeDirPath() === ".copilot/instructions",
      );
      expect(nonRootToolFile).toBeDefined();
    });

    it("should throw localRoot-requires-root scoped to target", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      // Root exists but only for opencode
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "opencode-root.md"),
        `---
root: true
targets: ["opencode"]
---
# OpenCode Root`,
      );
      // localRoot targets claudecode, but no claudecode root exists
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "local.md"),
        `---
localRoot: true
targets: ["claudecode"]
---
# Local without matching root`,
      );

      const processor = new RulesProcessor({ logger, baseDir: testDir, toolTarget: "claudecode" });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "localRoot: true requires a root: true rule to exist for target 'claudecode'",
      );
    });
  });
});
