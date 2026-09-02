import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CopilotcliRule } from "./copilotcli-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { JunieRule } from "./junie-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { PiRule } from "./pi-rule.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesProcessor, type RulesProcessorToolTarget } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WarpRule } from "./warp-rule.js";

const logger = createMockLogger();

const findLocalRule = (rulesyncFiles: { getRelativeFilePath(): string }[], fileName: string) =>
  rulesyncFiles.find((file) => file.getRelativeFilePath() === fileName);

const globalFoldTargets = RulesProcessor.getToolTargets({ global: true }).filter(
  (target) => RulesProcessor.getFactory(target)?.meta.collisionPolicy === "fold",
);

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
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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

    it("should emit a localRoot rule to .qwen/QWEN.local.md for qwencode", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "qwencode" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { targets: ["*"], root: true },
          body: "Shared team instructions",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { targets: ["*"], localRoot: true },
          body: "Personal overrides",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      const localRule = result.find((rule) => rule.getRelativeFilePath() === "QWEN.local.md");
      expect(localRule).toBeDefined();
      expect(localRule?.getRelativeDirPath()).toBe(".qwen");
      expect(localRule?.getFileContent()).toBe("Personal overrides");
    });

    it("should return empty array when no rules match the tool target", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "warp" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "mixed-rule.md",
          frontmatter: {
            targets: ["cursor", "claudecode", "copilot"],
          },
          body: "Mixed targets rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
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
        { toolTarget: "copilotcli" as const, ruleClass: CopilotcliRule },
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
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "targeted-rule.md",
            frontmatter: {
              targets: [toolTarget],
            },
            body: `${toolTarget} specific rule`,
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "non-targeted-rule.md",
            frontmatter: {
              targets: ["devin"],
            },
            body: "Other tool rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ruleClass);
      }
    });

    it("should fold pi rules into AGENTS.md and APPEND_SYSTEM.md groups by output path", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"] },
          body: "# Root body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["pi"] },
          body: "# Detail body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "style.md",
          frontmatter: { targets: ["pi"], pi: { systemPrompt: "append" } },
          body: "# Append one",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "tone.md",
          frontmatter: { targets: ["pi"], pi: { systemPrompt: "append" } },
          body: "# Append two",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Two surviving files: the root AGENTS.md and the append system-prompt file.
      expect(result).toHaveLength(2);

      const rootRule = result.find(
        (rule) => rule instanceof PiRule && rule.getRelativeFilePath() === "AGENTS.md",
      );
      expect(rootRule?.getFileContent()).toBe("# Root body\n\n# Detail body");

      const appendRule = result.find(
        (rule) => rule instanceof PiRule && rule.getRelativeFilePath() === "APPEND_SYSTEM.md",
      );
      // Two opted-in rules concatenate in source order.
      expect(appendRule?.getFileContent()).toBe("# Append one\n\n# Append two");
      expect(appendRule?.getRelativeDirPath()).toBe(".pi");
    });

    it("should fold every pi rule into AGENTS.override.md when the root opts in", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"], pi: { contextFile: "override" } },
          body: "# Root body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["pi"] },
          body: "# Detail body",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(1);
      expect(result[0]?.getRelativeFilePath()).toBe("AGENTS.override.md");
      expect(result[0]?.getFileContent()).toBe("# Root body\n\n# Detail body");
    });

    it("should route every root rule to AGENTS.override.md when any of them opts in", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"], pi: { contextFile: "override" } },
          body: "# Root body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "second-root.md",
          frontmatter: { root: true, targets: ["pi"] },
          body: "# Second root body",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Nothing may be left in AGENTS.md, which Pi stops reading.
      expect(result).toHaveLength(1);
      expect(result[0]?.getRelativeFilePath()).toBe("AGENTS.override.md");
      expect(result[0]?.getFileContent()).toBe("# Root body\n\n# Second root body");
    });

    it("should not align pi.contextFile from a rule targeting another tool", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["claudecode"] },
          body: "# Someone else's root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "pi-root.md",
          frontmatter: { root: true, targets: ["pi"], pi: { contextFile: "override" } },
          body: "# Pi root",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(1);
      expect(result[0]?.getRelativeFilePath()).toBe("AGENTS.override.md");
    });

    it("should ignore pi.contextFile set only on a non-root rule", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"] },
          body: "# Root body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["pi"], pi: { contextFile: "override" } },
          body: "# Detail body",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Everything stays in the single AGENTS.md Pi actually reads.
      expect(result).toHaveLength(1);
      expect(result[0]?.getRelativeFilePath()).toBe("AGENTS.md");
      expect(result[0]?.getFileContent()).toBe("# Root body\n\n# Detail body");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("pi.contextFile"));
    });

    it("should trim singleton pi output groups", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });
      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"] },
          body: "# RootA\n\n\n",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "append.md",
          frontmatter: { targets: ["pi"], pi: { systemPrompt: "append" } },
          body: "# Appended\n\n\n",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find(
        (rule) => rule instanceof PiRule && rule.getRelativeFilePath() === "AGENTS.md",
      );
      const appendRule = result.find(
        (rule) => rule instanceof PiRule && rule.getRelativeFilePath() === "APPEND_SYSTEM.md",
      );

      expect(rootRule?.getFileContent()).toBe("# RootA");
      expect(appendRule?.getFileContent()).toBe("# Appended");
    });

    it("should not list APPEND_SYSTEM.md in the pi references section in explicit discovery mode", async () => {
      const processor = new RulesProcessor({
        logger,
        toolTarget: "pi",
        featureOptions: { ruleDiscoveryMode: "explicit" },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"] },
          body: "# Root body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "style.md",
          frontmatter: { targets: ["pi"], pi: { systemPrompt: "append" } },
          body: "# Append body",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find(
        (rule) => rule instanceof PiRule && rule.getRelativeFilePath() === "AGENTS.md",
      );

      // Pi appends APPEND_SYSTEM.md to the system prompt itself, so referencing
      // it from AGENTS.md would double-load the content.
      const content = rootRule?.getFileContent();
      expect(content).not.toContain("APPEND_SYSTEM.md");
      expect(content).toContain("# Root body");
    });

    it("should keep a root rule on AGENTS.md even when it opts into systemPrompt append", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "pi" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["pi"], pi: { systemPrompt: "append" } },
          body: "# Root body",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // The opt-in is ignored on the root rule: routing it away would leave the
      // context file without a merge/localRoot target.
      expect(result).toHaveLength(1);
      const rootRule = result[0];
      expect(rootRule).toBeInstanceOf(PiRule);
      expect(rootRule?.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rootRule instanceof PiRule && rootRule.isRoot()).toBe(true);
    });
  });

  describe("generateReferencesSection", () => {
    it("should generate references section with description and globs for claudecode-legacy", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
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
          outputRoot: testDir,
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

    it("should generate TOON references section for claudecode when ruleDiscoveryMode is overridden to explicit", async () => {
      const processor = new RulesProcessor({
        logger,
        toolTarget: "claudecode",
        featureOptions: { ruleDiscoveryMode: "explicit" },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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

      expect(content).toContain("Please also reference the following rules as needed.");
      expect(content).toContain("rules[1]:");
      expect(content).toContain("- path: @.claude/rules/feature.md");
      expect(content).toContain("applyTo[1]: src/**/*.ts");
      expect(content).toContain("# Root content");
    });

    it("should throw for invalid rules feature options", async () => {
      const processor = new RulesProcessor({
        logger,
        toolTarget: "claudecode",
        featureOptions: { ruleDiscoveryMode: "invalid" },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
      ];

      await expect(processor.convertRulesyncFilesToToolFiles(rulesyncRules)).rejects.toThrow(
        '`ruleDiscoveryMode` must be either "none" or "explicit"',
      );
    });

    it("should handle multiple globs correctly for claudecode-legacy", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "claudecode-legacy" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
        outputRoot: testDir,
        toolTarget: "cursor",
      });
      const claudecodeProcessor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const cursorFiles = await cursorProcessor.loadToolFiles();
      const claudecodeFiles = await claudecodeProcessor.loadToolFiles();

      const cursorPaths = cursorFiles.map((file) => file.getRelativeFilePath());
      const claudecodePaths = claudecodeFiles.map((file) => file.getRelativeFilePath());

      expect(cursorPaths).toContain(join("frontend", "react-rule.mdc"));
      expect(claudecodePaths).toContain(join("backend", "api-rule.md"));
    });

    it("should discover nested AGENTS.md files on import but never for deletion", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "packages", "api", "AGENTS.md"), "# API");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });

      const imported = await processor.loadToolFiles();
      expect(
        imported.map((file) => join(file.getRelativeDirPath(), file.getRelativeFilePath())),
      ).toContain(join("packages", "api", "AGENTS.md"));

      // A nested file rulesync did not write must never become a deletion
      // candidate — it is the user's own file, anywhere in the tree.
      const forDeletion = await processor.loadToolFiles({ forDeletion: true });
      expect(
        forDeletion.map((file) => join(file.getRelativeDirPath(), file.getRelativeFilePath())),
      ).not.toContain(join("packages", "api", "AGENTS.md"));
    });

    it("should import Junie's .junie/rules and playbook but never delete them", async () => {
      // Junie combines a project-root `AGENTS.md` with `.junie/playbook.md`
      // and `.junie/rules/*.md` — the layout a repo is in before it has a
      // `.junie/AGENTS.md`. Those are import-only read roots: rulesync folds
      // their content into the generated root file and must not treat the
      // hand-authored originals as orphans.
      await writeFileContent(join(testDir, ".junie", "playbook.md"), "# Playbook");
      await writeFileContent(join(testDir, ".junie", "rules", "style.md"), "# Style");
      await writeFileContent(join(testDir, ".junie", "rules", "testing.md"), "# Testing");
      await writeFileContent(join(testDir, ".junie", "rules", "sub", "deep.md"), "# Deep");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });

      const imported = await processor.loadToolFiles();
      const importedPaths = imported.map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );
      expect(importedPaths).toContain(join(".junie", "playbook.md"));
      expect(importedPaths).toContain(join(".junie", "rules", "style.md"));
      expect(importedPaths).toContain(join(".junie", "rules", "testing.md"));
      // Junie documents `.junie/rules/*.md`, not a tree below it.
      expect(importedPaths).not.toContain(join(".junie", "rules", "sub", "deep.md"));

      // Only files rulesync generates are deletion candidates.
      const forDeletion = await processor.loadToolFiles({ forDeletion: true });
      const deletionPaths = forDeletion.map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );
      expect(deletionPaths).not.toContain(join(".junie", "playbook.md"));
      expect(deletionPaths).not.toContain(join(".junie", "rules", "style.md"));
    });

    it("should stop importing Junie's read-only roots once .junie/AGENTS.md exists", async () => {
      // The previous generate folded these into `.junie/AGENTS.md`, which Junie
      // then reads exclusively. Importing them again would hand the same content
      // back as separate rules, and the next generate would fold it in a second
      // time — once more per import/generate cycle.
      await writeFileContent(join(testDir, ".junie", "AGENTS.md"), "# Root\n\n# Style");
      await writeFileContent(join(testDir, ".junie", "playbook.md"), "# Playbook");
      await writeFileContent(join(testDir, ".junie", "rules", "style.md"), "# Style");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });
      const importedPaths = (await processor.loadToolFiles()).map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );

      expect(importedPaths).toEqual([join(".junie", "AGENTS.md")]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("and the tool reads that file exclusively"),
      );
    });

    it("should cap the skipped read-only roots it names and count the rest", async () => {
      // A large `.junie/rules/` directory must not turn one warning into a wall
      // of text, so the list stops at ten names and folds the remainder into a
      // count. Twelve files exercise the branch the docs describe.
      await writeFileContent(join(testDir, ".junie", "AGENTS.md"), "# Root");
      for (let index = 0; index < 12; index++) {
        await writeFileContent(join(testDir, ".junie", "rules", `rule-${index}.md`), `# ${index}`);
      }

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });
      await processor.loadToolFiles();

      const warning = logger.warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("and the tool reads that file exclusively"));
      expect(warning).toBeDefined();
      expect(warning).toContain("and 2 more");
      // Sorted discovery order puts `rule-10.md` and `rule-11.md` right after
      // `rule-1.md`, so the two names that drop off the end are the last ones.
      expect(warning).toContain(join(".junie", "rules", "rule-1.md"));
      expect(warning).not.toContain(join(".junie", "rules", "rule-8.md"));
    });

    it("should keep importing Junie's read-only roots when only the legacy guidelines file exists", async () => {
      // `.junie/guidelines.md` is the *lowest* branch of Junie's resolution
      // order, so with `.junie/rules/*.md` present Junie is reading the
      // multi-file branch, not the legacy file. Rulesync never writes
      // `guidelines.md` either, so nothing was ever folded into it — gating the
      // read-only roots on it would drop exactly the files the tool reads.
      await writeFileContent(join(testDir, ".junie", "guidelines.md"), "# Legacy");
      await writeFileContent(join(testDir, ".junie", "playbook.md"), "# Playbook");
      await writeFileContent(join(testDir, ".junie", "rules", "style.md"), "# Style");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });
      const importedPaths = (await processor.loadToolFiles()).map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );

      expect(importedPaths).toContain(join(".junie", "guidelines.md"));
      expect(importedPaths).toContain(join(".junie", "playbook.md"));
      expect(importedPaths).toContain(join(".junie", "rules", "style.md"));
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("and the tool reads that file exclusively"),
      );
    });

    it("should let the root rule outrank a read-only root that skips the root-absent gate", async () => {
      // Every read-only root declared today is gated on the root file being
      // absent, so the two can never collide in practice. The ordering that
      // makes the root file win regardless is what keeps that a precedence
      // rule instead of an accident of the current declarations, so it is
      // pinned here with a factory whose read-only roots skip that gate.
      const junieFactory = RulesProcessor.getFactory("junie")!;
      class AlwaysScannedJunieRule extends JunieRule {
        static override getSettablePaths(options: { global?: boolean } = {}) {
          const paths = JunieRule.getSettablePaths(options);
          if (!("importOnlyRoots" in paths) || !paths.importOnlyRoots) {
            return paths;
          }
          return {
            ...paths,
            importOnlyRoots: paths.importOnlyRoots.map((importOnlyRoot) => ({
              relativeDirPath: importOnlyRoot.relativeDirPath,
              relativeFilePath: importOnlyRoot.relativeFilePath,
            })),
          };
        }
      }

      await writeFileContent(join(testDir, ".junie", "AGENTS.md"), "# Root content");
      await writeFileContent(join(testDir, ".junie", "rules", "overview.md"), "# From rules dir");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "junie",
        getFactory: () => ({ ...junieFactory, class: AlwaysScannedJunieRule }),
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      // Both claim `overview.md`; the writer overwrites in array order, so the
      // last claimant is the one that survives on disk.
      const overviews = rulesyncFiles.filter(
        (file) => file.getRelativeFilePath() === "overview.md",
      );
      expect(overviews).toHaveLength(2);
      const winner = overviews.at(-1)!;
      expect(winner.getFileContent()).toContain("# Root content");
      expect(winner.getFileContent()).toContain("root: true");
      // The losing file is named in a warning rather than dropped silently.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Both ${join(".junie", "rules", "overview.md")}`),
      );
    });

    it("should keep .junie/rules/overview.md from taking the root rule's rulesync path", async () => {
      // `overview.md` is the rulesync root rule's own file name, so a Junie repo
      // that happens to name a rule that way must not end up with the root rule
      // replaced by a non-root one — which would leave the project with no root
      // rule at all. The read-only roots stand down while the root file exists.
      await writeFileContent(join(testDir, ".junie", "AGENTS.md"), "# Root content");
      await writeFileContent(join(testDir, ".junie", "rules", "overview.md"), "# From rules dir");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      expect(rulesyncFiles).toHaveLength(1);
      const overview = rulesyncFiles[0]!;
      expect(overview.getRelativeFilePath()).toBe("overview.md");
      expect(overview.getFileContent()).toContain("# Root content");
      expect(overview.getFileContent()).toContain("root: true");
    });

    it("should report, not silently drop, a read-only root that collides with the legacy root", async () => {
      // With only the legacy `.junie/guidelines.md` present the gate stays open,
      // so `.junie/rules/overview.md` and the legacy root both resolve to
      // `.rulesync/rules/overview.md`. The root file wins, and the file that
      // loses is named in a warning so its content is not lost unnoticed.
      await writeFileContent(join(testDir, ".junie", "guidelines.md"), "# Legacy root");
      await writeFileContent(join(testDir, ".junie", "rules", "overview.md"), "# From rules dir");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "junie" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      expect(rulesyncFiles.at(-1)!.getFileContent()).toContain("# Legacy root");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Both ${join(".junie", "rules", "overview.md")} and ${join(".junie", "guidelines.md")} import to`,
        ),
      );
    });

    it("should skip nested AGENTS.md files the project gitignores", async () => {
      // A vendored dependency's rule file is third-party content the user
      // deliberately kept untracked; importing it would copy it into
      // version-controlled `.rulesync/rules/`.
      await writeFileContent(join(testDir, ".gitignore"), "services/api/vendor/\n");
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "packages", "api", "AGENTS.md"), "# API");
      await writeFileContent(
        join(testDir, "services", "api", "vendor", "dep", "AGENTS.md"),
        "# Vendored",
      );

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });
      const files = await processor.loadToolFiles();
      const paths = files.map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );

      expect(paths).toContain(join("packages", "api", "AGENTS.md"));
      expect(paths).not.toContain(join("services", "api", "vendor", "dep", "AGENTS.md"));
    });

    it("should still find nested files when .gitignore excludes the generated file name", async () => {
      // `rulesync gitignore` writes `**/AGENTS.md` for its own output, so a
      // file-level ignore test would silently disable the whole scan.
      await writeFileContent(join(testDir, ".gitignore"), "services/api/vendor/\n**/AGENTS.md\n");
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "packages", "api", "AGENTS.md"), "# API");
      await writeFileContent(
        join(testDir, "services", "api", "vendor", "dep", "AGENTS.md"),
        "# Vendored",
      );

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });
      const paths = (await processor.loadToolFiles()).map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );

      expect(paths).toContain(join("packages", "api", "AGENTS.md"));
      expect(paths).not.toContain(join("services", "api", "vendor", "dep", "AGENTS.md"));
    });

    it("should warn when two rule files import to the same rulesync file name", async () => {
      await writeFileContent(join(testDir, "packages", "api", "AGENTS.md"), "# API");
      await writeFileContent(join(testDir, "packages-api", "AGENTS.md"), "# Also API");

      logger.warn.mockClear();
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });
      await processor.convertToolFilesToRulesyncFiles(await processor.loadToolFiles());

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes(join(RULESYNC_RULES_RELATIVE_DIR_PATH, "packages-api.md")),
        ),
      ).toBe(true);
    });

    it("should not warn when every rule file maps to a distinct rulesync name", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "packages", "api", "AGENTS.md"), "# API");
      await writeFileContent(join(testDir, "packages", "web", "AGENTS.md"), "# Web");
      await writeFileContent(join(testDir, ".agents", "memories", "extra.md"), "# Extra");

      logger.warn.mockClear();
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });
      await processor.convertToolFilesToRulesyncFiles(await processor.loadToolFiles());

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should keep an `Overview` subproject away from the reserved root-rule name", async () => {
      // Case-insensitive filesystems would otherwise resolve `Overview.md` and
      // the root rule's `overview.md` to the same file.
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "Overview", "AGENTS.md"), "# Overview subproject");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "agentsmd" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      expect(rulesyncFiles.map((file) => file.getRelativeFilePath()).toSorted()).toEqual([
        "Overview-agents.md",
        "overview.md",
      ]);
    });

    it("should load CLAUDE.md from .claude/ directory when only .claude/CLAUDE.md exists", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Project from .claude dir");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        outputRoot: testDir,
        toolTarget: "claudecode-legacy",
      });

      const files = await processor.loadToolFiles();
      const rootFiles = files.filter((f) => f.getRelativeFilePath() === "CLAUDE.md");

      expect(rootFiles.length).toBe(1);
      expect(rootFiles[0]?.getRelativeDirPath()).toBe(".claude");
    });

    it("should return empty when neither ./CLAUDE.md nor .claude/CLAUDE.md exist", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });
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

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "cursor" });

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
        outputRoot: testDir,
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
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "zoocode",
        "takt",
        "warp",
        "devin",
      ];

      for (const target of targets) {
        const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: target });

        const filesToDelete = await processor.loadToolFiles({
          forDeletion: true,
        });

        // Should return empty array since no files exist
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should handle errors gracefully", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        outputRoot: testDir,
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("CLAUDE.local.md");
    });

    it("should include .qwen/QWEN.local.md for deletion for qwencode", async () => {
      await writeFileContent(join(testDir, "QWEN.md"), "# Root");
      await writeFileContent(join(testDir, ".qwen", "QWEN.local.md"), "# Local");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "qwencode",
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) =>
        join(f.getRelativeDirPath(), f.getRelativeFilePath()),
      );
      expect(filePaths).toContain(join(".", "QWEN.md"));
      expect(filePaths).toContain(join(".qwen", "QWEN.local.md"));
    });

    it("should include CLAUDE.local.md for deletion for claudecode-legacy", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Local");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode-legacy",
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("CLAUDE.md");
      expect(filePaths).toContain("CLAUDE.local.md");
    });

    it("should NOT include CLAUDE.local.md for deletion for claudecode in global mode", async () => {
      // Local-root files (CLAUDE.local.md) are a project-scope concept; rulesync
      // never generates them in global mode, so the clean path must skip them in
      // global scope rather than searching for and deleting a user's hand-placed
      // global file.
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Local");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).not.toContain("CLAUDE.local.md");
    });

    it("should not double-import the kiro global root steering file (product.md)", async () => {
      // In global scope the kiro root (product.md) lives in the same dir as the
      // non-root steering files, so the non-root glob would otherwise re-import it.
      const steeringDir = join(testDir, ".kiro", "steering");
      await ensureDir(steeringDir);
      await writeFileContent(join(steeringDir, "product.md"), "Root overview");
      await writeFileContent(
        join(steeringDir, "tech.md"),
        "---\ninclusion: fileMatch\nfileMatchPattern: '**/*.ts'\n---\nTS steering",
      );

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "kiro",
        global: true,
      });

      const files = await processor.loadToolFiles();
      const filePaths = files.map((f) => f.getRelativeFilePath());

      expect(filePaths.filter((p) => p === "product.md")).toHaveLength(1);
      expect(filePaths).toContain("tech.md");
      expect(filePaths).toHaveLength(2);
    });

    it("should include AGENTS.local.md for deletion for rovodev", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Local");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });

      const filesToDelete = await processor.loadToolFiles({
        forDeletion: true,
      });

      const filePaths = filesToDelete.map((f) => f.getRelativeFilePath());
      expect(filePaths).toContain("AGENTS.local.md");
    });

    it("should include AGENTS.local.md for deletion for roo (issue #2409)", async () => {
      await ensureDir(join(testDir, ".roo", "rules"));
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Local");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "roo" });

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

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        "amp",
        "antigravity-cli",
        "antigravity-ide",
        "augmentcode",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "copilot",
        "copilotcli",
        "deepagents",
        "factorydroid",
        "goose",
        "grokcli",
        "junie",
        "kilo",
        "kimi-code",
        "kiro",
        "kiro-cli",
        "kiro-ide",
        "opencode",
        "pi",
        "qwencode",
        "reasonix",
        "roo",
        "rovodev",
        "zoocode",
        "takt",
        "vibe",
        "warp",
        "devin",
        "zcode",
        "zed",
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
      expect(globalTargets).toContain("amp");
      expect(globalTargets).toContain("antigravity-cli");
      expect(globalTargets).toContain("antigravity-ide");
      expect(globalTargets).toContain("augmentcode");
      expect(globalTargets).toContain("claudecode");
      expect(globalTargets).toContain("claudecode-legacy");
      expect(globalTargets).toContain("cline");
      expect(globalTargets).toContain("codexcli");
      expect(globalTargets).toContain("copilot");
      expect(globalTargets).toContain("copilotcli");
      expect(globalTargets).toContain("deepagents");
      expect(globalTargets).toContain("factorydroid");
      expect(globalTargets).toContain("junie");
      expect(globalTargets).toContain("kilo");
      expect(globalTargets).toContain("kimi-code");
      expect(globalTargets).toContain("goose");
      expect(globalTargets).toContain("grokcli");
      expect(globalTargets).toContain("opencode");
      expect(globalTargets).toContain("pi");
      expect(globalTargets).toContain("roo");
      expect(globalTargets).toContain("rovodev");
      expect(globalTargets).toContain("takt");
      expect(globalTargets).toContain("vibe");
      expect(globalTargets).toContain("devin");
      expect(globalTargets).toContain("zed");
      expect(globalTargets).toContain("kiro");
      expect(globalTargets).toContain("kiro-cli");
      expect(globalTargets).toContain("kiro-ide");
      expect(globalTargets).toContain("reasonix");
      expect(globalTargets).toContain("warp");
      expect(globalTargets.length).toBe(33);

      // These targets should NOT be in global mode
      expect(globalTargets).not.toContain("cursor");
      expect(globalTargets).not.toContain("hermesagent");
    });
  });

  describe("RulesProcessor with global flag", () => {
    describe("constructor", () => {
      it("should accept global parameter", () => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });

      it("should default global to false when not specified", () => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget: "claudecode",
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });
    });

    describe("loadRulesyncFiles in global mode", () => {
      it("should accept global parameter in constructor", () => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
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
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
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

      it("should merge multiple global root rules that resolve to the same path", async () => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "10-overview.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Global Overview",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "20-personal-assistant.md",
            frontmatter: {
              root: true,
              targets: ["claudecode"],
            },
            body: "# Personal Assistant",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ClaudecodeRule);
        expect(result[0]?.getRelativeDirPath()).toBe(".claude");
        expect(result[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
        expect(result[0]?.getFileContent()).toBe("# Global Overview\n\n# Personal Assistant");
      });

      it.each([false, true])(
        "should preserve multiple root fragments across every target with global=%s",
        async (global) => {
          for (const toolTarget of RulesProcessor.getToolTargets({ global })) {
            const processor = new RulesProcessor({
              logger,
              outputRoot: testDir,
              toolTarget: toolTarget as RulesProcessorToolTarget,
              global,
            });
            const rulesyncRules = [
              new RulesyncRule({
                outputRoot: testDir,
                relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
                relativeFilePath: "10-first-root.md",
                frontmatter: {
                  root: true,
                  targets: ["*"],
                  description: "First root",
                  globs: ["**/*"],
                },
                body: "# First Root Fragment",
              }),
              new RulesyncRule({
                outputRoot: testDir,
                relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
                relativeFilePath: "20-second-root.md",
                frontmatter: {
                  root: true,
                  targets: ["*"],
                  description: "Second root",
                  globs: ["**/*"],
                },
                body: "# Second Root Fragment",
              }),
            ];

            const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
            const outputPaths = result.map((rule) =>
              join(rule.getRelativeDirPath(), rule.getRelativeFilePath()),
            );
            const generatedContent = result.map((rule) => rule.getFileContent()).join("\n");

            expect(new Set(outputPaths).size, toolTarget).toBe(outputPaths.length);
            expect(generatedContent, toolTarget).toContain("# First Root Fragment");
            expect(generatedContent, toolTarget).toContain("# Second Root Fragment");
            expect(
              result.every(
                (rule) => rule.getFileContent().split("# First Root Fragment").length <= 2,
              ),
              toolTarget,
            ).toBe(true);
            expect(
              result.every(
                (rule) => rule.getFileContent().split("# Second Root Fragment").length <= 2,
              ),
              toolTarget,
            ).toBe(true);
          }
        },
      );
    });
  });

  describe("convertRulesyncFilesToToolFiles collision handling", () => {
    it.each(["devin", "antigravity-ide"] as const)(
      "should warn for metadata-bearing project rules normalized to the same %s path",
      async (toolTarget) => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget,
        });
        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "CodingGuidelines.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              description: "First normalized rule",
              globs: ["**/*"],
            },
            body: "# First Normalized Rule",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "coding_guidelines.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              description: "Second normalized rule",
              globs: ["src/**/*"],
            },
            body: "# Second Normalized Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(2);
        // Both sources normalize to the exact same path, so the warning names
        // that path once, without the case-insensitivity clause.
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("; the last one wins wherever they collide."),
        );
        expect(logger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining("compared case-insensitively"),
        );
      },
    );

    it("should reject root collisions with metadata-bearing modular rules", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "kiro",
        global: true,
      });
      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["kiro"] },
          body: "# Root Body",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "product.md",
          frontmatter: {
            root: false,
            targets: ["kiro"],
            globs: ["src/**/*.ts"],
          },
          body: "# Non Root Body",
        }),
      ];

      await expect(processor.convertRulesyncFilesToToolFiles(rulesyncRules)).rejects.toThrow(
        `Multiple generated rules resolve to output path '${join(".kiro", "steering", "product.md")}' for target 'kiro', but this target cannot safely compose a collision involving a root rule. Source rules: ${join(RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md")}, ${join(RULESYNC_RULES_RELATIVE_DIR_PATH, "product.md")}`,
      );
    });

    it.each(["agentsmd", "amp", "factorydroid", "kilo", "opencode"] as const)(
      "should compose plain Markdown %s modular rules with the same output path",
      async (toolTarget) => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget,
        });
        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "first.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              agentsmd: { subprojectPath: "packages/app" },
            },
            body: "# First Subproject Rule",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "second.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              agentsmd: { subprojectPath: "packages/app" },
            },
            body: "# Second Subproject Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
        const composedRules = result.filter(
          (file) => file.getRelativeDirPath() === join("packages", "app"),
        );

        expect(composedRules).toHaveLength(1);
        expect(composedRules[0]?.getFileContent()).toBe(
          "# First Subproject Rule\n\n# Second Subproject Rule",
        );
      },
    );

    it("should not compose amp fragments that carry a globs frontmatter gate", async () => {
      // Amp gates non-root files on a leading `globs:` frontmatter block
      // (issue #2410). Concatenating two gated fragments would bury the second
      // block mid-body where Amp never reads it, so the group falls back to
      // preserve-and-warn instead of composing.
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "amp",
      });
      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "first.md",
          frontmatter: {
            root: false,
            targets: ["amp"],
            globs: ["packages/app/**/*.ts"],
            agentsmd: { subprojectPath: "packages/app" },
          },
          body: "# First Gated Rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "second.md",
          frontmatter: {
            root: false,
            targets: ["amp"],
            globs: ["packages/app/**/*.tsx"],
            agentsmd: { subprojectPath: "packages/app" },
          },
          body: "# Second Gated Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const gatedRules = result.filter(
        (file) => file.getRelativeDirPath() === join("packages", "app"),
      );

      expect(gatedRules).toHaveLength(2);
      for (const rule of gatedRules) {
        // Each file keeps exactly one frontmatter block, at the top.
        expect(rule.getFileContent().startsWith("---\n")).toBe(true);
        expect(rule.getFileContent()).not.toMatch(/\n---\nglobs:/);
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("; the last one wins wherever they collide."),
      );
    });

    it("should reject Takt rules with the same overridden output name", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "takt",
      });
      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "first.md",
          frontmatter: {
            root: true,
            targets: ["takt"],
            takt: { name: "same", extends: "base-one" },
          },
          body: "# First Takt Rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "second.md",
          frontmatter: {
            root: true,
            targets: ["takt"],
            takt: { name: "same", extends: "base-two" },
          },
          body: "# Second Takt Rule",
        }),
      ];

      await expect(processor.convertRulesyncFilesToToolFiles(rulesyncRules)).rejects.toThrow(
        `Multiple generated rules resolve to output path '${join(".takt", "facets", "policies", "same.md")}' for target 'takt', but this target cannot safely compose a collision involving a root rule. Source rules: ${join(RULESYNC_RULES_RELATIVE_DIR_PATH, "first.md")}, ${join(RULESYNC_RULES_RELATIVE_DIR_PATH, "second.md")}`,
      );
    });

    it.each([
      {
        toolTarget: "cursor",
        expectedPaths: [
          join(".cursor", "rules", "overview.mdc"),
          join(".cursor", "rules", "API.mdc"),
          join(".cursor", "rules", "api.mdc"),
        ],
      },
      {
        toolTarget: "claudecode",
        expectedPaths: [
          "CLAUDE.md",
          join(".claude", "rules", "API.md"),
          join(".claude", "rules", "api.md"),
        ],
      },
    ] as const)(
      "should preserve unrelated $toolTarget output paths that differ only by case",
      async ({ toolTarget, expectedPaths }) => {
        const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget });
        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "overview.md",
            frontmatter: { root: true, targets: [toolTarget] },
            body: "# Overview",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "API.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              description: "Uppercase API rule",
              globs: ["**/*"],
            },
            body: "# Uppercase API",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "api.md",
            frontmatter: {
              root: false,
              targets: [toolTarget],
              description: "Lowercase API rule",
              globs: ["src/**/*"],
            },
            body: "# Lowercase API",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
        const outputPaths = result.map((rule) =>
          join(rule.getRelativeDirPath(), rule.getRelativeFilePath()),
        );

        expect(outputPaths).toEqual(expectedPaths);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            "(compared case-insensitively, as on macOS and Windows); the last one wins wherever they collide.",
          ),
        );
      },
    );
  });

  describe("RulesProcessor with global flag", () => {
    describe("convertRulesyncFilesToToolFiles in global mode", () => {
      it("should convert using global paths when global=true for codexcli", async () => {
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget: "codexcli",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
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
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: false,
        });

        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
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

  describe("reasonix nested instruction files", () => {
    it("should import nested REASONIX.md files alongside the root", async () => {
      await writeFileContent(join(testDir, "REASONIX.md"), "# Root");
      await writeFileContent(join(testDir, "packages", "api", "REASONIX.md"), "# API");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "reasonix" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const names = rulesyncFiles.map((file) => file.getRelativeFilePath());
      expect(names).toContain("packages-api-reasonix.md");
    });

    it("should emit a subprojectPath rule as a nested file instead of folding it", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---\nroot: true\ntargets: ["reasonix"]\nglobs: ["**/*"]\n---\n# Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "api.md"),
        `---\nroot: false\ntargets: ["reasonix"]\nglobs: ["packages/api/**/*"]\nagentsmd:\n  subprojectPath: "packages/api"\n---\n# API scoped`,
      );

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "reasonix" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(
        await processor.loadRulesyncFiles(),
      );

      const paths = toolFiles.map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );
      expect(paths).toContain(join("packages", "api", "REASONIX.md"));
      const root = toolFiles.find(
        (file) => file.getRelativeDirPath() === "." && file.getRelativeFilePath() === "REASONIX.md",
      );
      expect(root?.getFileContent()).not.toContain("# API scoped");
    });
  });

  describe("localRoot import round-trip", () => {
    it("should import CLAUDE.local.md as a localRoot rulesync rule for claudecode", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Personal local rules");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "CLAUDE.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      const frontmatter = (localRule as RulesyncRule).getFrontmatter();
      expect(frontmatter.localRoot).toBe(true);
      expect(frontmatter.root).toBe(false);
      // Scoped to the importing tool: a wildcard would spread the personal
      // content into other tools' committed root files on the next generate.
      expect(frontmatter.targets).toEqual(["claudecode"]);
      expect((localRule as RulesyncRule).getBody().trim()).toBe("# Personal local rules");
    });

    it("should import CLAUDE.local.md scoped to claudecode-legacy for claudecode-legacy", async () => {
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Personal local rules");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode-legacy",
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "CLAUDE.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      const frontmatter = (localRule as RulesyncRule).getFrontmatter();
      expect(frontmatter.localRoot).toBe(true);
      expect(frontmatter.targets).toEqual(["claudecode-legacy"]);
    });

    it("should keep generate working after importing local files from multiple tools", async () => {
      // Import from claudecode and qwencode into the same .rulesync/rules/
      // directory, then run the per-target validation that generate performs.
      // With per-tool targets each target sees exactly one localRoot rule; a
      // wildcard would make every generate throw "Multiple localRoot rules".
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Claude personal");
      await writeFileContent(join(testDir, "QWEN.md"), "# Root");
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(join(testDir, ".qwen", "QWEN.local.md"), "# Qwen personal");

      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      for (const toolTarget of ["claudecode", "qwencode"] as const) {
        const importProcessor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget });
        const rulesyncFiles = await importProcessor.convertToolFilesToRulesyncFiles(
          await importProcessor.loadToolFiles(),
        );
        for (const rulesyncFile of rulesyncFiles) {
          await writeFileContent(
            join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, rulesyncFile.getRelativeFilePath()),
            rulesyncFile.getFileContent(),
          );
        }
      }

      for (const toolTarget of ["claudecode", "qwencode"] as const) {
        const generateProcessor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget });
        const loaded = await generateProcessor.loadRulesyncFiles();
        expect(loaded.length).toBeGreaterThan(0);
      }
    });

    it("should import .qwen/QWEN.local.md as a localRoot rulesync rule for qwencode", async () => {
      await writeFileContent(join(testDir, "QWEN.md"), "# Root");
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(join(testDir, ".qwen", "QWEN.local.md"), "# Personal qwen rules");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "qwencode",
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "QWEN.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      const frontmatter = (localRule as RulesyncRule).getFrontmatter();
      expect(frontmatter.localRoot).toBe(true);
      expect(frontmatter.root).toBe(false);
      expect((localRule as RulesyncRule).getBody().trim()).toBe("# Personal qwen rules");
    });

    it("should import AGENTS.local.md as a localRoot rulesync rule for rovodev", async () => {
      await ensureDir(join(testDir, ".rovodev"));
      await writeFileContent(join(testDir, ".rovodev", "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Personal rovodev rules");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "AGENTS.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      const frontmatter = (localRule as RulesyncRule).getFrontmatter();
      expect(frontmatter.localRoot).toBe(true);
      expect(frontmatter.root).toBe(false);
      expect((localRule as RulesyncRule).getBody().trim()).toBe("# Personal rovodev rules");
    });

    it("should import AGENTS.local.md as a localRoot rulesync rule for roo", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Personal roo rules");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "roo" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "AGENTS.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      expect((localRule as RulesyncRule).getFrontmatter().localRoot).toBe(true);
    });

    it("should import AGENTS.local.md as a localRoot rulesync rule for zoocode (issue #2596)", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Personal zoocode rules");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "zoocode" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "AGENTS.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      expect((localRule as RulesyncRule).getFrontmatter().localRoot).toBe(true);
    });

    it("should import AGENTS.local.md as a localRoot rulesync rule for devin (issue #2688)", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      await writeFileContent(join(testDir, "AGENTS.local.md"), "# Personal devin rules");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "devin" });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "AGENTS.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      expect((localRule as RulesyncRule).getFrontmatter().localRoot).toBe(true);
    });

    it("should import .claude/CLAUDE.local.md from the alternative root directory", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, ".claude", "CLAUDE.local.md"), "# Local from .claude");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      const localRule = findLocalRule(rulesyncFiles, "CLAUDE.local.md");
      expect(localRule).toBeInstanceOf(RulesyncRule);
      expect((localRule as RulesyncRule).getBody().trim()).toBe("# Local from .claude");
    });

    it("should drop the source tool's local file when converting to another tool", async () => {
      // convert (tool → tool) shares this import path. The imported localRoot
      // rule targets the source tool only, so the destination tool must not
      // fold the personal content into its own (possibly committed) files.
      await writeFileContent(join(testDir, "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Claude personal");

      const sourceProcessor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(
        await sourceProcessor.loadToolFiles(),
      );
      expect(findLocalRule(rulesyncFiles, "CLAUDE.local.md")).toBeInstanceOf(RulesyncRule);

      const destProcessor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "qwencode",
      });
      const toolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      const fileContents = toolFiles.map((file) => file.getFileContent()).join("\n");
      expect(toolFiles.some((file) => file.getRelativeFilePath() === "QWEN.local.md")).toBe(false);
      expect(fileContents).not.toContain("# Claude personal");
    });

    it("should NOT import CLAUDE.local.md in global mode", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "CLAUDE.md"), "# Root");
      await writeFileContent(join(testDir, "CLAUDE.local.md"), "# Local");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      expect(findLocalRule(rulesyncFiles, "CLAUDE.local.md")).toBeUndefined();
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();

      // Should only return root rule, ignoring localRoot
      expect(result).toHaveLength(1);
      const rulesyncRule = result[0] as RulesyncRule;
      expect(rulesyncRule.getFrontmatter().root).toBe(true);
    });

    it("should load rulesync files from cwd even when outputRoot is different (global mode)", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["*"]
---
# Root rule`,
      );

      // Use a different outputRoot to simulate global mode (outputRoot = homeDir)
      const differentOutputRoot = join(testDir, "fake-home");
      await ensureDir(differentOutputRoot);

      const processor = new RulesProcessor({
        logger,
        outputRoot: differentOutputRoot,
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
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
        outputRoot: testDir,
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
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
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "rovodev" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["rovodev"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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

    it("should generate AGENTS.local.md for roo localRoot rule (issue #2409)", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "roo" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { root: true, targets: ["roo"] },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { localRoot: true, targets: ["roo"] },
          body: "# Local overrides",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Roo loads AGENTS.local.md for personal, gitignored overrides — the
      // localRoot rule must get its own file, not be folded into AGENTS.md.
      const localRule = result.find((r) => r.getRelativeFilePath() === "AGENTS.local.md");
      expect(localRule).toBeDefined();
      expect(localRule?.getFileContent()).toBe("# Local overrides");
      const rootRule = result.find((r) => r.getRelativeFilePath() === "AGENTS.md");
      expect(rootRule?.getFileContent()).not.toContain("# Local overrides");
    });

    it.each(["roo", "zoocode"] as const)(
      "should generate the same AGENTS.local.md for %s (issue #2596)",
      async (toolTarget) => {
        const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget });

        const rulesyncRules = [
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: { root: true, targets: ["*"] },
            body: "# Root",
          }),
          new RulesyncRule({
            outputRoot: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "local.md",
            frontmatter: { localRoot: true, targets: ["*"] },
            body: "# Local overrides",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        // `ZoocodeRule extends RooRule`, so the local-root dispatch must be
        // subclass-aware; a strict class-identity check silently produced no
        // AGENTS.local.md for zoocode while the target declared support for it.
        const localRule = result.find((r) => r.getRelativeFilePath() === "AGENTS.local.md");
        expect(localRule).toBeDefined();
        expect(localRule?.getFileContent()).toBe("# Local overrides");
        expect(
          result.find((r) => r.getRelativeFilePath() === "AGENTS.md")?.getFileContent(),
        ).not.toContain("# Local overrides");
      },
    );

    it("should generate AGENTS.local.md for devin instead of folding it into AGENTS.md (issue #2688)", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "devin" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { root: true, targets: ["devin"] },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { localRoot: true, targets: ["devin"] },
          body: "# Personal overrides",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      const localRule = result.find((r) => r.getRelativeFilePath() === "AGENTS.local.md");
      expect(localRule).toBeDefined();
      // Plain markdown: Devin's local file carries no trigger frontmatter.
      expect(localRule?.getFileContent()).toBe("# Personal overrides");
      const rootRule = result.find((r) => r.getRelativeFilePath() === "AGENTS.md");
      expect(rootRule?.getFileContent()).not.toContain("# Personal overrides");
    });

    it("should append localRoot content to root file for other tools", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "copilot" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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

    it("should skip localRoot content when includeLocalRoot is false", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "copilot",
        featureOptions: { includeLocalRoot: false },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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

      expect(result).toHaveLength(1);
      const rootRule = result.find((r) => r instanceof CopilotRule && r.isRoot());
      expect(rootRule?.getFileContent()).toContain("# Root content");
      expect(rootRule?.getFileContent()).not.toContain("# Local content");
    });

    it("should include localRoot content when includeLocalRoot is explicitly true", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "copilot",
        featureOptions: { includeLocalRoot: true },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { localRoot: true, targets: ["*"] },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((r) => r instanceof CopilotRule && r.isRoot());
      expect(rootRule?.getFileContent()).toContain("# Root content");
      expect(rootRule?.getFileContent()).toContain("# Local content");
    });

    it("should throw when includeLocalRoot is not a boolean", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "copilot",
        featureOptions: { includeLocalRoot: "false" as unknown as boolean },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "# Root",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { localRoot: true, targets: ["*"] },
          body: "# Local",
        }),
      ];

      await expect(processor.convertRulesyncFilesToToolFiles(rulesyncRules)).rejects.toThrow(
        /includeLocalRoot.*must be a boolean/,
      );
    });

    it("should coexist with ruleDiscoveryMode option", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
        featureOptions: { includeLocalRoot: false, ruleDiscoveryMode: "explicit" },
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "local.md",
          frontmatter: { localRoot: true, targets: ["*"] },
          body: "# Local content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const localRule = result.find((r) => r.getRelativeFilePath() === "CLAUDE.local.md");
      expect(localRule).toBeUndefined();
    });

    it("should not generate localRoot rule in global mode", async () => {
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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
        outputRoot: testDir,
        toolTarget: "opencode",
      });
      const openCodeRulesyncFiles = await openCodeProcessor.loadRulesyncFiles();
      const openCodeToolFiles =
        await openCodeProcessor.convertRulesyncFilesToToolFiles(openCodeRulesyncFiles);
      await openCodeProcessor.writeAiFiles(openCodeToolFiles);

      // Process agentsmd second (should overwrite)
      const agentsMdProcessor = new RulesProcessor({
        logger,
        outputRoot: testDir,
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

  describe("loadRulesyncFiles with curated rules", () => {
    it("should compose local root fragments before curated root fragments", async () => {
      const frontmatter = "---\nroot: true\ntargets:\n  - claudecode\n---\n";
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "20-local.md"),
        `${frontmatter}# Local Root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "05-curated.md"),
        `${frontmatter}# Curated Root`,
      );
      const processor = new RulesProcessor({
        logger,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const [toolRule] = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const content = toolRule?.getFileContent() ?? "";

      expect(content.indexOf("# Local Root")).toBeLessThan(content.indexOf("# Curated Root"));
    });

    it("should load curated rules while preferring a same-path local rule", async () => {
      const frontmatter = "---\ntargets:\n  - '*'\n---\n";
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Local content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Remote content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "remote-only.md"),
        `${frontmatter}Remote-only content`,
      );
      const processor = new RulesProcessor({
        logger,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        outputRoot: testDir,
        toolTarget: "copilot",
      });

      const result = (await processor.loadRulesyncFiles()) as RulesyncRule[];
      const byPath = new Map(result.map((rule) => [rule.getRelativeFilePath(), rule]));

      expect(byPath.size).toBe(2);
      expect(byPath.get("shared.md")?.getBody()).toBe("Local content");
      expect(byPath.get("remote-only.md")?.getBody()).toBe("Remote-only content");
      expect([...byPath.keys()]).not.toContain(".curated/remote-only.md");
    });

    it("should prefer a local rule over a case-variant curated rule", async () => {
      const frontmatter = "---\ntargets:\n  - '*'\n---\n";
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "Shared.md"),
        `${frontmatter}Local content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Remote content`,
      );
      const processor = new RulesProcessor({
        logger,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        outputRoot: testDir,
        toolTarget: "copilot",
      });

      const result = (await processor.loadRulesyncFiles()) as RulesyncRule[];

      expect(result).toHaveLength(1);
      expect(result[0]?.getRelativeFilePath()).toBe("Shared.md");
      expect(result[0]?.getBody()).toBe("Local content");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive rule collision under"),
      );
    });

    it("should not warn when a curated rule is shadowed by an exactly-named local rule", async () => {
      const frontmatter = "---\ntargets:\n  - '*'\n---\n";
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Local content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Remote content`,
      );
      const processor = new RulesProcessor({
        logger,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        outputRoot: testDir,
        toolTarget: "copilot",
      });

      const result = (await processor.loadRulesyncFiles()) as RulesyncRule[];

      expect(result).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive rule collision under"),
      );
    });

    // On a case-sensitive filesystem both spellings can exist side by side, so
    // the exactly-named local rule must be the one that decides whether this is
    // a plain override or an ambiguous collision. (On a case-insensitive
    // filesystem the two files are one, so this degenerates into the
    // plain-override case above and still holds.)
    it("should not warn when an exactly-named local rule exists next to a case variant", async () => {
      const frontmatter = "---\ntargets:\n  - '*'\n---\n";
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Local content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "Shared.md"),
        `${frontmatter}Local variant content`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH, "shared.md"),
        `${frontmatter}Remote content`,
      );
      const processor = new RulesProcessor({
        logger,
        inputRoots: [join(testDir, RULESYNC_RELATIVE_DIR_PATH)],
        outputRoot: testDir,
        toolTarget: "copilot",
      });

      const result = (await processor.loadRulesyncFiles()) as RulesyncRule[];

      expect(result.map((rule) => rule.getBody())).not.toContain("Remote content");
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive rule collision under"),
      );
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      await processor.loadRulesyncFiles();

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("No root rulesync rule file found"),
      );
    });

    it("should not warn when no rulesync rules exist", async () => {
      // Ensure the directory exists but is empty
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));

      const warnSpy = vi.spyOn(logger, "warn");

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const result = await processor.loadRulesyncFiles();
      const rootRules = result.filter((r) => r instanceof RulesyncRule && r.getFrontmatter().root);
      expect(rootRules).toHaveLength(1);
      expect((rootRules[0] as RulesyncRule).getFrontmatter().targets).toEqual(["claudecode"]);
    });

    it("should allow two root rules targeting the same tool", async () => {
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const result = await processor.loadRulesyncFiles();
      const rootRules = result.filter(
        (rule): rule is RulesyncRule =>
          rule instanceof RulesyncRule && rule.getFrontmatter().root === true,
      );

      expect(rootRules).toHaveLength(2);
      expect(rootRules.map((rule) => rule.getBody())).toEqual(["# Root 1", "# Root 2"]);
    });

    it("should allow wildcard and specific root rules when both match", async () => {
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const result = await processor.loadRulesyncFiles();
      const rootRules = result.filter(
        (rule): rule is RulesyncRule =>
          rule instanceof RulesyncRule && rule.getFrontmatter().root === true,
      );

      expect(rootRules).toHaveLength(2);
      expect(rootRules.map((rule) => rule.getBody())).toEqual(["# Claude Root", "# Wildcard Root"]);
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
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(1);
      expect((result[0] as RulesyncRule).getFrontmatter().targets).toEqual(["claudecode"]);
    });

    it("should retain multiple matching root rules in global mode", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "10-overview.md"),
        `---
root: true
targets: ["*"]
---
# Global Overview`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "20-personal-assistant.md"),
        `---
root: true
targets: ["claudecode"]
---
# Personal Assistant`,
      );

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(2);
      expect(result.map((rule) => (rule as RulesyncRule).getBody())).toEqual([
        "# Global Overview",
        "# Personal Assistant",
      ]);
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

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
        outputRoot: testDir,
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

    it("should include non-root rules in global mode for claudecode (global nonRoot support)", async () => {
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
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      // Claude Code reads user-level rules from ~/.claude/rules/*.md, so global
      // non-root rules are kept rather than dropped.
      const result = await processor.loadRulesyncFiles();
      expect(result).toHaveLength(2);
      expect(result.some((r) => (r as RulesyncRule).getFrontmatter().root)).toBe(true);
      expect(result.some((r) => !(r as RulesyncRule).getFrontmatter().root)).toBe(true);
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("non-root rulesync rules found, but it's in global mode"),
      );
    });

    it("should expose every global-capable folded target to the regression matrix", () => {
      expect(globalFoldTargets).toEqual([
        "codexcli",
        "deepagents",
        "goose",
        // `grokcli` left this list when it gained `.grok/rules/`.
        "junie",
        "kimi-code",
        "pi",
        "reasonix",
        "vibe",
        "warp",
        "zcode",
      ]);
    });

    it.each(globalFoldTargets)(
      "should retain and fold global non-root rules for %s",
      async (toolTarget) => {
        await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
        await writeFileContent(
          join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
          `---
root: true
targets: ["${toolTarget}"]
---
# Global root`,
        );
        await writeFileContent(
          join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
          `---
targets: ["${toolTarget}"]
---
# Global detail`,
        );

        const warnSpy = vi.spyOn(logger, "warn");
        const processor = new RulesProcessor({
          logger,
          outputRoot: testDir,
          toolTarget,
          global: true,
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        expect(rulesyncFiles).toHaveLength(2);

        const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
        const globalRootPath = RulesProcessor.getFactory(toolTarget)?.class.getSettablePaths({
          global: true,
        }).root;
        expect(toolFiles).toHaveLength(1);
        expect(globalRootPath).toBeDefined();
        expect(toolFiles[0]?.getRelativeDirPath()).toBe(globalRootPath?.relativeDirPath);
        expect(toolFiles[0]?.getRelativeFilePath()).toBe(globalRootPath?.relativeFilePath);
        expect(toolFiles[0]?.getFileContent()).toContain("# Global root");
        expect(toolFiles[0]?.getFileContent()).toContain("# Global detail");
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining("non-root rulesync rules found, but it's in global mode"),
        );
      },
    );

    it("should keep ignoring global non-root rules for root-only targets", async () => {
      await ensureDir(join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "root.md"),
        `---
root: true
targets: ["amp"]
---
# Global root`,
      );
      await writeFileContent(
        join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "detail.md"),
        `---
targets: ["amp"]
---
# Global detail`,
      );

      const warnSpy = vi.spyOn(logger, "warn");
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "amp",
        global: true,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toHaveLength(1);
      expect((rulesyncFiles[0] as RulesyncRule).getFrontmatter().root).toBe(true);
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
        outputRoot: testDir,
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
        outputRoot: testDir,
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

      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.loadRulesyncFiles()).rejects.toThrow(
        "localRoot: true requires a root: true rule to exist for target 'claudecode'",
      );
    });
  });

  describe("loadRulesyncFiles with inputRoots", () => {
    // Mirror the per-feature inputRoots threading assertion used in
    // commands-processor.test.ts: when inputRoots is set, loadRulesyncFiles
    // reads from `<inputRoots[0]>/rules` (source tree itself) instead of
    // `<process.cwd()>/.rulesync/rules`.
    it("should read rulesync rule files from inputRoots[0] instead of process.cwd()", async () => {
      // Source rules live in a custom source tree — NOT under cwd's `.rulesync/`.
      const customInputRoot = join(testDir, "custom-rulesync-dir", RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(join(customInputRoot, "rules"));
      await writeFileContent(
        join(customInputRoot, "rules", "overview.md"),
        `---
root: true
targets: ["*"]
---
# Input-root rule`,
      );

      // outputRoot is process.cwd() (testDir) where the rulesync directory
      // does NOT exist. If inputRoots threading is broken, this test fails
      // because no rules would be found under testDir/.rulesync/rules/.
      const processor = new RulesProcessor({
        logger,
        outputRoot: testDir,
        inputRoots: [customInputRoot],
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toHaveLength(1);
      // Assert directly on the loaded rule, not by re-reading the file we
      // just wrote: the meaningful check is that the rule's parsed body and
      // frontmatter come from the inputRoots[0] file, not from anywhere under
      // outputRoot/process.cwd().
      const loadedRule = rulesyncFiles[0] as RulesyncRule;
      expect(loadedRule.getFrontmatter().root).toBe(true);
      expect(loadedRule.getBody()).toContain("Input-root rule");
    });
  });

  describe("kilo instructions registration", () => {
    it("should register non-root rules in kilo.jsonc instructions and not the root rule", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "kilo" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "Root rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["*"] },
          body: "Detail rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // The non-root rule is emitted under .kilo/rules/
      const ruleFile = result.find((f) => f.getRelativeFilePath() === "detail.md");
      expect(ruleFile).toBeDefined();
      expect(ruleFile?.getRelativeDirPath()).toBe(join(".kilo", "rules"));

      // A kilo.jsonc file is also produced with the non-root rule registered.
      const kiloConfig = result.find((f) => f.getRelativeFilePath() === "kilo.jsonc");
      expect(kiloConfig).toBeDefined();
      const json = JSON.parse(kiloConfig!.getFileContent());
      expect(json.instructions).toEqual([".kilo/rules/detail.md"]);
      // Root AGENTS.md must NOT be registered.
      expect(json.instructions).not.toContain("AGENTS.md");
    });

    it("should preserve a pre-existing mcp block in kilo.jsonc when registering instructions", async () => {
      const existingConfig = {
        mcp: {
          "my-server": {
            type: "local",
            command: ["node", "server.js"],
            enabled: true,
          },
        },
      };
      await writeFileContent(join(testDir, "kilo.jsonc"), JSON.stringify(existingConfig, null, 2));

      const processor = new RulesProcessor({ logger, toolTarget: "kilo" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["*"] },
          body: "Detail rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      const kiloConfig = result.find((f) => f.getRelativeFilePath() === "kilo.jsonc");
      expect(kiloConfig).toBeDefined();
      const json = JSON.parse(kiloConfig!.getFileContent());
      expect(json.mcp).toEqual(existingConfig.mcp);
      expect(json.instructions).toEqual([".kilo/rules/detail.md"]);
    });

    it("should not produce a kilo.jsonc when only a root rule exists", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "kilo" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "Root rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result.find((f) => f.getRelativeFilePath() === "kilo.jsonc")).toBeUndefined();
    });
  });

  describe("opencode instructions registration", () => {
    it("should register non-root rules in opencode.jsonc instructions and not the root rule", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "opencode" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "Root rule",
        }),
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "detail.md",
          frontmatter: { root: false, targets: ["*"] },
          body: "Detail rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // The non-root rule is emitted under .opencode/memories/
      const ruleFile = result.find((f) => f.getRelativeFilePath() === "detail.md");
      expect(ruleFile).toBeDefined();
      expect(ruleFile?.getRelativeDirPath()).toBe(join(".opencode", "memories"));

      // An opencode.jsonc file is also produced with the non-root rule registered.
      const opencodeConfig = result.find((f) => f.getRelativeFilePath() === "opencode.jsonc");
      expect(opencodeConfig).toBeDefined();
      const json = JSON.parse(opencodeConfig!.getFileContent());
      expect(json.instructions).toEqual([".opencode/memories/detail.md"]);
      // Root AGENTS.md must NOT be registered (it is auto-loaded).
      expect(json.instructions).not.toContain("AGENTS.md");
    });

    it("should not produce an opencode.jsonc when only a root rule exists", async () => {
      const processor = new RulesProcessor({ logger, toolTarget: "opencode" });

      const rulesyncRules = [
        new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "overview.md",
          frontmatter: { root: true, targets: ["*"] },
          body: "Root rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(
        result.find(
          (f) =>
            f.getRelativeFilePath() === "opencode.jsonc" ||
            f.getRelativeFilePath() === "opencode.json",
        ),
      ).toBeUndefined();
    });
  });
  describe("output roots that hold glob metacharacters", () => {
    // Every scan below spells the project root into `findFilesByGlobs`'s `cwd`
    // rather than into the pattern. Spelled into the pattern, `project(glob)` is
    // a picomatch group and matches nothing at all -- and an empty scan is not a
    // visible failure: on the input side it reads as "every rule was deleted",
    // so `--delete` removes generated files it can no longer regenerate and the
    // run still reports success.

    it("should load rulesync rules from a root that holds glob metacharacters", async () => {
      const literalRoot = join(testDir, "project(glob)");
      await writeFileContent(
        join(literalRoot, RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"),
        '---\nroot: true\ntargets: ["*"]\n---\n\nRoot rule',
      );

      const processor = new RulesProcessor({
        logger,
        outputRoot: literalRoot,
        inputRoots: [join(literalRoot, RULESYNC_RELATIVE_DIR_PATH)],
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      expect(rulesyncFiles.map((file) => file.getRelativeFilePath())).toEqual(["overview.md"]);
    });

    it("should load root and non-root tool files for deletion from such a root", async () => {
      const literalRoot = join(testDir, "project{a,b}");
      await writeFileContent(join(literalRoot, "CLAUDE.md"), "# Root");
      await writeFileContent(join(literalRoot, ".claude", "rules", "detail.md"), "# Detail");

      const processor = new RulesProcessor({
        logger,
        outputRoot: literalRoot,
        toolTarget: "claudecode",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete.map((file) => file.getRelativeFilePath()).toSorted()).toEqual([
        "CLAUDE.md",
        "detail.md",
      ]);
    });

    it("should find the local root file from such a root", async () => {
      // `getLocalRootFileGlob` overrides where this one is looked for, so it
      // takes a different path through the processor than the root file above.
      const literalRoot = join(testDir, "project(glob)");
      await writeFileContent(join(literalRoot, ".rovodev", "AGENTS.md"), "# Root");
      await writeFileContent(join(literalRoot, "AGENTS.local.md"), "# Local root");

      const processor = new RulesProcessor({
        logger,
        outputRoot: literalRoot,
        toolTarget: "rovodev",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete.map((file) => file.getRelativeFilePath())).toContain("AGENTS.local.md");
    });

    it("should find nested subproject files from such a root", async () => {
      const literalRoot = join(testDir, "project(glob)");
      await writeFileContent(join(literalRoot, "AGENTS.md"), "# Root");
      await writeFileContent(join(literalRoot, "packages", "api", "AGENTS.md"), "# Nested");

      const processor = new RulesProcessor({
        logger,
        outputRoot: literalRoot,
        toolTarget: "agentsmd",
      });

      const toolFiles = await processor.loadToolFiles();

      expect(toolFiles.map((file) => file.getRelativeDirPath())).toContain(join("packages", "api"));
    });

    // `*` is not a legal filename character on Windows.
    it.skipIf(process.platform === "win32")(
      "should not sweep a sibling project when the root ends in a wildcard",
      async () => {
        // The false-positive side: a root read as a pattern reaches into the
        // sibling `projectOTHERx`. Here the stray path does not survive as far
        // as the deletion list -- `checkPathTraversal` rejects it and the whole
        // scan is discarded -- so the visible damage is that the sweep silently
        // finds nothing, not that it deletes a stranger's file. Either way the
        // root must be a directory, not a pattern.
        const literalRoot = join(testDir, "project*x");
        await writeFileContent(join(literalRoot, "CLAUDE.md"), "# Mine");
        await writeFileContent(
          join(testDir, "projectOTHERx", ".claude", "rules", "theirs.md"),
          "# Theirs",
        );

        const processor = new RulesProcessor({
          logger,
          outputRoot: literalRoot,
          toolTarget: "claudecode",
        });

        const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

        expect(filesToDelete.map((file) => file.getRelativeFilePath())).toEqual(["CLAUDE.md"]);
      },
    );
  });
});
