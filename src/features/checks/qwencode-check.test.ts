import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QWENCODE_REVIEW_RULES_FILE_NAME } from "../../constants/qwencode-paths.js";
import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { QwencodeCheck } from "./qwencode-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

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

describe("QwencodeCheck", () => {
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
    it("should point at review-rules.md in the .qwen directory", () => {
      expect(QwencodeCheck.getSettablePaths()).toEqual({
        relativeDirPath: ".qwen",
        relativeFilePath: "review-rules.md",
      });
    });
  });

  describe("fromRulesyncChecks", () => {
    it("should aggregate every check into one frontmatter-free file", async () => {
      const [check] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [
          checkOf({ name: "no-console", body: "Flag console.log calls." }),
          checkOf({ name: "naming", body: "Enforce kebab-case file names." }),
        ],
      });

      const content = check!.getFileContent();
      expect(content).not.toMatch(/^---/);
      expect(content).toContain("<!-- rulesync:check:no-console -->");
      expect(content).toContain("## no-console");
      expect(content).toContain("Flag console.log calls.");
      expect(content).toContain("Enforce kebab-case file names.");
      expect(check!.getRelativeFilePath()).toBe("review-rules.md");
    });

    it("should fall back to the description when a check has no body", async () => {
      const [check] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "typing", body: "", description: "No any." })],
      });

      expect(check!.getFileContent()).toContain("No any.");
    });

    it("should write nothing when no check targets Qwen Code", async () => {
      const checks = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [],
      });

      expect(checks).toEqual([]);
    });

    it("should warn before replacing hand-written instructions", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        "Hand-written review notes.\n",
      );
      const logger = createMockLogger();

      await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "no-console", body: "Flag console.log calls." })],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("rulesync did not write"));
      // The tool's own name and target come from this adapter's config rather
      // than from a literal in the message, so the message is read back whole.
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Qwen Code checks:"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("--targets qwencode"));
    });

    it("should stay quiet when the existing file is only generated sections", async () => {
      const [generated] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "no-console", body: "Flag console.log calls." })],
      });
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        generated!.getFileContent(),
      );
      const logger = createMockLogger();

      await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "no-console", body: "Flag console.log calls." })],
        logger,
      });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("canDeleteAuxiliaryFiles", () => {
    it("should allow deletion when the file does not exist", async () => {
      expect(await QwencodeCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    });

    it("should refuse deletion when the file holds hand-written instructions", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        "Hand-written review notes.\n",
      );

      expect(await QwencodeCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
    });

    it("should allow deletion when the file is only generated sections", async () => {
      const [generated] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "no-console", body: "Flag console.log calls." })],
      });
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        generated!.getFileContent(),
      );

      expect(await QwencodeCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    });
  });

  describe("toRulesyncChecks", () => {
    it("should split generated sections back into one check each", async () => {
      const [generated] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [
          checkOf({ name: "no-console", body: "Flag console.log calls." }),
          checkOf({ name: "naming", body: "Enforce kebab-case file names." }),
        ],
      });
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        generated!.getFileContent(),
      );

      const imported = (
        await QwencodeCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: QWENCODE_REVIEW_RULES_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported.map((check) => check.getRelativeFilePath())).toEqual([
        "no-console.md",
        "naming.md",
      ]);
      expect(imported[0]!.getBody()).toBe("Flag console.log calls.");
      expect(imported[0]!.getFrontmatter().targets).toEqual(["*"]);
    });

    it("should import a hand-written file as a single review-rules check", async () => {
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        "Prefer small functions.\n",
      );

      const imported = (
        await QwencodeCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: QWENCODE_REVIEW_RULES_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported).toHaveLength(1);
      expect(imported[0]!.getRelativeFilePath()).toBe("review-rules.md");
      expect(imported[0]!.getBody()).toBe("Prefer small functions.");
    });

    it("should round-trip a body that contains a marker line", async () => {
      const body = "Example:\n\n<!-- rulesync:check:example -->";
      const [generated] = await QwencodeCheck.fromRulesyncChecks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        rulesyncChecks: [checkOf({ name: "docs", body })],
      });
      await ensureDir(join(testDir, ".qwen"));
      await writeFileContent(
        join(testDir, ".qwen", "review-rules.md"),
        generated!.getFileContent(),
      );

      const imported = (
        await QwencodeCheck.fromFile({
          outputRoot: testDir,
          relativeFilePath: QWENCODE_REVIEW_RULES_FILE_NAME,
        })
      ).toRulesyncChecks();

      expect(imported).toHaveLength(1);
      expect(imported[0]!.getBody()).toBe(body);
    });
  });

  describe("isTargetedByRulesyncCheck", () => {
    it("should respect the targets list", () => {
      const targeted = new RulesyncCheck({
        outputRoot: ".",
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "a.md",
        frontmatter: { targets: ["qwencode"] },
        body: "b",
      });
      const notTargeted = new RulesyncCheck({
        outputRoot: ".",
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "b.md",
        frontmatter: { targets: ["cursor"] },
        body: "b",
      });

      expect(QwencodeCheck.isTargetedByRulesyncCheck(targeted)).toBe(true);
      expect(QwencodeCheck.isTargetedByRulesyncCheck(notTargeted)).toBe(false);
    });
  });

  describe("fromRulesyncCheck", () => {
    it("should refuse per-check conversion", () => {
      expect(() =>
        QwencodeCheck.fromRulesyncCheck({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
          rulesyncCheck: checkOf({ name: "a", body: "b" }),
        }),
      ).toThrow(/fromRulesyncChecks/);
    });
  });
});
