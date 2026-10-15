import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { KimiCodeSkill } from "./kimi-code-skill.js";

describe("KimiCodeSkill", () => {
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

  describe("fromFlatFile", () => {
    it("should create instance from a flat skill file", async () => {
      const relativeDirPath = join(".kimi", "skills");
      await writeFileContent(
        join(testDir, relativeDirPath, "review.md"),
        ["---", "name: review", "description: Reviews a diff", "---", "", "Body."].join("\n"),
      );

      const skill = await KimiCodeSkill.fromFlatFile({
        outputRoot: testDir,
        relativeDirPath,
        relativeFilePath: "review.md",
      });

      expect(skill.getFrontmatter()).toEqual({ name: "review", description: "Reviews a diff" });
      expect(skill.getBody()).toBe("Body.");
    });

    it("should warn about an empty description", async () => {
      // A flat file carries the same diagnostic as a skill directory: an empty
      // description makes the skill invisible to the agent that loads it.
      const relativeDirPath = join(".kimi", "skills");
      await writeFileContent(
        join(testDir, relativeDirPath, "empty.md"),
        ["---", "name: empty", 'description: ""', "---", "", "Body."].join("\n"),
      );
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const skill = await KimiCodeSkill.fromFlatFile({
        outputRoot: testDir,
        relativeDirPath,
        relativeFilePath: "empty.md",
      });

      expect(skill.getBody()).toBe("Body.");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("`description` is required and must not be empty"),
      );
    });

    it("should recover a flat skill file whose description contains an unquoted colon", async () => {
      // Kimi's own parser accepts it, so a strict read would drop a file that
      // its authoring tool considers valid.
      const relativeDirPath = join(".kimi", "skills");
      await writeFileContent(
        join(testDir, relativeDirPath, "pdf.md"),
        [
          "---",
          "name: pdf",
          "description: Use this skill when: the user asks about PDFs",
          "---",
          "",
          "Body.",
        ].join("\n"),
      );
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      const skill = await KimiCodeSkill.fromFlatFile({
        outputRoot: testDir,
        relativeDirPath,
        relativeFilePath: "pdf.md",
      });

      expect(skill.getFrontmatter().description).toBe(
        "Use this skill when: the user asks about PDFs",
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovered malformed YAML frontmatter"),
      );
    });
  });

  describe("isDirOwned", () => {
    const writeCommand = async () => {
      await writeFileContent(
        join(testDir, ".rulesync", "commands", "review-pr.md"),
        "---\ndescription: Review\n---\nReview.",
      );
    };

    it("should disown a Kimi skills directory matching a rulesync command slug (KimiCodeCommand owns it)", async () => {
      await writeCommand();
      const base = { outputRoot: testDir, inputRoots: [join(testDir, ".rulesync")] };

      await expect(
        KimiCodeSkill.isDirOwned({
          ...base,
          relativeDirPath: join(".kimi-code", "skills"),
          dirName: "review-pr",
          global: false,
        }),
      ).resolves.toBe(false);
      await expect(
        KimiCodeSkill.isDirOwned({
          ...base,
          relativeDirPath: join(".kimi-code", "skills"),
          dirName: "a-real-skill",
          global: false,
        }),
      ).resolves.toBe(true);
    });

    it("should keep a same-named skill in the import-only .agents/skills root", async () => {
      await writeCommand();

      await expect(
        KimiCodeSkill.isDirOwned({
          outputRoot: testDir,
          inputRoots: [join(testDir, ".rulesync")],
          relativeDirPath: join(".agents", "skills"),
          dirName: "review-pr",
          global: false,
        }),
      ).resolves.toBe(true);
    });
  });
});
