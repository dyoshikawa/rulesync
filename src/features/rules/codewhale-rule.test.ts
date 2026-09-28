import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleRule } from "./codewhale-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

const buildRule = ({
  targets,
  root = false,
  body = "# Test",
  relativeFilePath = "test.md",
}: {
  targets: string[];
  root?: boolean;
  body?: string;
  relativeFilePath?: string;
}): RulesyncRule =>
  new RulesyncRule({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: {
      root,
      targets: targets as any,
      globs: [],
    },
    body,
    validate: false,
  });

describe("CodewhaleRule", () => {
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
    it("should return the root AGENTS.md and .codewhale/rules for project scope", () => {
      const paths = CodewhaleRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect("nonRoot" in paths && paths.nonRoot?.relativeDirPath).toBe(
        join(".codewhale", "rules"),
      );
    });

    it("should return ~/.codewhale/AGENTS.md without a nonRoot location for global scope", () => {
      const paths = CodewhaleRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(".codewhale");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect("nonRoot" in paths ? paths.nonRoot : undefined).toBeUndefined();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write a root rule to the workspace AGENTS.md", () => {
      const rule = CodewhaleRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRule({ targets: ["codewhale"], root: true, body: "# Root" }),
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Root");
    });

    it("should write a non-root rule to .codewhale/rules", () => {
      const rule = CodewhaleRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRule({
          targets: ["*"],
          relativeFilePath: "style.md",
          body: "# Style",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(join(".codewhale", "rules"));
      expect(rule.getRelativeFilePath()).toBe("style.md");
      expect(rule.getFileContent()).toContain("# Style");
    });

    it("should write every global rule to ~/.codewhale/AGENTS.md", () => {
      const rule = CodewhaleRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRule({ targets: ["codewhale"], body: "# Global" }),
        global: true,
      });

      expect(rule.getRelativeDirPath()).toBe(".codewhale");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Global");
    });
  });

  describe("fromFile", () => {
    it("should read the root AGENTS.md as the root rule", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root content");

      const rule = await CodewhaleRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("# Root content");
    });

    it("should treat .codewhale/rules/AGENTS.md as an ordinary non-root rule", async () => {
      await writeFileContent(join(testDir, ".codewhale", "rules", "AGENTS.md"), "# Nested");

      const rule = await CodewhaleRule.fromFile({
        outputRoot: testDir,
        relativeDirPath: join(".codewhale", "rules"),
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
      expect(rule.getRelativeDirPath()).toBe(join(".codewhale", "rules"));
      expect(rule.getFileContent()).toBe("# Nested");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert a non-root rule back to a rulesync rule", async () => {
      await writeFileContent(join(testDir, ".codewhale", "rules", "style.md"), "# Style");
      const rule = await CodewhaleRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "style.md",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getBody()).toBe("# Style");
      expect(rulesyncRule.getFrontmatter().root).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should mark only the workspace AGENTS.md as root", () => {
      expect(
        CodewhaleRule.forDeletion({
          outputRoot: testDir,
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
        }).isRoot(),
      ).toBe(true);
      expect(
        CodewhaleRule.forDeletion({
          outputRoot: testDir,
          relativeDirPath: join(".codewhale", "rules"),
          relativeFilePath: "AGENTS.md",
        }).isRoot(),
      ).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should honor the codewhale target and the wildcard", () => {
      expect(CodewhaleRule.isTargetedByRulesyncRule(buildRule({ targets: ["codewhale"] }))).toBe(
        true,
      );
      expect(CodewhaleRule.isTargetedByRulesyncRule(buildRule({ targets: ["*"] }))).toBe(true);
      expect(CodewhaleRule.isTargetedByRulesyncRule(buildRule({ targets: ["cursor"] }))).toBe(
        false,
      );
    });
  });
});
