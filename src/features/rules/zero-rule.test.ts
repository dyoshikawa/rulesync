import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ZeroRule } from "./zero-rule.js";

function makeRulesyncRule({ root, body }: { root: boolean; body: string }): RulesyncRule {
  return new RulesyncRule({
    outputRoot: "/mock",
    relativeDirPath: "rules",
    relativeFilePath: root ? "overview.md" : "topic.md",
    frontmatter: { root, targets: ["*"], description: "", globs: [] },
    body,
    validate: false,
  });
}

describe("ZeroRule", () => {
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
    it("should use the project-root ZERO.md in project scope", () => {
      const paths = ZeroRule.getSettablePaths();
      expect(paths.root).toEqual({ relativeDirPath: ".", relativeFilePath: "ZERO.md" });
      expect(paths.nonRoot).toBeUndefined();
    });

    it.each([
      ["linux", join(".config", "zero")],
      ["darwin", join(".config", "zero")],
      ["win32", join("AppData", "Roaming", "zero")],
    ] as const)("should use the %s user config dir in global scope", (platform, expected) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(ZeroRule.getSettablePaths({ global: true }).root).toEqual({
        relativeDirPath: expected,
        relativeFilePath: "ZERO.md",
      });
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write the root rule body to ZERO.md", () => {
      const rule = ZeroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ root: true, body: "Use make." }),
      });
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("ZERO.md");
      expect(rule.getFileContent()).toBe("Use make.");
      expect(rule.isRoot()).toBe(true);
    });

    it("should write the global rule to the user config dir", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      const rule = ZeroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ root: true, body: "Personal." }),
        global: true,
      });
      expect(rule.getRelativeDirPath()).toBe(join(".config", "zero"));
      expect(rule.getRelativeFilePath()).toBe("ZERO.md");
    });

    it("should target the root file for a non-root rule (folded by the processor)", () => {
      const rule = ZeroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ root: false, body: "Topic." }),
      });
      expect(rule.getRelativeFilePath()).toBe("ZERO.md");
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should import ZERO.md as the root rule", async () => {
      await writeFileContent(join(testDir, "ZERO.md"), "# Zero rules");
      const rule = await ZeroRule.fromFile({ outputRoot: testDir, relativeFilePath: "ZERO.md" });
      expect(rule.getFileContent()).toBe("# Zero rules");
      expect(rule.isRoot()).toBe(true);
      expect(rule.toRulesyncRule().getBody()).toBe("# Zero rules");
    });
  });

  describe("getGenerationWarnings", () => {
    const toolRules = (): ZeroRule[] => [
      ZeroRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: makeRulesyncRule({ root: true, body: "Use make." }),
      }),
    ];

    it("should warn when an AGENTS.md shadows the generated ZERO.md", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Shared");
      const warnings = await ZeroRule.getGenerationWarnings({
        toolRules: toolRules(),
        outputRoot: testDir,
        global: false,
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("AGENTS.md exists next to ZERO.md");
    });

    it("should not warn without an AGENTS.md", async () => {
      const warnings = await ZeroRule.getGenerationWarnings({
        toolRules: toolRules(),
        outputRoot: testDir,
        global: false,
      });
      expect(warnings).toEqual([]);
    });

    it("should not warn in global mode", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Shared");
      const warnings = await ZeroRule.getGenerationWarnings({
        toolRules: toolRules(),
        outputRoot: testDir,
        global: true,
      });
      expect(warnings).toEqual([]);
    });
  });

  describe("forDeletion", () => {
    it("should mark the root ZERO.md as the root file", () => {
      const rule = ZeroRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "ZERO.md",
      });
      expect(rule.isRoot()).toBe(true);
    });
  });
});
