import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ContinueSkill } from "./continue-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

const SKILLS_DIR = join(".continue", "skills");

describe("ContinueSkill", () => {
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
    it("should return .continue/skills as relativeDirPath by default", () => {
      const paths = ContinueSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(SKILLS_DIR);
    });

    it("should use the same relative directory in both scopes", () => {
      // Continue reads <project>/.continue/skills/ and ~/.continue/skills/;
      // the processor swaps outputRoot for the home directory in global mode.
      expect(ContinueSkill.getSettablePaths({ global: false }).relativeDirPath).toBe(SKILLS_DIR);
      expect(ContinueSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(SKILLS_DIR);
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new ContinueSkill({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(ContinueSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new ContinueSkill({
            outputRoot: testDir,
            relativeDirPath: SKILLS_DIR,
            dirName: "pdf-processing",
            frontmatter: { name: "pdf", description: "desc" },
            body: "content",
            validate: true,
          }),
      ).toThrow(/frontmatter name/);
    });

    it("should throw when description is missing", () => {
      expect(
        () =>
          new ContinueSkill({
            outputRoot: testDir,
            dirName: "bad",
            frontmatter: { name: "bad" } as never,
            body: "content",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should skip validation when validate is false", () => {
      const skill = new ContinueSkill({
        outputRoot: testDir,
        dirName: "mismatch",
        frontmatter: { name: "other", description: "desc" },
        body: "content",
        validate: false,
      });

      expect(skill.validate().success).toBe(false);
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, SKILLS_DIR, "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);
      await writeFileContent(join(skillDir, "helper.py"), "print('hi')\n");

      const skill = await ContinueSkill.fromDir({
        outputRoot: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(ContinueSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getOtherFiles().map((file) => file.relativeFilePathToDirPath)).toEqual([
        "helper.py",
      ]);
    });

    it("should throw error when frontmatter is invalid", async () => {
      const skillDir = join(testDir, SKILLS_DIR, "pdf-processing");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: pdf-processing
---

Body.`,
      );

      await expect(
        ContinueSkill.fromDir({
          outputRoot: testDir,
          dirName: "pdf-processing",
        }),
      ).rejects.toThrow(/Invalid frontmatter in .*SKILL\.md/);
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, SKILLS_DIR, "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        ContinueSkill.fromDir({
          outputRoot: testDir,
          dirName: "pdf-processing",
        }),
      ).rejects.toThrow(/must match directory name/);
    });

    it("should load from the same directory in global mode", async () => {
      const skillDir = join(testDir, SKILLS_DIR, "global-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: global-skill
description: Global
---

Body.`,
      );

      const skill = await ContinueSkill.fromDir({
        outputRoot: testDir,
        dirName: "global-skill",
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(SKILLS_DIR);
      expect(skill.getGlobal()).toBe(true);
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
        otherFiles: [{ relativeFilePathToDirPath: "notes.md", fileBuffer: Buffer.from("notes") }],
        validate: false,
      });

      const continueSkill = ContinueSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(continueSkill).toBeInstanceOf(ContinueSkill);
      expect(continueSkill.getRelativeDirPath()).toBe(SKILLS_DIR);
      expect(continueSkill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
      expect(continueSkill.getOtherFiles().map((file) => file.relativeFilePathToDirPath)).toEqual([
        "notes.md",
      ]);
    });

    it("should mark the instance global in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: { name: "deploy", description: "Deploy" },
        body: "Deploy.",
        validate: false,
      });

      const continueSkill = ContinueSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global: true,
      });

      expect(continueSkill.getGlobal()).toBe(true);
      expect(continueSkill.getRelativeDirPath()).toBe(SKILLS_DIR);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const continueSkill = new ContinueSkill({
        outputRoot: testDir,
        relativeDirPath: SKILLS_DIR,
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        otherFiles: [
          { relativeFilePathToDirPath: "helper.py", fileBuffer: Buffer.from("print('hi')") },
        ],
        validate: true,
      });

      const rulesyncSkill = continueSkill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Handle PDFs",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Instructions");
      expect(rulesyncSkill.getOtherFiles().map((file) => file.relativeFilePathToDirPath)).toEqual([
        "helper.py",
      ]);
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

      expect(ContinueSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'continue'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "continue-specific",
        frontmatter: {
          name: "continue-specific",
          description: "Continue",
          targets: ["continue"],
        },
        body: "body",
        validate: false,
      });

      expect(ContinueSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when continue is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(ContinueSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = ContinueSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: SKILLS_DIR,
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(SKILLS_DIR);
    });
  });

  describe("continue section round-trip", () => {
    it("should emit extra keys from the continue section into the SKILL.md frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["continue"],
          continue: { license: "MIT", name: "ignored", description: "ignored" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = ContinueSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter() as Record<string, unknown>;

      expect(frontmatter.license).toEqual("MIT");
      // Canonical name/description win over stray same-named section keys.
      expect(frontmatter.name).toBe("deploy");
      expect(frontmatter.description).toBe("Deploy the app");
    });

    it("should lift extra frontmatter keys back into the continue section on import", () => {
      const skill = new ContinueSkill({
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

      expect(frontmatter.continue).toEqual({ license: "MIT" });
      expect(frontmatter.name).toBe("deploy");
    });

    it("should omit the continue section when no extra keys exist", () => {
      const skill = new ContinueSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain skill" },
        body: "Body.",
        validate: false,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().continue).toBeUndefined();
    });

    it("should survive a full generate → import round-trip", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: {
          name: "review",
          description: "Review code",
          targets: ["*"],
          continue: { license: "Apache-2.0" },
        },
        body: "Review.",
        validate: false,
      });

      const imported = ContinueSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      }).toRulesyncSkill();

      expect(imported.getFrontmatter()).toEqual({
        name: "review",
        description: "Review code",
        targets: ["*"],
        continue: { license: "Apache-2.0" },
      });
      expect(imported.getBody()).toBe("Review.");
    });
  });
});
