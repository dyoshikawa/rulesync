import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { TAKT_SKILLS_DIR_PATH } from "../../constants/takt-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import {
  directoryExists,
  ensureDir,
  fileExists,
  readFileBuffer,
  writeFileContent,
} from "../../utils/file.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import { JunieSkill } from "./junie-skill.js";
import { RovodevSkill } from "./rovodev-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import {
  SkillsProcessor,
  SkillsProcessorToolTarget,
  SkillsProcessorToolTargetSchema,
  skillsProcessorToolTargetsGlobal,
} from "./skills-processor.js";
import { TaktSkill } from "./takt-skill.js";

/**
 * Write a directory-form skill whose frontmatter `name` matches its directory
 * name, which is what every multi-root precedence test here needs.
 */
async function writeSkill({
  testDir,
  base,
  dirName,
  body,
}: {
  testDir: string;
  base: string;
  dirName: string;
  body: string;
}): Promise<void> {
  const dir = join(testDir, base, dirName);
  await ensureDir(dir);
  await writeFileContent(
    join(dir, "SKILL.md"),
    `---
name: ${dirName}
description: d
---
${body}`,
  );
}

describe("SkillsProcessor", () => {
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

  describe("constructor", () => {
    it("should create instance with valid tool target", () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should use default outputRoot when not provided", () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should validate tool target with schema", () => {
      expect(() => {
        const _processor = new SkillsProcessor({
          logger: createMockLogger(),
          outputRoot: testDir,
          toolTarget: "invalid" as SkillsProcessorToolTarget,
        });
      }).toThrow("Invalid tool target for SkillsProcessor");
    });

    it("should accept global parameter", () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
    });

    it("should default global to false", () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      expect((processor as any).global).toBe(false);
    });
  });

  describe("convertRulesyncDirsToToolDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert rulesync skills to claudecode skills", async () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
      const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
      expect(claudecodeSkill.getFrontmatter().name).toBe("test-skill");
      expect(claudecodeSkill.getFrontmatter().description).toBe("Test skill description");
    });

    it("should pass its logger to the tool skill so spec diagnostics reach the user", async () => {
      const logger = createMockLogger();
      const agentsSkillsProcessor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "agentsskills",
      });
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "My_Bad--Name",
        frontmatter: {
          name: "My_Bad--Name",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      await agentsSkillsProcessor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("lowercase letters, digits and single hyphens"),
        ),
      ).toBe(true);
    });

    it("should filter out non-RulesyncSkill instances", async () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const mockOtherDir = {
        getDirPath: () => "not-a-skill",
      } as any;

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill, mockOtherDir]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
    });

    it("should filter out skills not targeted for the tool", async () => {
      // Create a skill without claudecode in targets (by not having claudecode frontmatter)
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "non-targeted-skill",
        frontmatter: {
          name: "non-targeted-skill",
          description: "Not for claudecode",
        },
        body: "Content",
        validate: false,
      });

      const targetedSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "targeted-skill",
        frontmatter: {
          name: "targeted-skill",
          description: "For claudecode",
          claudecode: {
            "allowed-tools": ["bash"],
          },
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([
        rulesyncSkill,
        targetedSkill,
      ]);

      // Both should be converted as ClaudecodeSkill.isTargetedByRulesyncSkill returns true for all by default
      expect(toolDirs.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty rulesync dirs array", async () => {
      const toolDirs = await processor.convertRulesyncDirsToToolDirs([]);
      expect(toolDirs).toEqual([]);
    });

    it("should pass global parameter to ClaudecodeSkill.fromRulesyncSkill", async () => {
      const globalProcessor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "global-skill",
        frontmatter: {
          name: "global-skill",
          description: "Global skill",
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await globalProcessor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
    });

    it("should not generate a skill into a directory another feature owns", async () => {
      // `.factory/skills/review-guidelines/` is the checks feature's output, and
      // `FactorydroidSkill.isDirOwned` keeps the skills feature from deleting it
      // again, so writing it from a skill would outlive the skill.
      const logger = createMockLogger();
      const factorydroidProcessor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "factorydroid",
      });
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review-guidelines",
        frontmatter: {
          name: "review-guidelines",
          description: "Our guidelines",
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await factorydroidProcessor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("review-guidelines"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("checks"));
    });

    it("should generate that same skill in global mode", async () => {
      // Factory's reviewer reads a repository, so checks has no user-level
      // output and nothing else claims the name there.
      const factorydroidProcessor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "factorydroid",
        global: true,
      });
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review-guidelines",
        frontmatter: {
          name: "review-guidelines",
          description: "Our guidelines",
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await factorydroidProcessor.convertRulesyncDirsToToolDirs([rulesyncSkill]);

      expect(toolDirs).toHaveLength(1);
    });

    it("should not convert claudecode scheduled-task skills for non-claudecode targets", async () => {
      const cursorProcessor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "cursor",
      });

      const scheduledTaskSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "scheduled-task-only",
        frontmatter: {
          name: "scheduled-task-only",
          description: "Scheduled task only",
          targets: ["*"],
          claudecode: {
            "scheduled-task": true,
          },
        },
        body: "Content",
        validate: false,
      });

      const toolDirs = await cursorProcessor.convertRulesyncDirsToToolDirs([scheduledTaskSkill]);
      expect(toolDirs).toEqual([]);
    });

    it("should skip a directory it cannot name, or a hidden one, when importing", async () => {
      // Same two directories the sweep leaves alone, on the read side: the
      // backslash name is reported, and the hidden directory — which has no
      // SKILL.md and would otherwise fail the import of this native root — is
      // passed over silently, as the glob used to do.
      const logger = createMockLogger();
      const loggingProcessor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const skillsDir = join(testDir, ".claude", "skills");
      const frontmatter = "---\nname: plain\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "back\\slash", "SKILL.md"), frontmatter);
      await writeFileContent(join(skillsDir, "plain", "SKILL.md"), frontmatter);
      await ensureDir(join(skillsDir, ".git"));

      const toolDirs = await loggingProcessor.loadToolDirs();

      expect(toolDirs.map((dir) => dir.getDirName())).toEqual(["plain"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("a skill directory name cannot contain a path separator"),
      );
    });

    it("should report a skill it cannot load without letting the name rewrite the line", async () => {
      // The name comes off disk, so it can carry the escape sequence that
      // erases the line it is printed on and passes the rest off as output of
      // rulesync's own. Quoting the stripped path is what the rest of the
      // codebase does with such a name.
      const logger = createMockLogger();
      const loggingProcessor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "amp",
      });
      // An interop root is read leniently, so a directory without a SKILL.md is
      // reported instead of failing the import.
      await ensureDir(join(testDir, ".agents", "skills", "ok\u001b[2K\r-fake-line"));

      await loggingProcessor.loadToolDirs();

      const reported = logger.warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.startsWith("Skipping "));
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain('"' + join(".agents", "skills", "ok[2K-fake-line") + '"');
      expect(reported[0]).not.toContain("\u001b");
      expect(reported[0]).not.toContain("\r");
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target (bypassing constructor validation)
      const processorWithMockTarget = Object.create(SkillsProcessor.prototype);
      processorWithMockTarget.outputRoot = testDir;
      processorWithMockTarget.toolTarget = "unsupported";
      processorWithMockTarget.global = false;
      processorWithMockTarget.getFactory = (target: any) => {
        throw new Error(`Unsupported tool target: ${target}`);
      };

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test",
        frontmatter: { name: "test", description: "test" },
        body: "test",
        validate: false,
      });

      await expect(
        processorWithMockTarget.convertRulesyncDirsToToolDirs([rulesyncSkill]),
      ).rejects.toThrow("Unsupported tool target: unsupported");
    });
  });

  describe("convertToolDirsToRulesyncDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should convert tool skills to rulesync skills", async () => {
      const claudecodeSkill = new ClaudecodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".claude", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([claudecodeSkill]);

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("test-skill");
    });

    it("should filter out non-ToolSkill instances", async () => {
      const claudecodeSkill = new ClaudecodeSkill({
        outputRoot: testDir,
        relativeDirPath: join(".claude", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill",
        },
        body: "Content",
        validate: false,
      });

      const mockOtherDir = {
        getDirPath: () => "not-a-tool-skill",
      } as any;

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([
        claudecodeSkill,
        mockOtherDir,
      ]);

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
    });

    it("should handle empty tool dirs array", async () => {
      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs([]);
      expect(rulesyncDirs).toEqual([]);
    });

    it("should handle array with no ToolSkill instances", async () => {
      const toolDirs = [{ getDirPath: () => "dir1" } as any, { getDirPath: () => "dir2" } as any];

      const rulesyncDirs = await processor.convertToolDirsToRulesyncDirs(toolDirs);
      expect(rulesyncDirs).toEqual([]);
    });
  });

  describe("loadRulesyncDirs", () => {
    let processor: SkillsProcessor;
    let logger: ReturnType<typeof createMockLogger>;

    beforeEach(() => {
      logger = createMockLogger();
      processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when skills directory does not exist", async () => {
      const rulesyncDirs = await processor.loadRulesyncDirs();
      expect(rulesyncDirs).toEqual([]);
    });

    it("should load valid skill directories", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      await ensureDir(skill1Dir);

      const skillContent = `---
name: skill-1
description: First skill
---
This is skill content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skillContent);

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("skill-1");
      expect(rulesyncSkill.getFrontmatter().description).toBe("First skill");
    });

    it("should load multiple skill directories", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      const skill2Dir = join(skillsDir, "skill-2");
      await ensureDir(skill1Dir);
      await ensureDir(skill2Dir);

      const skill1Content = `---
name: skill-1
description: First skill
---
Content 1`;

      const skill2Content = `---
name: skill-2
description: Second skill
---
Content 2`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skill1Content);
      await writeFileContent(join(skill2Dir, "SKILL.md"), skill2Content);

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(2);
      expect(rulesyncDirs.every((dir) => dir instanceof RulesyncSkill)).toBe(true);

      const names = rulesyncDirs
        .map((dir) => (dir as RulesyncSkill).getFrontmatter().name)
        .toSorted();
      expect(names).toEqual(["skill-1", "skill-2"]);
    });

    it("should prefer a local skill over a case-variant curated skill", async () => {
      const localSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "Shared-Skill");
      const curatedSkillDir = join(
        testDir,
        RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
        "shared-skill",
      );
      await ensureDir(localSkillDir);
      await ensureDir(curatedSkillDir);
      await writeFileContent(
        join(localSkillDir, "SKILL.md"),
        `---
name: Shared-Skill
description: Local skill
---
Local content`,
      );
      await writeFileContent(
        join(curatedSkillDir, "SKILL.md"),
        `---
name: shared-skill
description: Curated skill
---
Curated content`,
      );

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect((rulesyncDirs[0] as RulesyncSkill).getDirName()).toBe("Shared-Skill");
      expect((rulesyncDirs[0] as RulesyncSkill).getBody()).toBe("Local content");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive skill collision under"),
      );
    });

    it("should not warn when a curated skill is shadowed by an exactly-named local skill", async () => {
      const localSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared-skill");
      const curatedSkillDir = join(
        testDir,
        RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
        "shared-skill",
      );
      await ensureDir(localSkillDir);
      await ensureDir(curatedSkillDir);
      await writeFileContent(
        join(localSkillDir, "SKILL.md"),
        `---
name: shared-skill
description: Local skill
---
Local content`,
      );
      await writeFileContent(
        join(curatedSkillDir, "SKILL.md"),
        `---
name: shared-skill
description: Curated skill
---
Curated content`,
      );

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive skill collision under"),
      );
    });

    // On a case-sensitive filesystem both spellings can exist side by side, so
    // the exactly-named local skill must be the one that decides whether this
    // is a plain override or an ambiguous collision. (On a case-insensitive
    // filesystem the two directories are one, so this case degenerates into
    // the plain-override case above and still holds.)
    it("should not warn when an exactly-named local skill exists next to a case variant", async () => {
      const exactLocalSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared-skill");
      const variantLocalSkillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "Shared-Skill");
      const curatedSkillDir = join(
        testDir,
        RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
        "shared-skill",
      );
      await ensureDir(exactLocalSkillDir);
      await ensureDir(variantLocalSkillDir);
      await ensureDir(curatedSkillDir);
      await writeFileContent(
        join(exactLocalSkillDir, "SKILL.md"),
        `---
name: shared-skill
description: Local skill
---
Local content`,
      );
      await writeFileContent(
        join(variantLocalSkillDir, "SKILL.md"),
        `---
name: Shared-Skill
description: Local variant skill
---
Local variant content`,
      );
      await writeFileContent(
        join(curatedSkillDir, "SKILL.md"),
        `---
name: shared-skill
description: Curated skill
---
Curated content`,
      );

      const rulesyncDirs = await processor.loadRulesyncDirs();

      // The two local spellings themselves are folded into one skill by the
      // cross-root merge; what matters here is that the curated skill is
      // skipped as a plain override rather than reported as a collision.
      expect(rulesyncDirs).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Case-insensitive skill collision under"),
      );
    });

    it("should throw error when invalid skill directory is found", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const invalidSkillDir = join(skillsDir, "invalid-skill");
      await ensureDir(invalidSkillDir);

      const invalidContent = `---
invalid yaml: [
---
Invalid content`;

      await writeFileContent(join(invalidSkillDir, "SKILL.md"), invalidContent);

      await expect(processor.loadRulesyncDirs()).rejects.toThrow();
    });

    // End-to-end coverage for issue #1707: a skill directory under .rulesync/skills/ that is
    // a symlink to a real directory elsewhere must be loaded like a regular skill. fs.symlink
    // needs admin/Developer Mode on Windows, so this is skipped there (issue #1808 #5).
    it.skipIf(process.platform === "win32")(
      "should load a skill directory that is a symbolic link",
      async () => {
        const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
        await ensureDir(skillsDir);

        // The real skill lives outside .rulesync/skills/, shared via a symlink.
        const sharedSkillDir = join(testDir, "shared", "linked-skill");
        await ensureDir(sharedSkillDir);
        await writeFileContent(
          join(sharedSkillDir, "SKILL.md"),
          `---
name: linked-skill
description: Skill shared via a symbolic link
---
Linked skill content`,
        );

        await symlink(sharedSkillDir, join(skillsDir, "linked-skill"));

        const rulesyncDirs = await processor.loadRulesyncDirs();

        expect(rulesyncDirs).toHaveLength(1);
        const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
        expect(rulesyncSkill.getFrontmatter().name).toBe("linked-skill");
        expect(rulesyncSkill.getFrontmatter().description).toBe("Skill shared via a symbolic link");
      },
    );

    it("should skip a rulesync skill directory whose name contains a backslash", async () => {
      // The glob this enumeration replaced rewrote the backslash into a
      // separator, so it reported a directory that does not exist and missed
      // the real one. A name holding a separator cannot be carried through
      // `AiDir`, so the run reports it and generates the skill beside it.
      const warningLogger = createMockLogger();
      const loggingProcessor = new SkillsProcessor({
        logger: warningLogger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const frontmatter = "---\nname: plain\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "back\\slash", "SKILL.md"), frontmatter);
      await writeFileContent(join(skillsDir, "plain", "SKILL.md"), frontmatter);

      const rulesyncDirs = await loggingProcessor.loadRulesyncDirs();

      expect(rulesyncDirs.map((dir) => dir.getDirName())).toEqual(["plain"]);
      expect(warningLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("a skill directory name cannot contain a path separator"),
      );
    });

    it("should ignore a hidden directory beside the rulesync skills", async () => {
      // `.ipynb_checkpoints`, `.venv` and their kind are not skills, and the
      // loader throws on a directory without a SKILL.md — reading them would
      // stop `generate` over somebody else's by-product.
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const frontmatter = "---\nname: plain\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "plain", "SKILL.md"), frontmatter);
      await ensureDir(join(skillsDir, ".ipynb_checkpoints"));

      const rulesyncDirs = await processor.loadRulesyncDirs();

      expect(rulesyncDirs.map((dir) => dir.getDirName())).toEqual(["plain"]);
    });

    it("should throw error when directory without SKILL.md file is found", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const emptyDir = join(skillsDir, "empty-dir");
      await ensureDir(emptyDir);

      await expect(processor.loadRulesyncDirs()).rejects.toThrow("SKILL.md not found in");
    });

    it("should load rulesync dirs from cwd even when outputRoot is different (global mode)", async () => {
      const skillsDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      await ensureDir(skill1Dir);

      const skillContent = `---
name: skill-1
description: First skill
---
This is skill content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skillContent);

      // Use a different outputRoot to simulate global mode (outputRoot = homeDir)
      const differentOutputRoot = join(testDir, "fake-home");
      await ensureDir(differentOutputRoot);

      const globalProcessor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: differentOutputRoot,
        toolTarget: "claudecode",
        global: true,
      });

      const rulesyncDirs = await globalProcessor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      const rulesyncSkill = rulesyncDirs[0] as RulesyncSkill;
      expect(rulesyncSkill.getFrontmatter().name).toBe("skill-1");
    });

    // Mirror the per-feature inputRoots threading assertion used in
    // commands-processor.test.ts: when inputRoots is set, loadRulesyncDirs
    // reads from `<inputRoots[0]>/skills` (source tree itself) instead of
    // `<process.cwd()>/.rulesync/skills`.
    it("should read rulesync skill dirs from inputRoots[0] instead of process.cwd()", async () => {
      const customInputRoot = join(testDir, "custom-rulesync-dir", RULESYNC_RELATIVE_DIR_PATH);
      const customSkillsDir = join(customInputRoot, "skills");
      await ensureDir(customSkillsDir);

      const skillDir = join(customSkillsDir, "input-root-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: input-root-skill
description: Skill loaded from inputRoots[0]
---
Body from inputRoots[0]`;

      await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

      // outputRoot is testDir (process.cwd()); no skills exist there, so
      // a successful load proves the processor read from inputRoots[0].
      const inputRootProcessor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        inputRoots: [customInputRoot],
        toolTarget: "claudecode",
      });

      const rulesyncDirs = await inputRootProcessor.loadRulesyncDirs();

      expect(rulesyncDirs).toHaveLength(1);
      expect(rulesyncDirs[0]).toBeInstanceOf(RulesyncSkill);
      expect((rulesyncDirs[0] as RulesyncSkill).getFrontmatter().name).toBe("input-root-skill");
    });
  });

  describe("loadToolDirs", () => {
    it("should delegate to loadClaudecodeSkills for claudecode target", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const toolDirs = await processor.loadToolDirs();
      expect(Array.isArray(toolDirs)).toBe(true);
    });

    it("should throw error for unsupported tool target", async () => {
      // Create processor with mock tool target
      const processorWithMockTarget = Object.create(SkillsProcessor.prototype);
      processorWithMockTarget.outputRoot = testDir;
      processorWithMockTarget.toolTarget = "unsupported";
      processorWithMockTarget.getFactory = (target: any) => {
        throw new Error(`Unsupported tool target: ${target}`);
      };

      await expect(processorWithMockTarget.loadToolDirs()).rejects.toThrow(
        "Unsupported tool target: unsupported",
      );
    });

    it("should load rovodev skills from .agents/skills when .rovodev/skills is absent", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      const skillDir = join(testDir, ".agents", "skills", "imported-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, "SKILL.md"),
        `---
name: imported-skill
description: From alternative root
---
Skill body`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(RovodevSkill);
      const skill = toolDirs[0] as RovodevSkill;
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getBody()).toBe("Skill body");
    });

    it("should prefer .rovodev/skills over .agents/skills for the same skill name", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      await writeSkill({
        testDir,
        base: join(".rovodev", "skills"),
        dirName: "dup-skill",
        body: "from-rovo",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "dup-skill",
        body: "from-agents",
      });

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      const skill = toolDirs[0] as RovodevSkill;
      expect(skill.getBody()).toBe("from-rovo");
      expect(skill.getRelativeDirPath()).toBe(join(".rovodev", "skills"));
    });

    it("should prefer .junie/skills over the import-only .agents/skills for the same skill name", async () => {
      // junie declares `.agents/skills` under `importOnlySkillRoots`, which is a
      // different list from rovodev's `alternativeSkillRoots` above. Precedence
      // must still resolve the same way, so the tool-specific root wins and the
      // shared tree only fills in names it does not already cover.
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "junie",
      });
      await writeSkill({
        testDir,
        base: join(".junie", "skills"),
        dirName: "dup-skill",
        body: "from-junie",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "dup-skill",
        body: "from-agents",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "shared-only",
        body: "from-agents",
      });

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(2);
      const byName = new Map(
        toolDirs.map((toolDir) => [
          toolDir.getDirName(),
          [(toolDir as JunieSkill).getRelativeDirPath(), (toolDir as JunieSkill).getBody()],
        ]),
      );
      expect(byName.get("dup-skill")).toEqual([join(".junie", "skills"), "from-junie"]);
      expect(byName.get("shared-only")).toEqual([join(".agents", "skills"), "from-agents"]);
    });

    it("should prefer .rovodev/skills over .agents/skills for a name differing only in case", async () => {
      // The two skills are written back as `.rulesync/skills/dup-skill` and
      // `.rulesync/skills/Dup-Skill`, which are one directory on macOS and
      // Windows. Letting both through would let the shared tree — written
      // last — overwrite the tool-specific skill it is supposed to lose to.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      await writeSkill({
        testDir,
        base: join(".rovodev", "skills"),
        dirName: "dup-skill",
        body: "from-rovo",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "Dup-Skill",
        body: "from-agents",
      });

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      const skill = toolDirs[0] as RovodevSkill;
      expect(skill.getBody()).toBe("from-rovo");
      expect(skill.getRelativeDirPath()).toBe(join(".rovodev", "skills"));
      // The warning has to name the ignored copy and the root that kept the
      // skill, since that is the only way the user learns which of the two
      // spellings survived the import.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Case-insensitive rovodev skill collision: "dup-skill" and "Dup-Skill" resolve to the same skill directory. Keeping "dup-skill" from the higher-precedence ${join(".rovodev", "skills")} and ignoring ${join(".agents", "skills", "Dup-Skill")}`,
        ),
      );
    });

    it("should prefer .junie/skills over .agents/skills for a name differing only in case", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "junie",
      });
      await writeSkill({
        testDir,
        base: join(".junie", "skills"),
        dirName: "dup-skill",
        body: "from-junie",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "Dup-Skill",
        body: "from-agents",
      });

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      const skill = toolDirs[0] as JunieSkill;
      expect(skill.getBody()).toBe("from-junie");
      expect(skill.getRelativeDirPath()).toBe(join(".junie", "skills"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Case-insensitive junie skill collision`),
      );
    });

    it("should prefer .vibe/skills over .agents/skills for a name differing only in case", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "vibe",
      });
      await writeSkill({
        testDir,
        base: join(".vibe", "skills"),
        dirName: "dup-skill",
        body: "from-vibe",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "DUP-SKILL",
        body: "from-agents",
      });

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]?.getRelativeDirPath()).toBe(join(".vibe", "skills"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Case-insensitive vibe skill collision`),
      );
    });

    it("should not warn when the same skill name repeats with identical spelling", async () => {
      // An exact repeat across roots is an ordinary overlay, and has always
      // been resolved silently. Only case-only ambiguity is diagnosed.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      await writeSkill({
        testDir,
        base: join(".rovodev", "skills"),
        dirName: "dup-skill",
        body: "from-rovo",
      });
      await writeSkill({
        testDir,
        base: join(".agents", "skills"),
        dirName: "dup-skill",
        body: "from-agents",
      });

      await processor.loadToolDirs();

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should skip an agentsskills skill with invalid frontmatter and import the rest", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "agentsskills",
      });
      const goodDir = join(testDir, ".agents", "skills", "good-skill");
      const badDir = join(testDir, ".agents", "skills", "bad-skill");
      await ensureDir(goodDir);
      await ensureDir(badDir);
      await writeFileContent(
        join(goodDir, "SKILL.md"),
        `---
name: good-skill
description: A conformant skill
---
Good body`,
      );
      await writeFileContent(
        join(badDir, "SKILL.md"),
        `---
name: bad-skill
---
Missing description`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect((toolDirs[0] as AgentsSkillsSkill).getBody()).toBe("Good body");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(".agents", "skills", "bad-skill")),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("description"));
    });

    it("should skip an agentsskills skill with unparseable YAML and import the rest", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "agentsskills",
      });
      const goodDir = join(testDir, ".agents", "skills", "good-skill");
      const badDir = join(testDir, ".agents", "skills", "bad-yaml");
      await ensureDir(goodDir);
      await ensureDir(badDir);
      await writeFileContent(
        join(goodDir, "SKILL.md"),
        `---
name: good-skill
description: A conformant skill
---
Good body`,
      );
      await writeFileContent(
        join(badDir, "SKILL.md"),
        `---
name: bad-yaml
  description: Indented under a scalar
---
Bad indentation`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect((toolDirs[0] as AgentsSkillsSkill).getBody()).toBe("Good body");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(".agents", "skills", "bad-yaml")),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("indentation"));
    });

    it("should recover an agentsskills skill whose description contains an unquoted colon", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "agentsskills",
      });
      const skillDir = join(testDir, ".agents", "skills", "colon-skill");
      await ensureDir(skillDir);
      // The exact shape the Agent Skills client guide tells clients to retry:
      // the second colon ends the plain scalar, so a strict parser rejects it.
      await writeFileContent(
        join(skillDir, "SKILL.md"),
        `---
name: colon-skill
description: Use this skill when: the user asks about PDFs
---
Unquoted colon`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      const skill = toolDirs[0] as AgentsSkillsSkill;
      expect(skill.getBody()).toBe("Unquoted colon");
      expect(skill.getFrontmatter().description).toBe(
        "Use this skill when: the user asks about PDFs",
      );
    });

    it("should import the .agents/skills interop root leniently for non-lenient tools", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      const nativeDir = join(testDir, ".rovodev", "skills", "native-skill");
      const interopBadDir = join(testDir, ".agents", "skills", "bad-skill");
      await ensureDir(nativeDir);
      await ensureDir(interopBadDir);
      await writeFileContent(
        join(nativeDir, "SKILL.md"),
        `---
name: native-skill
description: A conformant skill
---
Native body`,
      );
      await writeFileContent(
        join(interopBadDir, "SKILL.md"),
        `---
name: bad-skill
---
Missing description`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(".agents", "skills", "bad-skill")),
      );
    });

    it("should import leniently when the interop root is the tool's primary root (codexcli)", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "codexcli",
      });
      const goodDir = join(testDir, ".agents", "skills", "good-skill");
      const badDir = join(testDir, ".agents", "skills", "bad-skill");
      await ensureDir(goodDir);
      await ensureDir(badDir);
      await writeFileContent(
        join(goodDir, "SKILL.md"),
        `---
name: good-skill
description: A conformant skill
---
Good body`,
      );
      await writeFileContent(
        join(badDir, "SKILL.md"),
        `---
name: bad-skill
description: "unterminated
---
Broken YAML`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(".agents", "skills", "bad-skill")),
      );
    });

    it("should skip a broken flat-file skill in the interop root instead of aborting (kimi-code)", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "kimi-code",
      });
      const interopDir = join(testDir, ".agents", "skills");
      await ensureDir(interopDir);
      await writeFileContent(
        join(interopDir, "good-flat.md"),
        `---
name: good-flat
description: A conformant flat skill
---
Good flat body`,
      );
      await writeFileContent(
        join(interopDir, "bad-flat.md"),
        `---
description: "unterminated
---
Broken YAML`,
      );

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(".agents", "skills", "bad-flat.md")),
      );
    });

    it("should skip a flat-file skill whose name contains a backslash", async () => {
      // The name a flat skill carries is its file name minus the extension, and
      // it reaches `AiDir` like a directory name does. Reporting it keeps one
      // file from failing the import of the whole root.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "kimi-code",
      });
      const interopDir = join(testDir, ".agents", "skills");
      const flatSkill = "---\nname: flat\ndescription: A conformant flat skill\n---\nBody";
      await writeFileContent(join(interopDir, "good-flat.md"), flatSkill);
      await writeFileContent(join(interopDir, "back\\slash.md"), flatSkill);

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("a skill name cannot contain a path separator"),
      );
    });

    it("should report a skill directory it cannot name once per run", async () => {
      // A processor is built per enabled tool target, and each one enumerates
      // the same directory. A message naming that directory would otherwise be
      // printed once per target.
      const logger = createMockLogger();
      const skillsDir = join(testDir, ".claude", "skills");
      const frontmatter = "---\nname: plain\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "back\\slash", "SKILL.md"), frontmatter);

      await new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      }).loadToolDirs();
      await new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      }).loadToolDirs();

      expect(
        logger.warn.mock.calls.filter(([message]) =>
          String(message).includes("a skill directory name cannot contain a path separator"),
        ),
      ).toHaveLength(1);
    });

    it("should import skills from nested .claude/skills directories (v2.1.178)", async () => {
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const rootDir = join(testDir, ".claude", "skills", "root-skill");
      const nestedDir = join(testDir, "apps", "web", ".claude", "skills", "deploy");
      const dupDir = join(testDir, "apps", "web", ".claude", "skills", "root-skill");
      const nodeModulesDir = join(testDir, "node_modules", "dep", ".claude", "skills", "vendored");
      const depthOneDir = join(testDir, "apps", ".claude", "skills", "shallow");
      const distDir = join(testDir, "dist", "x", ".claude", "skills", "built");
      for (const [dir, name, body] of [
        [rootDir, "root-skill", "Root body"],
        [nestedDir, "deploy", "Deploy body"],
        [dupDir, "root-skill", "Nested duplicate body"],
        [nodeModulesDir, "vendored", "Vendored body"],
        [depthOneDir, "shallow", "Shallow body"],
        [distDir, "built", "Built body"],
      ] as const) {
        await ensureDir(dir);
        await writeFileContent(
          join(dir, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`,
        );
      }

      const toolDirs = await processor.loadToolDirs();
      const names = toolDirs.map((dir) => (dir as AgentsSkillsSkill).getDirName());

      // The nested deploy skill is discovered; the root skill wins the name
      // clash; a dependency-tree skill is never scanned.
      expect(names).toContain("root-skill");
      expect(names).toContain("deploy");
      // Depth-1 nesting is covered by the `*/**` glob; root build dirs are not.
      expect(names).toContain("shallow");
      expect(names).not.toContain("built");
      expect(names).not.toContain("vendored");
      expect(names.filter((name) => name === "root-skill")).toHaveLength(1);

      // The nested skill's location-based scoping survives the import as an
      // explicit glob, while the root skill stays unscoped.
      const byName = new Map(
        toolDirs.map((dir) => [(dir as ClaudecodeSkill).getDirName(), dir as ClaudecodeSkill]),
      );
      expect(byName.get("deploy")?.toRulesyncSkill().getFrontmatter().claudecode).toEqual({
        paths: ["apps/web/**"],
      });
      expect(
        byName.get("root-skill")?.toRulesyncSkill().getFrontmatter().claudecode,
      ).toBeUndefined();
    });

    it.skipIf(process.platform === "win32")(
      "should report a nested skills directory the scan cannot name",
      async () => {
        // The nested scan is a recursive glob, and globby reads a backslash as
        // a path separator: the directory below `back\\slash` comes back as
        // `back/slash/...`, which nothing on disk answers to. The import cannot
        // recover the root from that, but it says so rather than dropping the
        // skills in it without a word.
        const logger = createMockLogger();
        const nestedDir = join(testDir, "back\\slash", ".claude", "skills", "deploy");
        await writeFileContent(
          join(nestedDir, "SKILL.md"),
          "---\nname: deploy\ndescription: Deploy description\n---\nDeploy body",
        );

        const toolDirs = await new SkillsProcessor({
          logger,
          outputRoot: testDir,
          toolTarget: "claudecode",
        }).loadToolDirs();

        expect(toolDirs.map((dir) => (dir as ClaudecodeSkill).getDirName())).not.toContain(
          "deploy",
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("could not be read under the path the scan reports"),
        );
      },
    );

    it.skipIf(process.platform === "win32")(
      "should refuse a nested skills directory whose reported path leaves the project",
      async () => {
        // The same rewrite can also land somewhere real: a directory named
        // `x\\..\\..\\outside` is reported at `x/../../outside`, which resolves
        // through a real sibling `x/` and out of the project entirely.
        // Following it would import somebody else's skills.
        const logger = createMockLogger();
        const outputRoot = join(testDir, "project");
        await ensureDir(join(outputRoot, "x"));
        await writeFileContent(
          join(outputRoot, "x\\..\\..\\outside", ".claude", "skills", "nested-skill", "SKILL.md"),
          "---\nname: nested-skill\ndescription: Nested description\n---\nNested body",
        );
        await writeFileContent(
          join(testDir, "outside", ".claude", "skills", "leaked", "SKILL.md"),
          "---\nname: leaked\ndescription: Leaked description\n---\nLeaked body",
        );

        const toolDirs = await new SkillsProcessor({
          logger,
          outputRoot,
          toolTarget: "claudecode",
        }).loadToolDirs();

        expect(toolDirs.map((dir) => (dir as ClaudecodeSkill).getDirName())).not.toContain(
          "leaked",
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("is not the directory's own"),
        );
      },
    );

    it.skipIf(process.platform === "win32")(
      "should refuse a nested skills directory the scan reports at another directory",
      async () => {
        // The third shape of the same rewrite: `x\\..\\y` is reported at
        // `x/../y`, which is inside the project and real, but belongs to `y`.
        // Importing it would scan `y` twice and the directory that was really
        // named not at all.
        const logger = createMockLogger();
        const outputRoot = join(testDir, "project");
        await ensureDir(join(outputRoot, "x"));
        await writeFileContent(
          join(outputRoot, "x\\..\\y", ".claude", "skills", "shadowed", "SKILL.md"),
          "---\nname: shadowed\ndescription: Shadowed description\n---\nShadowed body",
        );
        await writeFileContent(
          join(outputRoot, "y", ".claude", "skills", "sibling", "SKILL.md"),
          "---\nname: sibling\ndescription: Sibling description\n---\nSibling body",
        );

        const toolDirs = await new SkillsProcessor({
          logger,
          outputRoot,
          toolTarget: "claudecode",
        }).loadToolDirs();

        expect(toolDirs.map((dir) => (dir as ClaudecodeSkill).getDirName())).not.toContain(
          "shadowed",
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("is not the directory's own"),
        );
      },
    );

    it.skipIf(process.platform === "win32")(
      "should refuse a nested skills directory the scan reports at a link out of the project",
      async () => {
        // The rewrite needs no `..` to move the path. A directory named `a\\b` is
        // reported at `a/b`, every segment of which is a name a directory can
        // have, and `a/b` here is a symbolic link out of the project. The scan
        // sets `followSymbolicLinks: false`, so it never meant to reach it.
        const logger = createMockLogger();
        const outputRoot = join(testDir, "project");
        await ensureDir(join(outputRoot, "a"));
        await writeFileContent(
          join(outputRoot, "a\\b", ".claude", "skills", "decoy", "SKILL.md"),
          "---\nname: decoy\ndescription: Decoy description\n---\nDecoy body",
        );
        const outsideDir = join(testDir, "outside-home");
        await writeFileContent(
          join(outsideDir, ".claude", "skills", "private-skill", "SKILL.md"),
          "---\nname: private-skill\ndescription: Private description\n---\nPrivate body",
        );
        await symlink(outsideDir, join(outputRoot, "a", "b"));

        const toolDirs = await new SkillsProcessor({
          logger,
          outputRoot,
          toolTarget: "claudecode",
        }).loadToolDirs();

        expect(toolDirs.map((dir) => (dir as ClaudecodeSkill).getDirName())).not.toContain(
          "private-skill",
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("it resolves outside the project"),
        );
      },
    );

    it("should still abort import for non-lenient tools when a declared-root skill is invalid", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      const badDir = join(testDir, ".rovodev", "skills", "bad-skill");
      await ensureDir(badDir);
      await writeFileContent(
        join(badDir, "SKILL.md"),
        `---
name: bad-skill
---
Missing description`,
      );

      await expect(processor.loadToolDirs()).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("loadReasonixSkills", () => {
    let processor: SkillsProcessor;
    const reasonixSkillsDir = join(".reasonix", "skills");

    const writeReasonixSkillMd = async (name: string, extraFrontmatter = ""): Promise<void> => {
      const skillDir = join(testDir, reasonixSkillsDir, name);
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} description\n${extraFrontmatter}---\n\n${name} body`,
      );
    };

    beforeEach(() => {
      processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "reasonix",
      });
    });

    it("should not import subagent profile directories as skills", async () => {
      await writeReasonixSkillMd("plain-skill");
      await writeReasonixSkillMd("agent-profile", "invocation: manual\nrunAs: subagent\n");

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]?.getDirName()).toBe("plain-skill");
    });

    it("should not enumerate subagent profile directories as deletion candidates", async () => {
      await writeReasonixSkillMd("plain-skill");
      await writeReasonixSkillMd("agent-profile", "invocation: manual\nrunAs: subagent\n");

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(1);
      expect(dirsToDelete[0]?.getDirName()).toBe("plain-skill");
    });
  });

  describe("loadClaudecodeSkills", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should return empty array when skills directory does not exist", async () => {
      const toolDirs = await processor.loadToolDirs();
      expect(toolDirs).toEqual([]);
    });

    it("should load claudecode skill files from .claude/skills", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "claude-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: claude-skill
description: Claude skill description
---
Claude skill content`;

      await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(1);
      expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
      const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
      expect(claudecodeSkill.getFrontmatter().name).toBe("claude-skill");
    });

    it("should load multiple claudecode skill directories", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skill1Dir = join(skillsDir, "skill-1");
      const skill2Dir = join(skillsDir, "skill-2");
      await ensureDir(skill1Dir);
      await ensureDir(skill2Dir);

      const skill1Content = `---
name: skill-1
description: First Claude skill
---
First content`;

      const skill2Content = `---
name: skill-2
description: Second Claude skill
---
Second content`;

      await writeFileContent(join(skill1Dir, "SKILL.md"), skill1Content);
      await writeFileContent(join(skill2Dir, "SKILL.md"), skill2Content);

      const toolDirs = await processor.loadToolDirs();

      expect(toolDirs).toHaveLength(2);
      expect(toolDirs.every((dir) => dir instanceof ClaudecodeSkill)).toBe(true);

      const names = toolDirs
        .map((dir) => (dir as ClaudecodeSkill).getFrontmatter().name)
        .toSorted();
      expect(names).toEqual(["skill-1", "skill-2"]);
    });

    it("should throw error when directory fails to load", async () => {
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const invalidSkillDir = join(skillsDir, "invalid");
      await ensureDir(invalidSkillDir);

      // Create invalid skill (no frontmatter)
      await writeFileContent(
        join(invalidSkillDir, "SKILL.md"),
        "Invalid format without frontmatter",
      );

      await expect(processor.loadToolDirs()).rejects.toThrow();
    });

    describe("global mode", () => {
      it("should use global paths when global=true", async () => {
        const globalProcessor = new SkillsProcessor({
          logger: createMockLogger(),
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const globalSkillsDir = join(testDir, ".claude", "skills");
        await ensureDir(globalSkillsDir);

        const skillDir = join(globalSkillsDir, "global-skill");
        await ensureDir(skillDir);

        const skillContent = `---
name: global-skill
description: Global skill description
---
Global skill content`;

        await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

        const toolDirs = await globalProcessor.loadToolDirs();

        expect(toolDirs).toHaveLength(1);
        expect(toolDirs[0]).toBeInstanceOf(ClaudecodeSkill);
        const claudecodeSkill = toolDirs[0] as ClaudecodeSkill;
        expect(claudecodeSkill.getFrontmatter().name).toBe("global-skill");
      });

      it("should return empty array when global skills directory does not exist", async () => {
        const globalProcessor = new SkillsProcessor({
          logger: createMockLogger(),
          outputRoot: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const toolDirs = await globalProcessor.loadToolDirs();
        expect(toolDirs).toEqual([]);
      });
    });
  });

  describe("loadToolDirsToDelete", () => {
    it("should return the same dirs as loadToolDirs", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "test-skill");
      await ensureDir(skillDir);

      const skillContent = `---
name: test-skill
description: Test skill
---
Test skill content`;

      await writeFileContent(join(skillDir, "SKILL.md"), skillContent);

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(1);
      expect(dirsToDelete[0]).toBeInstanceOf(ClaudecodeSkill);
      expect(dirsToDelete[0]?.getDirName()).toBe("test-skill");
    });

    it("should report a skill directory whose name contains a backslash", async () => {
      // A `*` glob rewrites the backslash into a separator, so the candidate it
      // used to yield was `<root>/slash` — a directory that does not exist. The
      // real one cannot be swept either, since a directory name may not hold a
      // separator, so the run says so instead of quietly building a candidate
      // for nothing. The skill beside it is still swept.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      const frontmatter = "---\nname: a-skill\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "back\\slash", "SKILL.md"), frontmatter);
      await writeFileContent(join(skillsDir, "plain", "SKILL.md"), frontmatter);

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete.map((dir) => dir.getDirName())).toEqual(["plain"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("a skill directory name cannot contain a path separator"),
      );
    });

    it("should not sweep a hidden directory beside the skills", async () => {
      // A user who keeps `.claude/skills/` under its own version control has a
      // `.git` there. The glob this replaced never returned a hidden entry, and
      // `generate --delete` removes every candidate it is handed, so including
      // one here would delete a tree rulesync never wrote.
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      const frontmatter = "---\nname: plain\ndescription: Test skill\n---\nContent";
      await writeFileContent(join(skillsDir, "plain", "SKILL.md"), frontmatter);
      await ensureDir(join(skillsDir, ".git"));

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete.map((dir) => dir.getDirName())).toEqual(["plain"]);
    });

    it("should succeed even when SKILL.md has broken frontmatter", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(skillsDir);

      const skillDir = join(skillsDir, "broken-skill");
      await ensureDir(skillDir);

      // File with broken YAML frontmatter (unclosed bracket, invalid syntax)
      const brokenFrontmatter = `---
name: [broken-skill
description: This frontmatter is invalid YAML
  - unclosed bracket
  invalid: : syntax
---
Content that would fail parsing`;

      await writeFileContent(join(skillDir, "SKILL.md"), brokenFrontmatter);

      // forDeletion should succeed without parsing file content
      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(1);
      expect(dirsToDelete[0]).toBeInstanceOf(ClaudecodeSkill);
      expect(dirsToDelete[0]?.getDirName()).toBe("broken-skill");
    });

    it("should return empty array when no dirs exist", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      const dirsToDelete = await processor.loadToolDirsToDelete();
      expect(dirsToDelete).toEqual([]);
    });

    it("should list rovodev skills in both .rovodev/skills and .agents/skills for deletion", async () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "rovodev",
      });
      const rovoDir = join(testDir, ".rovodev", "skills", "a-skill");
      const agentsDir = join(testDir, ".agents", "skills", "b-skill");
      await ensureDir(rovoDir);
      await ensureDir(agentsDir);
      await writeFileContent(join(rovoDir, "SKILL.md"), "x");
      await writeFileContent(join(agentsDir, "SKILL.md"), "y");

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete).toHaveLength(2);
      const roots = dirsToDelete.map((d) => (d as RovodevSkill).getRelativeDirPath()).toSorted();
      expect(roots).toEqual([join(".agents", "skills"), join(".rovodev", "skills")]);
    });

    it("should not delete the shared takt facet root when no takt skill is generated", async () => {
      // Regression test for #2777. `TaktSkill` emits flat files under
      // `.takt/facets/knowledge`, so `getDirPath()` returns that shared root for
      // every enumerated candidate. Sweeping the root when the run generated no
      // takt skill deleted it outright, along with anything the user had put
      // there by hand.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({ logger, outputRoot: testDir, toolTarget: "takt" });

      const knowledgeDir = join(testDir, ".takt", "facets", "knowledge");
      const handAuthoredDir = join(knowledgeDir, "my-notes");
      await ensureDir(handAuthoredDir);
      await writeFileContent(join(handAuthoredDir, "notes.md"), "hand-authored");

      const dirsToDelete = await processor.loadToolDirsToDelete();
      const removedCount = await processor.removeOrphanAiDirs(dirsToDelete, []);

      expect(removedCount).toBe(0);
      expect(await directoryExists(knowledgeDir)).toBe(true);
      expect(await directoryExists(handAuthoredDir)).toBe(true);
      // A tool that flattens into a shared root is an expected shape, not a
      // contract mismatch, so it is skipped quietly: the positional backstop
      // added for #2786 must not turn this path into a user-facing warning.
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("is a shared root, not a directory of its own"),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should sweep the flat takt knowledge files no source produces", async () => {
      // Regression test for #2785. The shared facet root gets no per-skill
      // directory, so the directory sweep above finds nothing to remove and a
      // renamed skill left its old file behind forever.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({ logger, outputRoot: testDir, toolTarget: "takt" });

      const knowledgeDir = join(testDir, TAKT_SKILLS_DIR_PATH);
      await ensureDir(knowledgeDir);
      await writeFileContent(join(knowledgeDir, "runbook.md"), "the old name");
      await writeFileContent(join(knowledgeDir, "renamed.md"), "the new name");
      const handAuthoredDir = join(knowledgeDir, "my-notes");
      await ensureDir(handAuthoredDir);
      await writeFileContent(join(handAuthoredDir, "notes.md"), "hand-authored");

      const generated = new TaktSkill({
        outputRoot: testDir,
        relativeDirPath: TAKT_SKILLS_DIR_PATH,
        dirName: "renamed",
        fileName: "renamed.md",
        body: "the new name",
      });

      const filesToDelete = await processor.loadToolFlatFilesToDelete();
      const removedCount = await processor.removeOrphanFlatFiles({
        existingFlatFiles: filesToDelete,
        generatedDirs: [generated],
      });

      expect(removedCount).toBe(1);
      expect(await fileExists(join(knowledgeDir, "runbook.md"))).toBe(false);
      expect(await fileExists(join(knowledgeDir, "renamed.md"))).toBe(true);
      // The root itself and anything nested in it are not this sweep's to take.
      expect(await directoryExists(knowledgeDir)).toBe(true);
      expect(await fileExists(join(handAuthoredDir, "notes.md"))).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should sweep the flat takt knowledge files in global scope too", async () => {
      // takt skills are global-capable and the facet root is the same relative
      // path under the home directory, so the sweep has to reach it there as
      // well — the pseudo-home stands in for `~` (testing guidelines).
      const logger = createMockLogger();
      const processor = new SkillsProcessor({
        logger,
        outputRoot: testDir,
        toolTarget: "takt",
        global: true,
      });

      const knowledgeDir = join(testDir, TAKT_SKILLS_DIR_PATH);
      await ensureDir(knowledgeDir);
      await writeFileContent(join(knowledgeDir, "runbook.md"), "the old name");
      await writeFileContent(join(knowledgeDir, "renamed.md"), "the new name");

      const generated = new TaktSkill({
        outputRoot: testDir,
        relativeDirPath: TAKT_SKILLS_DIR_PATH,
        dirName: "renamed",
        fileName: "renamed.md",
        body: "the new name",
        global: true,
      });

      const removedCount = await processor.removeOrphanFlatFiles({
        existingFlatFiles: await processor.loadToolFlatFilesToDelete(),
        generatedDirs: [generated],
      });

      expect(removedCount).toBe(1);
      expect(await fileExists(join(knowledgeDir, "runbook.md"))).toBe(false);
      expect(await fileExists(join(knowledgeDir, "renamed.md"))).toBe(true);
    });

    it("should leave every flat file alone when this run generated none", async () => {
      // A takt user who keeps their own notes directly in the facet root, and
      // whose `.rulesync/skills/` holds nothing that targets takt. The root has
      // no source behind it, so it is not rulesync's to empty.
      const logger = createMockLogger();
      const processor = new SkillsProcessor({ logger, outputRoot: testDir, toolTarget: "takt" });

      const knowledgeDir = join(testDir, TAKT_SKILLS_DIR_PATH);
      await ensureDir(knowledgeDir);
      await writeFileContent(join(knowledgeDir, "architecture.md"), "hand-authored");

      const removedCount = await processor.removeOrphanFlatFiles({
        existingFlatFiles: await processor.loadToolFlatFilesToDelete(),
        generatedDirs: [],
      });

      expect(removedCount).toBe(0);
      expect(await fileExists(join(knowledgeDir, "architecture.md"))).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should leave a flat file whose name takt could never have written", async () => {
      // The shared facet root is a place a user may also keep notes of their
      // own. A name rulesync could not have produced — it would have been
      // rejected as a facet name — is nobody's orphan.
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "takt",
      });

      const knowledgeDir = join(testDir, TAKT_SKILLS_DIR_PATH);
      await ensureDir(knowledgeDir);
      await writeFileContent(join(knowledgeDir, "Design Doc.md"), "hand-authored");
      await writeFileContent(join(knowledgeDir, "runbook.md"), "generated once");

      const filesToDelete = await processor.loadToolFlatFilesToDelete();

      expect(filesToDelete.map((file) => file.getDirName())).toEqual(["runbook"]);
    });

    it("should never list a directory-based tool's stray markdown file for deletion", async () => {
      // Only a tool that flattens into a shared root writes a bare `<name>.md`
      // there. For every other tool a Markdown file beside its skill
      // directories is something else entirely, and sweeping it would delete a
      // file rulesync never wrote.
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
      const skillsDir = join(testDir, ".claude", "skills");
      await ensureDir(join(skillsDir, "own-skill"));
      await writeFileContent(join(skillsDir, "own-skill", "SKILL.md"), "x");
      await writeFileContent(join(skillsDir, "README.md"), "not a skill");

      expect(await processor.loadToolFlatFilesToDelete()).toEqual([]);
    });

    it("should never list an importOnlySkillRoots skill for deletion", async () => {
      // The shared `.agents/skills/` tree is read-only for every target that
      // declares it under `importOnlySkillRoots` (junie, vibe, kimi-code):
      // another tool owns those directories, so orphan deletion must skip
      // them. Deletion reads `toolSkillSearchRoots` (primary +
      // `alternativeSkillRoots`) rather than `toolSkillImportRoots`, and this
      // pins that difference — swapping the two would silently start pruning
      // foreign skills. The same roots resolve under the user's home directory
      // in global mode, which is what makes the invariant worth pinning, but
      // this case exercises project scope.
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "junie",
      });
      const junieDir = join(testDir, ".junie", "skills", "own-skill");
      const sharedDir = join(testDir, ".agents", "skills", "foreign-skill");
      await ensureDir(junieDir);
      await ensureDir(sharedDir);
      await writeFileContent(join(junieDir, "SKILL.md"), "x");
      await writeFileContent(join(sharedDir, "SKILL.md"), "y");

      const dirsToDelete = await processor.loadToolDirsToDelete();

      expect(dirsToDelete.map((d) => d.getRelativeDirPath())).toEqual([join(".junie", "skills")]);
      expect(dirsToDelete.map((d) => d.getDirName())).toEqual(["own-skill"]);
    });
  });

  describe("getToolTargets", () => {
    it("should return supported non-simulated project targets by default", () => {
      const targets = SkillsProcessor.getToolTargets();
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsskills",
          "aiassistant",
          "amp",
          "antigravity-cli",
          "antigravity-ide",
          "antigravity-plugin",
          "augmentcode",
          "claudecode",
          "claudecode-plugin",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "copilotcli",
          "cursor",
          "deepagents",
          "factorydroid",
          "goose",
          "grokcli",
          "junie",
          "kilo",
          "kimi-code",
          "kiro",
          "kiro-cli",
          "kiro-ide",
          "musecode",
          "opencode",
          "pi",
          "qwencode",
          "reasonix",
          "replit",
          "roo",
          "zoocode",
          "rovodev",
          "takt",
          "vibe",
          "warp",
          "devin",
          "zed",
          "zcode",
        ]),
      );
    });

    it("should return all targets including simulated when includeSimulated is true", () => {
      const targets = SkillsProcessor.getToolTargets({ includeSimulated: true });
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsmd",
          "agentsskills",
          "aiassistant",
          "amp",
          "antigravity-cli",
          "antigravity-ide",
          "antigravity-plugin",
          "augmentcode",
          "claudecode",
          "claudecode-plugin",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "copilotcli",
          "cursor",
          "deepagents",
          "factorydroid",
          "goose",
          "grokcli",
          "junie",
          "kilo",
          "kimi-code",
          "kiro",
          "kiro-cli",
          "kiro-ide",
          "musecode",
          "opencode",
          "pi",
          "qwencode",
          "reasonix",
          "replit",
          "roo",
          "zoocode",
          "rovodev",
          "takt",
          "vibe",
          "warp",
          "devin",
          "zed",
          "zcode",
        ]),
      );
    });

    it("should return only non-simulated targets when includeSimulated is false", () => {
      const targets = SkillsProcessor.getToolTargets({ includeSimulated: false });
      expect(new Set(targets)).toEqual(
        new Set([
          "agentsskills",
          "aiassistant",
          "amp",
          "antigravity-cli",
          "antigravity-ide",
          "antigravity-plugin",
          "augmentcode",
          "claudecode",
          "claudecode-plugin",
          "claudecode-legacy",
          "cline",
          "codexcli",
          "copilot",
          "copilotcli",
          "cursor",
          "deepagents",
          "factorydroid",
          "goose",
          "grokcli",
          "junie",
          "kilo",
          "kimi-code",
          "kiro",
          "kiro-cli",
          "kiro-ide",
          "musecode",
          "opencode",
          "pi",
          "qwencode",
          "reasonix",
          "replit",
          "roo",
          "zoocode",
          "rovodev",
          "takt",
          "vibe",
          "warp",
          "devin",
          "zed",
          "zcode",
        ]),
      );
    });

    it("should be callable without instance", () => {
      expect(() => SkillsProcessor.getToolTargets()).not.toThrow();
    });
  });

  describe("getToolTargetsSimulated", () => {
    it("should return simulated tool targets", () => {
      const targets = SkillsProcessor.getToolTargetsSimulated();
      expect(new Set(targets)).toEqual(new Set(["agentsmd"]));
    });
  });

  describe("getToolTargetsGlobal", () => {
    it("should return global targets in global mode", () => {
      const targets = SkillsProcessor.getToolTargetsGlobal();
      expect(targets).toEqual([
        "agentsskills",
        "amp",
        "antigravity-cli",
        "antigravity-ide",
        "augmentcode",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "copilot",
        "copilotcli",
        "cursor",
        "deepagents",
        "factorydroid",
        "hermesagent",
        "grokcli",
        "junie",
        "kilo",
        "kimi-code",
        "kiro-cli",
        "kiro-ide",
        "musecode",
        "opencode",
        "pi",
        "qwencode",
        "reasonix",
        "replit",
        "roo",
        "zoocode",
        "rovodev",
        "takt",
        "vibe",
        "warp",
        "devin",
        "zcode",
        "zed",
      ]);
      expect(targets).toEqual(skillsProcessorToolTargetsGlobal);
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return global targets when global option is true", () => {
      const targets = SkillsProcessor.getToolTargets({ global: true });
      expect(targets).toEqual([
        "agentsskills",
        "amp",
        "antigravity-cli",
        "antigravity-ide",
        "augmentcode",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "copilot",
        "copilotcli",
        "cursor",
        "deepagents",
        "factorydroid",
        "hermesagent",
        "grokcli",
        "junie",
        "kilo",
        "kimi-code",
        "kiro-cli",
        "kiro-ide",
        "musecode",
        "opencode",
        "pi",
        "qwencode",
        "reasonix",
        "replit",
        "roo",
        "zoocode",
        "rovodev",
        "takt",
        "vibe",
        "warp",
        "devin",
        "zcode",
        "zed",
      ]);
      expect(targets).toEqual(skillsProcessorToolTargetsGlobal);
    });

    it("should be callable without instance", () => {
      expect(() => SkillsProcessor.getToolTargets({ global: true })).not.toThrow();
    });
  });

  describe("type exports and constants", () => {
    it("should export SkillsProcessorToolTargetSchema", () => {
      expect(SkillsProcessorToolTargetSchema).toBeDefined();
      expect(() => SkillsProcessorToolTargetSchema.parse("claudecode")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("claudecode-legacy")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("kilo")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("kiro")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("opencode")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("roo")).not.toThrow();
      expect(() => SkillsProcessorToolTargetSchema.parse("invalid")).toThrow();
    });
  });

  describe("inheritance from DirFeatureProcessor", () => {
    it("should extend DirFeatureProcessor", () => {
      const processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(SkillsProcessor);
      expect(typeof processor.convertRulesyncDirsToToolDirs).toBe("function");
      expect(typeof processor.convertToolDirsToRulesyncDirs).toBe("function");
      expect(typeof processor.loadRulesyncDirs).toBe("function");
      expect(typeof processor.loadToolDirs).toBe("function");
    });
  });

  describe("writeAiDirs", () => {
    let processor: SkillsProcessor;

    beforeEach(() => {
      processor = new SkillsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "claudecode",
      });
    });

    it("should write skill file with frontmatter that can be read back", async () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
        },
        body: "Test skill content",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);
      expect(toolDirs).toHaveLength(1);

      await processor.writeAiDirs(toolDirs);

      const loadedDirs = await processor.loadToolDirs();
      expect(loadedDirs).toHaveLength(1);

      const loadedSkill = loadedDirs[0] as ClaudecodeSkill;
      expect(loadedSkill.getFrontmatter().name).toBe("test-skill");
      expect(loadedSkill.getFrontmatter().description).toBe("Test skill description");
      expect(loadedSkill.getBody()).toBe("Test skill content");
    });

    it("should write skill file with allowed-tools frontmatter", async () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "tool-skill",
        frontmatter: {
          name: "tool-skill",
          description: "Skill with allowed tools",
          claudecode: {
            "allowed-tools": ["Bash", "Read", "Write"],
          },
        },
        body: "Skill body",
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);
      await processor.writeAiDirs(toolDirs);

      const loadedDirs = await processor.loadToolDirs();
      const loadedSkill = loadedDirs[0] as ClaudecodeSkill;

      expect(loadedSkill.getFrontmatter()["allowed-tools"]).toEqual(["Bash", "Read", "Write"]);
    });

    it("should write supporting files byte for byte", async () => {
      // A PNG header (invalid UTF-8) and a CRLF text file with no trailing
      // newline: both must land on disk exactly as they came in.
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
      const crlfBuffer = Buffer.from("first\r\nsecond   ");
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "asset-skill",
        frontmatter: {
          name: "asset-skill",
          description: "Skill with supporting files",
        },
        body: "Skill body",
        otherFiles: [
          { relativeFilePathToDirPath: "diagram.png", fileBuffer: pngBuffer },
          { relativeFilePathToDirPath: join("data", "fixture.txt"), fileBuffer: crlfBuffer },
        ],
        validate: false,
      });

      const toolDirs = await processor.convertRulesyncDirsToToolDirs([rulesyncSkill]);
      const firstWrite = await processor.writeAiDirs(toolDirs);
      expect(firstWrite.count).toBe(1);

      const skillDir = join(testDir, ".claude", "skills", "asset-skill");
      expect(await readFileBuffer(join(skillDir, "diagram.png"))).toEqual(pngBuffer);
      expect(await readFileBuffer(join(skillDir, "data", "fixture.txt"))).toEqual(crlfBuffer);

      // Writing again finds nothing to do, so the bytes are stable.
      const secondWrite = await processor.writeAiDirs(toolDirs);
      expect(secondWrite.count).toBe(0);
    });
  });
});
