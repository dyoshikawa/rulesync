import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { DEFAULT_TAKT_RULE_DIR, TaktRule } from "./takt-rule.js";

describe("TaktRule", () => {
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
    it("returns the fixed policies facet path in project mode", () => {
      const paths = TaktRule.getSettablePaths();
      expect("nonRoot" in paths && paths.nonRoot?.relativeDirPath).toBe(
        join(".takt", "facets", DEFAULT_TAKT_RULE_DIR),
      );
      expect(DEFAULT_TAKT_RULE_DIR).toBe("policies");
    });

    it("returns a root path in global mode", () => {
      const paths = TaktRule.getSettablePaths({ global: true });
      expect("root" in paths && paths.root?.relativeDirPath).toBe(
        join(".takt", "facets", DEFAULT_TAKT_RULE_DIR),
      );
    });
  });

  describe("fromRulesyncRule", () => {
    it("emits a plain Markdown body under policies/", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "style.md",
        frontmatter: { targets: ["*"] },
        body: "# Style policy",
      });

      const rule = TaktRule.fromRulesyncRule({ baseDir: testDir, rulesyncRule });

      expect(rule.getRelativeDirPath()).toBe(join(".takt", "facets", "policies"));
      expect(rule.getRelativeFilePath()).toBe("style.md");
      expect(rule.getFileContent()).toBe("# Style policy");
    });

    it("renames the emitted stem with takt.name", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "long-source-name.md",
        frontmatter: {
          targets: ["*"],
          ...({ takt: { name: "short" } } as Record<string, unknown>),
        },
        body: "# Body",
      });

      const rule = TaktRule.fromRulesyncRule({ baseDir: testDir, rulesyncRule });
      expect(rule.getRelativeDirPath()).toBe(join(".takt", "facets", "policies"));
      expect(rule.getRelativeFilePath()).toBe("short.md");
    });

    it("throws on an unsafe takt.name value", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "src.md",
        frontmatter: {
          targets: ["*"],
          ...({ takt: { name: "../escape" } } as Record<string, unknown>),
        },
        body: "x",
      });
      expect(() => TaktRule.fromRulesyncRule({ baseDir: testDir, rulesyncRule })).toThrow(
        /Invalid takt\.name/,
      );
    });
  });

  describe("fromFile", () => {
    it("loads a plain Markdown facet file", async () => {
      const facetDir = join(testDir, ".takt", "facets", "policies");
      await ensureDir(facetDir);
      await writeFileContent(join(facetDir, "x.md"), "Hello body\n");

      const rule = await TaktRule.fromFile({ baseDir: testDir, relativeFilePath: "x.md" });
      expect(rule.getFileContent()).toBe("Hello body");
    });
  });

  describe("forDeletion", () => {
    it("constructs a deletable instance without reading the file", () => {
      const rule = TaktRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".takt", "facets", "policies"),
        relativeFilePath: "x.md",
      });
      expect(rule.getFileContent()).toBe("");
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("returns true when targets includes takt", () => {
      const r = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "t.md",
        frontmatter: { targets: ["takt"] },
        body: "x",
      });
      expect(TaktRule.isTargetedByRulesyncRule(r)).toBe(true);
    });

    it("returns true on wildcard targets", () => {
      const r = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "t.md",
        frontmatter: { targets: ["*"] },
        body: "x",
      });
      expect(TaktRule.isTargetedByRulesyncRule(r)).toBe(true);
    });

    it("returns false when targets excludes takt", () => {
      const r = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "t.md",
        frontmatter: { targets: ["claudecode"] },
        body: "x",
      });
      expect(TaktRule.isTargetedByRulesyncRule(r)).toBe(false);
    });
  });
});
