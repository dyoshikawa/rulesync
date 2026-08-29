import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { FactorydroidCheck } from "./factorydroid-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

const GUIDELINES_DIR = join(".factory", "skills", "review-guidelines");

const checkOf = ({
  name,
  body,
  description,
}: {
  name: string;
  body: string;
  description?: string;
}): RulesyncCheck =>
  new RulesyncCheck({
    outputRoot: ".",
    relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], ...(description !== undefined && { description }) },
    body,
  });

describe("FactorydroidCheck", () => {
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

  const writeGuidelines = async (content: string): Promise<void> => {
    await ensureDir(join(testDir, GUIDELINES_DIR));
    await writeFileContent(join(testDir, GUIDELINES_DIR, SKILL_FILE_NAME), content);
  };

  describe("getSettablePaths", () => {
    it("should point at the review-guidelines skill in both scopes", () => {
      expect(FactorydroidCheck.getSettablePaths()).toEqual({
        relativeDirPath: GUIDELINES_DIR,
        relativeFilePath: SKILL_FILE_NAME,
      });
      expect(FactorydroidCheck.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: GUIDELINES_DIR,
        relativeFilePath: SKILL_FILE_NAME,
      });
    });
  });

  describe("fromRulesyncChecks", () => {
    it("should aggregate every check into one frontmatter-free file", async () => {
      const [check] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [
          checkOf({ name: "hooks-rules", body: "Flag React hooks rules violations." }),
          checkOf({ name: "public-types", body: "Flag missing types on public APIs." }),
        ],
      });

      const content = check!.getFileContent();
      // Factory's documented example is plain Markdown; frontmatter here would
      // also read back as a hand-written preamble.
      expect(content).not.toMatch(/^---/);
      expect(content).toContain("<!-- rulesync:check:hooks-rules -->");
      expect(content).toContain("## hooks-rules");
      expect(content).toContain("Flag React hooks rules violations.");
      expect(content).toContain("Flag missing types on public APIs.");
      expect(check!.getRelativeDirPath()).toBe(GUIDELINES_DIR);
      expect(check!.getRelativeFilePath()).toBe(SKILL_FILE_NAME);
    });

    it("should fall back to the description when a check has no body", async () => {
      const [check] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "typing", body: "", description: "No any." })],
      });

      expect(check!.getFileContent()).toContain("No any.");
    });

    it("should write nothing when no check targets Factory Droid", async () => {
      expect(
        await FactorydroidCheck.fromRulesyncChecks({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
          rulesyncChecks: [],
        }),
      ).toEqual([]);
    });

    it("should warn before replacing a hand-authored review-guidelines skill", async () => {
      await writeGuidelines("---\nname: review-guidelines\n---\n\nOur own guidelines.\n");
      const logger = createMockLogger();

      await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "hooks-rules", body: "Flag hooks violations." })],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("rulesync did not write"));
    });

    it("should stay quiet when the existing file is only generated sections", async () => {
      const [generated] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "hooks-rules", body: "Flag hooks violations." })],
      });
      await writeGuidelines(generated!.getFileContent());
      const logger = createMockLogger();

      await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "hooks-rules", body: "Flag hooks violations." })],
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("canDeleteAuxiliaryFiles", () => {
    it("should allow deletion when the file does not exist", async () => {
      expect(await FactorydroidCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    });

    it("should refuse deletion when a user authored the skill by hand", async () => {
      await writeGuidelines("Our own guidelines.\n");

      expect(await FactorydroidCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
    });

    it("should allow deletion when the file is only generated sections", async () => {
      const [generated] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "hooks-rules", body: "Flag hooks violations." })],
      });
      await writeGuidelines(generated!.getFileContent());

      expect(await FactorydroidCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    });
  });

  describe("toRulesyncChecks", () => {
    it("should split generated sections back into one check each", async () => {
      const [generated] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [
          checkOf({ name: "hooks-rules", body: "Flag React hooks rules violations." }),
          checkOf({ name: "public-types", body: "Flag missing types on public APIs." }),
        ],
      });
      await writeGuidelines(generated!.getFileContent());

      const imported = (
        await FactorydroidCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: SKILL_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported.map((check) => check.getRelativeFilePath())).toEqual([
        "hooks-rules.md",
        "public-types.md",
      ]);
      expect(imported[0]!.getBody()).toBe("Flag React hooks rules violations.");
      expect(imported[0]!.getFrontmatter().targets).toEqual(["*"]);
    });

    it("should import a hand-written skill as a single review-guidelines check", async () => {
      await writeGuidelines("Additional checks for this codebase:\n- Prisma query performance\n");

      const imported = (
        await FactorydroidCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: SKILL_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported).toHaveLength(1);
      expect(imported[0]!.getRelativeFilePath()).toBe("review-guidelines.md");
      expect(imported[0]!.getBody()).toContain("Prisma query performance");
    });

    it("should drop a hand-authored skill's frontmatter", async () => {
      await writeGuidelines(
        "---\nname: review-guidelines\nseverity: bogus\n---\n\nCheck Prisma queries.\n",
      );

      const imported = (
        await FactorydroidCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: SKILL_FILE_NAME,
        })
      ).toRulesyncChecks();

      // Skill metadata is not review prose, and `severity: bogus` would fail
      // the checks schema on the very file rulesync had just written.
      expect(imported).toHaveLength(1);
      expect(imported[0]!.getBody()).toBe("Check Prisma queries.");
      expect(imported[0]!.getFrontmatter()).toEqual({ targets: ["*"] });
    });

    it("should drop a frontmatter block whose YAML does not parse", async () => {
      await writeGuidelines("---\nname: [unclosed\n---\n\nCheck Prisma queries.\n");

      const imported = (
        await FactorydroidCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: SKILL_FILE_NAME,
        })
      ).toRulesyncChecks();

      // Writing the check back out re-parses whatever leads the body, so a
      // block left in place would make the import throw.
      expect(imported[0]!.getBody()).toBe("Check Prisma queries.");
    });

    it("should round-trip a body that contains a marker line", async () => {
      const body = "Example:\n\n<!-- rulesync:check:example -->";
      const [generated] = await FactorydroidCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "docs", body })],
      });
      await writeGuidelines(generated!.getFileContent());

      const imported = (
        await FactorydroidCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: SKILL_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported).toHaveLength(1);
      expect(imported[0]!.getBody()).toBe(body);
    });

    it("should throw from toRulesyncCheck when the file is empty", async () => {
      const check = await FactorydroidCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: SKILL_FILE_NAME,
      });

      expect(() => check.toRulesyncCheck()).toThrow(/No check instructions found/);
    });
  });

  describe("isTargetedByRulesyncCheck", () => {
    it("should respect the targets list", () => {
      const targeted = new RulesyncCheck({
        outputRoot: ".",
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["factorydroid"] },
        body: "b",
      });
      const notTargeted = new RulesyncCheck({
        outputRoot: ".",
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { targets: ["cursor"] },
        body: "b",
      });

      expect(FactorydroidCheck.isTargetedByRulesyncCheck(targeted)).toBe(true);
      expect(FactorydroidCheck.isTargetedByRulesyncCheck(notTargeted)).toBe(false);
    });
  });

  describe("fromRulesyncCheck", () => {
    it("should refuse per-check conversion", () => {
      expect(() =>
        FactorydroidCheck.fromRulesyncCheck({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
          rulesyncCheck: checkOf({ name: "a", body: "b" }),
        }),
      ).toThrow(/fromRulesyncChecks/);
    });
  });

  describe("forDeletion", () => {
    it("should build an empty instance at the given path", () => {
      const check = FactorydroidCheck.forDeletion({
        outputRoot: testDir,
        relativeDirPath: GUIDELINES_DIR,
        relativeFilePath: SKILL_FILE_NAME,
      });

      expect(check.getFileContent()).toBe("");
      expect(check.validate()).toEqual({ success: true, error: null });
    });
  });
});
