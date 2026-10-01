import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { CodebuddySkill } from "./codebuddy-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

const skillsDir = join(".codebuddy", "skills");

describe("CodebuddySkill", () => {
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
    it("should return .codebuddy/skills for both scopes", () => {
      expect(CodebuddySkill.getSettablePaths().relativeDirPath).toBe(skillsDir);
      expect(CodebuddySkill.getSettablePaths({ global: true }).relativeDirPath).toBe(skillsDir);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should write name, description and the codebuddy section into the frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "pdf",
        frontmatter: {
          name: "pdf",
          description: "PDF expert",
          targets: ["*"],
          codebuddy: {
            "allowed-tools": "Read, Write, Bash",
            context: "fork",
            name: "ignored",
            description: "Ignored description",
          },
        },
        body: "Process PDFs.",
        validate: true,
      });

      const skill = CodebuddySkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getRelativeDirPath()).toBe(skillsDir);
      expect(skill.getDirName()).toBe("pdf");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf",
        description: "PDF expert",
        "allowed-tools": "Read, Write, Bash",
        context: "fork",
      });
      expect(skill.getBody()).toBe("Process PDFs.");
    });

    it("should apply the shared invocation flags unless the section overrides them", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "hidden",
        frontmatter: {
          name: "hidden",
          description: "Hidden skill",
          targets: ["codebuddy"],
          "disable-model-invocation": true,
          "user-invocable": true,
          codebuddy: { "user-invocable": false },
        },
        body: "Body",
        validate: true,
      });

      const skill = CodebuddySkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).toEqual({
        name: "hidden",
        description: "Hidden skill",
        "disable-model-invocation": true,
        "user-invocable": false,
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should lift CodeBuddy-specific keys into the codebuddy section", () => {
      const skill = new CodebuddySkill({
        outputRoot: testDir,
        dirName: "pdf",
        frontmatter: {
          name: "pdf",
          description: "PDF expert",
          "allowed-tools": "Read",
          "disable-model-invocation": true,
        },
        body: "Body",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "pdf",
        description: "PDF expert",
        targets: ["*"],
        codebuddy: { "allowed-tools": "Read", "disable-model-invocation": true },
      });
      expect(rulesyncSkill.getRelativeDirPath()).toBe(RULESYNC_SKILLS_RELATIVE_DIR_PATH);
    });

    it("should default name to the directory name and description to an empty string", () => {
      const skill = new CodebuddySkill({
        outputRoot: testDir,
        dirName: "bare",
        frontmatter: {},
        body: "Body",
      });

      expect(skill.toRulesyncSkill().getFrontmatter()).toEqual({
        name: "bare",
        description: "",
        targets: ["*"],
      });
    });
  });

  describe("fromDir", () => {
    it("should load a SKILL.md without frontmatter fields", async () => {
      await writeFileContent(
        join(testDir, skillsDir, "bare", SKILL_FILE_NAME),
        "---\nallowed-tools: Read, Grep\n---\nDo things.\n",
      );

      const skill = await CodebuddySkill.fromDir({ outputRoot: testDir, dirName: "bare" });

      expect(skill.getFrontmatter()).toEqual({ "allowed-tools": "Read, Grep" });
      expect(skill.getBody()).toBe("Do things.");
      expect(skill.toRulesyncSkill().getFrontmatter().name).toBe("bare");
    });

    it("should reject a non-boolean invocation flag", async () => {
      await writeFileContent(
        join(testDir, skillsDir, "bad", SKILL_FILE_NAME),
        "---\nname: bad\nuser-invocable: nope\n---\nBody\n",
      );

      await expect(CodebuddySkill.fromDir({ outputRoot: testDir, dirName: "bad" })).rejects.toThrow(
        /Invalid frontmatter/,
      );
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should match wildcard and codebuddy targets only", () => {
      const build = (targets: ("*" | "codebuddy" | "cursor")[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets },
          body: "",
        });

      expect(CodebuddySkill.isTargetedByRulesyncSkill(build(["*"]))).toBe(true);
      expect(CodebuddySkill.isTargetedByRulesyncSkill(build(["codebuddy"]))).toBe(true);
      expect(CodebuddySkill.isTargetedByRulesyncSkill(build(["cursor"]))).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should build an unvalidated placeholder", () => {
      const skill = CodebuddySkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: skillsDir,
        dirName: "old",
      });

      expect(skill.getDirName()).toBe("old");
      expect(skill.getRelativeDirPath()).toBe(skillsDir);
    });
  });
});
