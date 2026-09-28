import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodewhaleSkill } from "./codewhale-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CodewhaleSkill", () => {
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
    it("should return .codewhale/skills for both scopes", () => {
      expect(CodewhaleSkill.getSettablePaths().relativeDirPath).toBe(join(".codewhale", "skills"));
      expect(CodewhaleSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".codewhale", "skills"),
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should write name, description and the codewhale section into the frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: {
          name: "review",
          description: "Review code",
          targets: ["*"],
          codewhale: { invocation: "manual", name: "ignored" },
        },
        body: "Review the diff.",
        validate: true,
      });

      const skill = CodewhaleSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getRelativeDirPath()).toBe(join(".codewhale", "skills"));
      expect(skill.getDirName()).toBe("review");
      expect(skill.getFrontmatter()).toEqual({
        name: "review",
        description: "Review code",
        invocation: "manual",
      });
      expect(skill.getBody()).toBe("Review the diff.");
    });
  });

  describe("fromDir and toRulesyncSkill", () => {
    it("should lift Codewhale-specific keys into the codewhale section", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "skills", "review", SKILL_FILE_NAME),
        "---\nname: review\ndescription: Review code\ninvocation: manual\n---\nReview the diff.\n",
      );

      const skill = await CodewhaleSkill.fromDir({ outputRoot: testDir, dirName: "review" });
      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toMatchObject({
        name: "review",
        description: "Review code",
        targets: ["*"],
        codewhale: { invocation: "manual" },
      });
      expect(rulesyncSkill.getBody().trim()).toBe("Review the diff.");
    });

    it("should reject a SKILL.md without a description", async () => {
      await writeFileContent(
        join(testDir, ".codewhale", "skills", "broken", SKILL_FILE_NAME),
        "---\nname: broken\n---\nBody\n",
      );

      await expect(
        CodewhaleSkill.fromDir({ outputRoot: testDir, dirName: "broken" }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should honor the codewhale target and the wildcard", () => {
      const build = (targets: string[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets: targets as any },
          body: "",
          validate: false,
        });

      expect(CodewhaleSkill.isTargetedByRulesyncSkill(build(["codewhale"]))).toBe(true);
      expect(CodewhaleSkill.isTargetedByRulesyncSkill(build(["*"]))).toBe(true);
      expect(CodewhaleSkill.isTargetedByRulesyncSkill(build(["cursor"]))).toBe(false);
    });
  });
});
