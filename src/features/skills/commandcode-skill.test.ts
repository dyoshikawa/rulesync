import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CommandcodeSkill } from "./commandcode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CommandcodeSkill", () => {
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
    it("should return .commandcode/skills as relativeDirPath by default", () => {
      const paths = CommandcodeSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".commandcode", "skills"));
    });

    it("should return the same .commandcode/skills for global mode", () => {
      // Command Code reads ~/.commandcode/skills/ for user skills and
      // .commandcode/skills/ for project skills.
      const projectPaths = CommandcodeSkill.getSettablePaths({ global: false });
      const globalPaths = CommandcodeSkill.getSettablePaths({ global: true });
      expect(projectPaths.relativeDirPath).toBe(join(".commandcode", "skills"));
      expect(globalPaths.relativeDirPath).toBe(join(".commandcode", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new CommandcodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".commandcode", "skills"),
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract text and tables from PDFs",
        },
        body: "Follow PDF extraction steps.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(CommandcodeSkill);
      expect(skill.getBody()).toBe("Follow PDF extraction steps.");
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw when frontmatter name does not match directory", () => {
      expect(
        () =>
          new CommandcodeSkill({
            outputRoot: testDir,
            relativeDirPath: join(".commandcode", "skills"),
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
      const skillDir = join(testDir, ".commandcode", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf-processing
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await CommandcodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "pdf-processing",
      });

      expect(skill).toBeInstanceOf(CommandcodeSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "pdf-processing",
        description: "Extract text and tables from PDFs",
      });
    });

    it("should throw error when frontmatter name does not match directory", async () => {
      const skillDir = join(testDir, ".commandcode", "skills", "pdf-processing");
      await ensureDir(skillDir);
      const skillContent = `---
name: pdf
description: Extract text and tables from PDFs
---

Follow PDF extraction steps.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      await expect(
        CommandcodeSkill.fromDir({
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

      const commandcodeSkill = CommandcodeSkill.fromRulesyncSkill({
        rulesyncSkill,
      });

      expect(commandcodeSkill).toBeInstanceOf(CommandcodeSkill);
      expect(commandcodeSkill.getRelativeDirPath()).toBe(join(".commandcode", "skills"));
      expect(commandcodeSkill.getFrontmatter().name).toBe("pdf-processing");
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const commandcodeSkill = new CommandcodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".commandcode", "skills"),
        dirName: "pdf-processing",
        frontmatter: { name: "pdf-processing", description: "Handle PDFs" },
        body: "Instructions",
        validate: true,
      });

      const rulesyncSkill = commandcodeSkill.toRulesyncSkill();

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

      expect(CommandcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'commandcode'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "commandcode-specific",
        frontmatter: {
          name: "commandcode-specific",
          description: "Command Code",
          targets: ["commandcode"],
        },
        body: "body",
        validate: false,
      });

      expect(CommandcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when commandcode is not targeted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "other-tool",
        frontmatter: { name: "other-tool", description: "Other", targets: ["copilot"] },
        body: "body",
        validate: false,
      });

      expect(CommandcodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = CommandcodeSkill.forDeletion({
        dirName: "obsolete",
        relativeDirPath: join(".commandcode", "skills"),
      });

      expect(skill.getDirName()).toBe("obsolete");
      expect(skill.getRelativeDirPath()).toBe(join(".commandcode", "skills"));
    });
  });

  describe("commandcode section round-trip", () => {
    it("should emit license from the commandcode section into the SKILL.md frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["commandcode"],
          commandcode: { license: "MIT", name: "ignored", description: "ignored" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = CommandcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter() as Record<string, unknown>;

      expect(frontmatter.license).toEqual("MIT");
      // Canonical name/description win over stray same-named section keys.
      expect(frontmatter.name).toBe("deploy");
      expect(frontmatter.description).toBe("Deploy the app");
    });

    it("falls back to the root-level packaging fields and invocation gates (issue #3075)", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["commandcode"],
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "me" },
          "disable-model-invocation": true,
          "user-invocable": false,
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = CommandcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).toEqual({
        name: "deploy",
        description: "Deploy the app",
        license: "MIT",
        compatibility: "Requires git",
        metadata: { author: "me" },
        "disable-model-invocation": true,
        "user-invocable": false,
      });
    });

    it("lets the commandcode section override a root-level default", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "deploy",
        frontmatter: {
          name: "deploy",
          description: "Deploy the app",
          targets: ["commandcode"],
          license: "MIT",
          "user-invocable": false,
          commandcode: { license: "Apache-2.0", "user-invocable": true, effort: "high" },
        },
        body: "Deploy.",
        validate: false,
      });

      const skill = CommandcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      // A defined section value (including a boolean flip) wins over the root
      // default, and section-only keys still pass through.
      expect(skill.getFrontmatter()).toEqual({
        name: "deploy",
        description: "Deploy the app",
        license: "Apache-2.0",
        "user-invocable": true,
        effort: "high",
      });
    });

    it("should lift extra frontmatter keys back into the commandcode section on import", () => {
      const skill = new CommandcodeSkill({
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

      expect(frontmatter.commandcode).toEqual({ license: "MIT" });
      expect(frontmatter.name).toBe("deploy");
    });

    it("should emit documented optional keys from the commandcode section and lift them back on import", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: {
          name: "review",
          description: "Review code",
          targets: ["commandcode"],
          commandcode: {
            "allowed-tools": ["read_file", "grep"],
            "argument-hint": "<pr-number>",
            "disable-model-invocation": true,
            effort: "high",
          },
        },
        body: "Review.",
        validate: false,
      });

      const skill = CommandcodeSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getFrontmatter()).toEqual({
        name: "review",
        description: "Review code",
        "allowed-tools": ["read_file", "grep"],
        "argument-hint": "<pr-number>",
        "disable-model-invocation": true,
        effort: "high",
      });
      expect(skill.toRulesyncSkill().getFrontmatter().commandcode).toEqual({
        "allowed-tools": ["read_file", "grep"],
        "argument-hint": "<pr-number>",
        "disable-model-invocation": true,
        effort: "high",
      });
    });

    it("should reject a missing description", () => {
      expect(
        () =>
          new CommandcodeSkill({
            outputRoot: testDir,
            dirName: "bad",
            frontmatter: { name: "bad" } as never,
            body: "Body.",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });

    it("should omit the commandcode section when no extra keys exist", () => {
      const skill = new CommandcodeSkill({
        outputRoot: testDir,
        dirName: "plain",
        frontmatter: { name: "plain", description: "Plain skill" },
        body: "Body.",
        validate: false,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().commandcode).toBeUndefined();
    });
  });
});
