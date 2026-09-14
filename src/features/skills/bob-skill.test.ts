import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { BobSkill } from "./bob-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("BobSkill", () => {
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
    it("should return .bob/skills as relativeDirPath by default", () => {
      const paths = BobSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".bob", "skills"));
    });

    it("should return same path for global mode (Bob uses the same structure)", () => {
      // Bob uses ~/.bob/skills/ for global and .bob/skills/ for project
      // The relative path structure is the same, only the base directory differs
      const projectPaths = BobSkill.getSettablePaths({ global: false });
      const globalPaths = BobSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".bob", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".bob", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new BobSkill({
        outputRoot: testDir,
        relativeDirPath: join(".bob", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(BobSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new BobSkill({
            outputRoot: testDir,
            relativeDirPath: join(".bob", "skills"),
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
      const skillDir = join(testDir, ".bob", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await BobSkill.fromDir({
        outputRoot: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(BobSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".bob", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        BobSkill.fromDir({
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

      const bobSkill = BobSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(bobSkill).toBeInstanceOf(BobSkill);
      expect(bobSkill.getRelativeDirPath()).toBe(join(".bob", "skills"));
      expect(bobSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const bobSkill = new BobSkill({
        outputRoot: testDir,
        relativeDirPath: join(".bob", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = bobSkill.toRulesyncSkill();

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

      expect(BobSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'bob'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "bob-specific",
        frontmatter: { name: "bob-specific", description: "Bob", targets: ["bob"] },
        body: "body",
        validate: false,
      });

      expect(BobSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when bob is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(BobSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = BobSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".bob", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".bob", "skills"));
    });
  });

  describe("bob section round-trip", () => {
    it("should emit license from the bob section into the SKILL.md frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["bob"],
          bob: { license: "MIT", name: "ignored", description: "ignored" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = BobSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter() as Record<string, unknown>;

      expect(frontmatter.license).toEqual("MIT");
      // Canonical name/description win over stray same-named section keys.
      expect(frontmatter.name).toBe("deploy");
      expect(frontmatter.description).toBe("Deploy the app");
    });

    it("should lift extra frontmatter keys back into the bob section on import", () => {
      const skill = new BobSkill({
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

      expect(frontmatter.bob).toEqual({ license: "MIT" });
      expect(frontmatter.name).toBe("deploy");
    });

    it("should omit the bob section when no extra keys exist", () => {
      const skill = new BobSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain skill" },
        body: "Body.",
        validate: false,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().bob).toBeUndefined();
    });
  });
});
