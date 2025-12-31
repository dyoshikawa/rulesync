import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RooSkill } from "./roo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("RooSkill", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("getSettablePaths", () => {
    it("should return .roo/skills as relativeDirPath by default", () => {
      const paths = RooSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".roo", "skills"));
    });

    it("should allow mode specific skills directory", () => {
      const paths = RooSkill.getSettablePaths({ modeSlug: "code" });
      expect(paths.relativeDirPath).toBe(join(".roo", "skills-code"));
    });

    it("should return same path for global mode (Roo Code uses same structure)", () => {
      // Roo Code uses ~/.roo/skills/ for global and .roo/skills/ for project
      // The relative path structure is the same, only the base directory differs
      const projectPaths = RooSkill.getSettablePaths({ global: false });
      const globalPaths = RooSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".roo", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".roo", "skills"));
    });

    it("should return same path for global mode with modeSlug", () => {
      const projectPaths = RooSkill.getSettablePaths({ global: false, modeSlug: "code" });
      const globalPaths = RooSkill.getSettablePaths({ global: true, modeSlug: "code" });
      expect(projectPaths.relativeDirPath).toBe(join(".roo", "skills-code"));
      expect(globalPaths.relativeDirPath).toBe(join(".roo", "skills-code"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new RooSkill({
        baseDir: testDir,
        relativeDirPath: join(".roo", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(RooSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new RooSkill({
            baseDir: testDir,
            relativeDirPath: join(".roo", "skills"),
            dirName: "pdf-processing",
            frontmatter: { name: "pdf", description: "desc" },
            body: "content",
            validate: true,
          }),
      ).toThrow(/frontmatter name/);
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".roo", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await RooSkill.fromDir({
        baseDir: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(RooSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".roo", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        RooSkill.fromDir({
          baseDir: testDir,
          dirName: "pdf-processing",
        }),
      ).rejects.toThrow(/must match directory name/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill with modeSlug path", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: false,
      });

      const rooSkill = RooSkill.fromRulesyncSkill({
        rulesyncSkill,
        modeSlug: "code",
      });

      expect(rooSkill).toBeInstanceOf(RooSkill);
      expect(rooSkill.getRelativeDirPath()).toBe(join(".roo", "skills-code"));
      expect(rooSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const rooSkill = new RooSkill({
        baseDir: testDir,
        relativeDirPath: join(".roo", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = rooSkill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Handle PDFs",
        targets: ["*"],
      });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "universal",
        frontmatter: { name: "universal", description: "Universal", targets: ["*"] },
        body: "body",
        validate: false,
      });

      expect(RooSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'roo'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "roo-specific",
        frontmatter: { name: "roo-specific", description: "Roo", targets: ["roo"] },
        body: "body",
        validate: false,
      });

      expect(RooSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when roo is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(RooSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = RooSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".roo", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".roo", "skills"));
    });

    it("should use mode specific path when provided", () => {
      const skill = RooSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".roo", "skills"),
        modeSlug: "code",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".roo", "skills-code"));
    });
  });
});
