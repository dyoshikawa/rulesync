import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CortexcodeRule } from "./cortexcode-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

const buildRule = ({
  targets,
  root = false,
  body = "# Test",
}: {
  targets: string[];
  root?: boolean;
  body?: string;
}): RulesyncRule =>
  new RulesyncRule({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "test.md",
    frontmatter: {
      root,
      targets: targets as any,
      globs: [],
    },
    body,
    validate: false,
  });

describe("CortexcodeRule", () => {
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
    it("should return the root AGENTS.md and no nonRoot location", () => {
      const paths = CortexcodeRule.getSettablePaths();

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
      expect(paths.nonRoot).toBeUndefined();
    });

    it("should keep the same project-root path when global is requested", () => {
      const paths = CortexcodeRule.getSettablePaths({ global: true });

      expect(paths.root.relativeDirPath).toBe(".");
      expect(paths.root.relativeFilePath).toBe("AGENTS.md");
    });
  });

  describe("fromFile", () => {
    it("should load the root rule from AGENTS.md", async () => {
      const content = "# Project Instructions\n\n- Use TypeScript";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await CortexcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should read the root AGENTS.md even when given a non-root relativeFilePath", async () => {
      const content = "# Root";
      await writeFileContent(join(testDir, "AGENTS.md"), content);

      const rule = await CortexcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "error-handling.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });

    it("should throw when AGENTS.md does not exist", async () => {
      await expect(
        CortexcodeRule.fromFile({ outputRoot: testDir, relativeFilePath: "AGENTS.md" }),
      ).rejects.toThrow();
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write a root rule to AGENTS.md at the project root", () => {
      const rule = CortexcodeRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRule({ targets: ["cortexcode"], root: true, body: "# Root body" }),
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("# Root body");
      expect(rule.isRoot()).toBe(true);
    });

    it("should map a non-root rule onto the same root file so the processor can fold it", () => {
      const rule = CortexcodeRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRule({ targets: ["cortexcode"], root: false, body: "topic body" }),
      });

      expect(rule.getRelativeDirPath()).toBe(".");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("topic body");
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert back to a root rulesync rule", async () => {
      await writeFileContent(join(testDir, "AGENTS.md"), "# Root");
      const rule = await CortexcodeRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().root).toBe(true);
      expect(rulesyncRule.getBody()).toBe("# Root");
      // The root rule is imported under the canonical overview.md name.
      expect(rulesyncRule.getRelativeFilePath()).toBe("overview.md");
    });
  });

  describe("forDeletion", () => {
    it("should mark the root AGENTS.md as root", () => {
      const rule = CortexcodeRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
      expect(rule.getFileContent()).toBe("");
    });

    it("should not mark another file as root", () => {
      const rule = CortexcodeRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "OTHER.md",
      });

      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should be targeted by cortexcode and the wildcard", () => {
      expect(CortexcodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["cortexcode"] }))).toBe(
        true,
      );
      expect(CortexcodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["*"] }))).toBe(true);
    });

    it("should not be targeted by other tools", () => {
      expect(CortexcodeRule.isTargetedByRulesyncRule(buildRule({ targets: ["claudecode"] }))).toBe(
        false,
      );
    });
  });
});
