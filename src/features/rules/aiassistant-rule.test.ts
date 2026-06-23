import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AiassistantRule } from "./aiassistant-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("AiassistantRule", () => {
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

  describe("getSettablePaths", () => {
    it("targets .aiassistant/rules as a flat non-root directory", () => {
      const paths = AiassistantRule.getSettablePaths();
      expect(paths.nonRoot.relativeDirPath).toBe(join(".aiassistant", "rules"));
    });
  });

  describe("fromRulesyncRule", () => {
    it("emits a plain Markdown file (no frontmatter) under .aiassistant/rules", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Coding style",
          globs: ["**/*.kt"],
        },
        body: "# Coding style\n\nUse 4-space indentation.",
      });

      const rule = AiassistantRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(join(".aiassistant", "rules"));
      expect(rule.getRelativeFilePath()).toBe("coding-style.md");
      // Plain Markdown body — no YAML frontmatter is emitted.
      expect(rule.getFileContent()).toBe("# Coding style\n\nUse 4-space indentation.");
      expect(rule.getFileContent()).not.toContain("---");
    });
  });

  describe("fromFile", () => {
    it("reads a flat rule file from .aiassistant/rules", async () => {
      const dir = join(testDir, ".aiassistant", "rules");
      await ensureDir(dir);
      await writeFileContent(join(dir, "overview.md"), "# Overview\n\nProject context.");

      const rule = await AiassistantRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "overview.md",
      });

      expect(rule.getRelativeDirPath()).toBe(join(".aiassistant", "rules"));
      expect(rule.getRelativeFilePath()).toBe("overview.md");
      expect(rule.getFileContent()).toBe("# Overview\n\nProject context.");
    });
  });

  describe("toRulesyncRule round-trip", () => {
    it("carries the body back into a rulesync rule", () => {
      const rule = new AiassistantRule({
        outputRoot: testDir,
        relativeDirPath: join(".aiassistant", "rules"),
        relativeFilePath: "overview.md",
        fileContent: "# Overview\n\nBody content.",
        root: false,
      });

      expect(rule.toRulesyncRule().getBody()).toContain("Body content.");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("matches wildcard and explicit aiassistant targets", () => {
      const wildcard = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { root: false, targets: ["*"], description: "", globs: [] },
        body: "x",
      });
      const explicit = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { root: false, targets: ["aiassistant"], description: "", globs: [] },
        body: "y",
      });
      const other = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "c.md",
        frontmatter: { root: false, targets: ["cursor"], description: "", globs: [] },
        body: "z",
      });

      expect(AiassistantRule.isTargetedByRulesyncRule(wildcard)).toBe(true);
      expect(AiassistantRule.isTargetedByRulesyncRule(explicit)).toBe(true);
      expect(AiassistantRule.isTargetedByRulesyncRule(other)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("returns an empty instance", () => {
      const rule = AiassistantRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".aiassistant", "rules"),
        relativeFilePath: "overview.md",
      });
      expect(rule).toBeInstanceOf(AiassistantRule);
      expect(rule.getFileContent()).toBe("");
    });
  });
});
