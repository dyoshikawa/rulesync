import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  POOL_SHARED_SKILLS_DIR_PATH,
  POOL_SKILLS_GLOBAL_DIR,
  POOL_SKILLS_PROJECT_DIR,
} from "../../constants/pool-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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
    it("writes project skills under .poolside/skills", () => {
      expect(PoolSkill.getSettablePaths().relativeDirPath).toBe(POOL_SKILLS_PROJECT_DIR);
    });

    it("writes global skills under .config/poolside/skills", () => {
      expect(PoolSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        POOL_SKILLS_GLOBAL_DIR,
      );
    });

    it("imports shared skills from .agents/skills without writing there", () => {
      expect(PoolSkill.getSettablePaths().importOnlySkillRoots).toEqual([
        POOL_SHARED_SKILLS_DIR_PATH,
      ]);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a SKILL.md under .poolside/skills in project mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: { name: "review", description: "Reviews a diff" },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(poolSkill.getRelativeDirPath()).toBe(POOL_SKILLS_PROJECT_DIR);
      expect(poolSkill.getFrontmatter()).toEqual({
        name: "review",
        description: "Reviews a diff",
      });
      expect(poolSkill.getBody()).toBe("Skill body");
    });

    it("emits under .config/poolside/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: { name: "review", description: "Reviews a diff" },
        body: "Skill body",
        validate: true,
      });

      const poolSkill = PoolSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });
      expect(poolSkill.getRelativeDirPath()).toBe(POOL_SKILLS_GLOBAL_DIR);
      expect(poolSkill.getGlobal()).toBe(true);
    });
  });

  describe("round-trip", () => {
    it("should preserve packaging metadata through rulesync and back", () => {
      const poolSkill = new PoolSkill({
        outputRoot: testDir,
        relativeDirPath: POOL_SKILLS_PROJECT_DIR,
        dirName: "review",
        frontmatter: {
          name: "review",
          description: "Reviews a diff",
          "allowed-tools": ["Read", "Grep"],
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "rulesync" },
        },
        body: "Skill body",
        validate: true,
      });

      const rulesyncSkill = poolSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().pool).toEqual({
        "allowed-tools": ["Read", "Grep"],
        license: "MIT",
        compatibility: "Requires git",
        metadata: { author: "rulesync" },
      });

      const roundTripped = PoolSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        validate: true,
      });
      expect(roundTripped.getFrontmatter()).toEqual(poolSkill.getFrontmatter());
      expect(roundTripped.getBody()).toBe("Skill body");
    });
  });

  describe("fromDir", () => {
    it("should load from .agents/skills import fallback root", async () => {
      const skillDir = join(testDir, ".agents", "skills", "fallback");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: fallback
description: Fallback skill
---
Fallback body`,
      );

      const poolSkill = await PoolSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "fallback",
      });

      expect(poolSkill.getFrontmatter()).toEqual({
        name: "fallback",
        description: "Fallback skill",
      });
      expect(poolSkill.getBody()).toBe("Fallback body");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      { targets: ["*"], expected: true },
      { targets: ["pool"], expected: true },
      { targets: ["crush"], expected: false },
    ])("targets=$targets -> $expected", ({ targets, expected }) => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "review",
        frontmatter: { name: "review", description: "Reviews a diff", targets },
        body: "Skill body",
        validate: true,
      });

      expect(PoolSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });
});
