import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PoolSkill } from "./pool-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("PoolSkill", () => {
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
    it("uses .poolside/skills in project mode", () => {
      expect(PoolSkill.getSettablePaths().relativeDirPath).toBe(join(".poolside", "skills"));
    });

    it("uses .config/poolside/skills (XDG default) in global mode", () => {
      expect(PoolSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "poolside", "skills"),
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a SKILL.md with name/description frontmatter under .poolside/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(poolSkill.getRelativeDirPath()).toBe(join(".poolside", "skills"));
      expect(poolSkill.getDirName()).toBe("my-skill");
      expect(poolSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
      });
      expect(poolSkill.getBody()).toBe("Skill body");
    });

    it("drops fields Pool does not enforce from the emitted frontmatter", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: {
          name: "my-skill",
          description: "Does a thing",
          license: "MIT",
          compatibility: "Requires git",
          "disable-model-invocation": true,
        },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(poolSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
      });
    });

    it("carries supporting files into the skill directory", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        otherFiles: [
          {
            relativeFilePathToDirPath: join("references", "checklist.md"),
            fileBuffer: Buffer.from("- item"),
          },
        ],
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(poolSkill.getOtherFiles()).toEqual([
        {
          relativeFilePathToDirPath: join("references", "checklist.md"),
          fileBuffer: Buffer.from("- item"),
        },
      ]);
    });

    it("emits under .config/poolside/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });
      expect(poolSkill.getRelativeDirPath()).toBe(join(".config", "poolside", "skills"));
      expect(poolSkill.getGlobal()).toBe(true);
    });

    it("warns when the skill name does not match its directory name", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "other-name", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        validate: true,
        logger,
      });
      // The skill is still written under the canonical directory name.
      expect(poolSkill.getDirName()).toBe("my-skill");
      expect(poolSkill.getFrontmatter().name).toBe("other-name");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('`name` "other-name" does not match its directory name "my-skill"'),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(".poolside/skills/my-skill/SKILL.md"),
      );
    });

    it("does not warn when the skill name matches its directory name", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      PoolSkill.fromRulesyncSkill({ rulesyncSkill, validate: true, logger });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      [["*"], true],
      [["pool"], true],
      [["claudecode"], false],
    ] as const)("targets %j -> %s", (targets, expected) => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: [...targets] },
        body: "b",
        validate: true,
      });
      expect(PoolSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });

  describe("validate", () => {
    it("rejects a SKILL.md without a description", () => {
      expect(
        () =>
          new PoolSkill({
            outputRoot: testDir,
            dirName: "my-skill",
            frontmatter: { name: "my-skill" } as never,
            body: "Skill body",
            validate: true,
          }),
      ).toThrow(/Invalid frontmatter/);
    });
  });

  describe("fromDir / toRulesyncSkill round-trip", () => {
    it("loads a SKILL.md directory and converts back to a RulesyncSkill", async () => {
      const skillDir = join(testDir, ".poolside", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.`,
      );
      await ensureDir(join(skillDir, "references"));
      await writeFileContent(join(skillDir, "references", "checklist.md"), "- item");

      const poolSkill = await PoolSkill.fromDir({
        outputRoot: testDir,
        dirName: "my-skill",
      });
      const rulesyncSkill = poolSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Skill body.");
      expect(
        rulesyncSkill
          .getOtherFiles()
          .map((f) => [f.relativeFilePathToDirPath, f.fileBuffer.toString("utf8")]),
      ).toEqual([[join("references", "checklist.md"), "- item"]]);
    });

    it("keeps unknown Agent Skills keys on an imported SKILL.md", async () => {
      const skillDir = join(testDir, ".poolside", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\nallowed-tools: Bash\n---\n\nSkill body.`,
      );

      const poolSkill = await PoolSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" });
      expect(poolSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
        "allowed-tools": "Bash",
      });
    });

    it("loads from ~/.config/poolside/skills in global mode", async () => {
      const skillDir = join(testDir, ".config", "poolside", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.`,
      );

      const poolSkill = await PoolSkill.fromDir({
        outputRoot: testDir,
        dirName: "my-skill",
        global: true,
      });
      expect(poolSkill.getRelativeDirPath()).toBe(join(".config", "poolside", "skills"));
      expect(poolSkill.toRulesyncSkill().getGlobal()).toBe(true);
    });

    it("throws on a SKILL.md missing the required frontmatter", async () => {
      const skillDir = join(testDir, ".poolside", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), `---\nname: my-skill\n---\n\nBody.`);

      await expect(PoolSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" })).rejects.toThrow(
        /Invalid frontmatter/,
      );
    });
  });

  describe("forDeletion", () => {
    it("builds a non-validated instance at the settable path", () => {
      const poolSkill = PoolSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".poolside", "skills"),
        dirName: "my-skill",
      });
      expect(poolSkill.getRelativeDirPath()).toBe(join(".poolside", "skills"));
      expect(poolSkill.getDirName()).toBe("my-skill");
    });
  });
});
