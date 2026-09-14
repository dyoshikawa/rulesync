import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { TabnineSkill } from "./tabnine-skill.js";

describe("TabnineSkill", () => {
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
    it("should return .tabnine/agent/skills as relativeDirPath by default", () => {
      const paths = TabnineSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".tabnine", "agent", "skills"));
    });

    it("should return same path for global mode (Tabnine uses the same structure)", () => {
      // Tabnine uses ~/.tabnine/agent/skills/ for global and .tabnine/agent/skills/ for project
      // The relative path structure is the same, only the base directory differs
      const projectPaths = TabnineSkill.getSettablePaths({ global: false });
      const globalPaths = TabnineSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".tabnine", "agent", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".tabnine", "agent", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new TabnineSkill({
        outputRoot: testDir,
        relativeDirPath: join(".tabnine", "agent", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(TabnineSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new TabnineSkill({
            outputRoot: testDir,
            relativeDirPath: join(".tabnine", "agent", "skills"),
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
      const skillDir = join(testDir, ".tabnine", "agent", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await TabnineSkill.fromDir({
        outputRoot: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(TabnineSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".tabnine", "agent", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        TabnineSkill.fromDir({
          outputRoot: testDir,
          dirName: "pdf-processing",
        }),
      ).rejects.toThrow(/must match directory name/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: false,
      });

      const tabnineSkill = TabnineSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(tabnineSkill).toBeInstanceOf(TabnineSkill);
      expect(tabnineSkill.getRelativeDirPath()).toBe(join(".tabnine", "agent", "skills"));
      expect(tabnineSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const tabnineSkill = new TabnineSkill({
        outputRoot: testDir,
        relativeDirPath: join(".tabnine", "agent", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = tabnineSkill.toRulesyncSkill();

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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "universal",
        frontmatter: { name: "universal", description: "Universal", targets: ["*"] },
        body: "body",
        validate: false,
      });

      expect(TabnineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'tabnine'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "tabnine-specific",
        frontmatter: { name: "tabnine-specific", description: "Tabnine", targets: ["tabnine"] },
        body: "body",
        validate: false,
      });

      expect(TabnineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when tabnine is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(TabnineSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = TabnineSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".tabnine", "agent", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".tabnine", "agent", "skills"));
    });
  });

  describe("tabnine section round-trip", () => {
    it("should emit license from the tabnine section into the SKILL.md frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["tabnine"],
          tabnine: { license: "MIT", name: "ignored", description: "ignored" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = TabnineSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter() as Record<string, unknown>;

      expect(frontmatter.license).toEqual("MIT");
      // Canonical name/description win over stray same-named section keys.
      expect(frontmatter.name).toBe("deploy");
      expect(frontmatter.description).toBe("Deploy the app");
    });

    it("should lift extra frontmatter keys back into the tabnine section on import", () => {
      const skill = new TabnineSkill({
        outputRoot: testDir,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          license: "MIT",
        } as never,
        body: "Deploy.",
        validate: false,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const frontmatter = rulesyncSkill.getFrontmatter();

      expect(frontmatter.tabnine).toEqual({ license: "MIT" });
      expect(frontmatter.name).toBe("deploy");
    });

    it("should omit the tabnine section when no extra keys exist", () => {
      const skill = new TabnineSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain skill" },
        body: "Body.",
        validate: false,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().tabnine).toBeUndefined();
    });
  });
});
