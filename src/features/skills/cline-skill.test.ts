import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClineSkill } from "./cline-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("ClineSkill", () => {
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
    it("should return .cline/skills as relativeDirPath by default", () => {
      const paths = ClineSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".cline", "skills"));
    });

    it("should return same path for global mode (Cline Code uses same structure)", () => {
      // Cline Code uses ~/.cline/skills/ for global and .cline/skills/ for project
      // The relative path structure is the same, only the base directory differs
      const projectPaths = ClineSkill.getSettablePaths({ global: false });
      const globalPaths = ClineSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".cline", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".cline", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new ClineSkill({
        baseDir: testDir,
        relativeDirPath: join(".cline", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(ClineSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new ClineSkill({
            baseDir: testDir,
            relativeDirPath: join(".cline", "skills"),
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
      const skillDir = join(testDir, ".cline", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await ClineSkill.fromDir({
        baseDir: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(ClineSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".cline", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        ClineSkill.fromDir({
          baseDir: testDir,
          dirName: "pdf-processing",
        }),
      ).rejects.toThrow(/must match directory name/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
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

      const clineSkill = ClineSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(clineSkill).toBeInstanceOf(ClineSkill);
      expect(clineSkill.getRelativeDirPath()).toBe(join(".cline", "skills"));
      expect(clineSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const clineSkill = new ClineSkill({
        baseDir: testDir,
        relativeDirPath: join(".cline", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = clineSkill.toRulesyncSkill();

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

      expect(ClineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'cline'", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "cline-specific",
        frontmatter: { name: "cline-specific", description: "Cline", targets: ["cline"] },
        body: "body",
        validate: false,
      });

      expect(ClineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when cline is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(ClineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = ClineSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".cline", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".cline", "skills"));
    });
  });
});
