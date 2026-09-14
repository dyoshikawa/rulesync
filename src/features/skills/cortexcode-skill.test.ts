import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CortexcodeSkill } from "./cortexcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CortexcodeSkill", () => {
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
    it("should return .cortex/skills as relativeDirPath by default", () => {
      const paths = CortexcodeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".cortex", "skills"));
    });

    it("should return .snowflake/cortex/skills for global mode", () => {
      // Cortex Code reads ~/.snowflake/cortex/skills/ for user skills and
      // .cortex/skills/ for project skills.
      const projectPaths = CortexcodeSkill.getSettablePaths({ global: false });
      const globalPaths = CortexcodeSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".cortex", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".snowflake", "cortex", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new CortexcodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".cortex", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(CortexcodeSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new CortexcodeSkill({
            outputRoot: testDir,
            relativeDirPath: join(".cortex", "skills"),
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
      const skillDir = join(testDir, ".cortex", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await CortexcodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(CortexcodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".cortex", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        CortexcodeSkill.fromDir({
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

      const cortexcodeSkill = CortexcodeSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(cortexcodeSkill).toBeInstanceOf(CortexcodeSkill);
      expect(cortexcodeSkill.getRelativeDirPath()).toBe(join(".cortex", "skills"));
      expect(cortexcodeSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const cortexcodeSkill = new CortexcodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".cortex", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = cortexcodeSkill.toRulesyncSkill();

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

      expect(CortexcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'cortexcode'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "cortexcode-specific",
        frontmatter: {
          name: "cortexcode-specific",
          description: "Cortexcode",
          targets: ["cortexcode"],
        },
        body: "body",
        validate: false,
      });

      expect(CortexcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when cortexcode is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(CortexcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = CortexcodeSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".cortex", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".cortex", "skills"));
    });
  });

  describe("cortexcode section round-trip", () => {
    it("should emit license from the cortexcode section into the SKILL.md frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["cortexcode"],
          cortexcode: { license: "MIT", name: "ignored", description: "ignored" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = CortexcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter() as Record<string, unknown>;

      expect(frontmatter.license).toEqual("MIT");
      // Canonical name/description win over stray same-named section keys.
      expect(frontmatter.name).toBe("deploy");
      expect(frontmatter.description).toBe("Deploy the app");
    });

    it("should lift extra frontmatter keys back into the cortexcode section on import", () => {
      const skill = new CortexcodeSkill({
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

      expect(frontmatter.cortexcode).toEqual({ license: "MIT" });
      expect(frontmatter.name).toBe("deploy");
    });

    it("should emit tools from the cortexcode section and lift them back on import", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: {
          name: "review",
          description: "Review code",
          targets: ["cortexcode"],
          cortexcode: { tools: ["read_file", "grep"] },
        },
        body: "Review.",
        validate: false,
      });

      const skill = CortexcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getFrontmatter().tools).toEqual(["read_file", "grep"]);
      expect(skill.toRulesyncSkill().getFrontmatter().cortexcode).toEqual({
        tools: ["read_file", "grep"],
      });
    });

    it("should reject a non-array tools value", () => {
      expect(
        () =>
          new CortexcodeSkill({
            outputRoot: testDir,
            dirName: "bad",
            frontmatter: { name: "bad", description: "Bad", tools: "read_file" } as never,
            body: "Body.",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should omit the cortexcode section when no extra keys exist", () => {
      const skill = new CortexcodeSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain skill" },
        body: "Body.",
        validate: false,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().cortexcode).toBeUndefined();
    });
  });
});
