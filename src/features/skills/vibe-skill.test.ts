import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { VibeSkill, VibeSkillFrontmatterSchema } from "./vibe-skill.js";

describe("VibeSkill", () => {
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

  it("should validate Vibe skill frontmatter fields", () => {
    const result = VibeSkillFrontmatterSchema.parse({
      name: "review",
      description: "Review changes",
      license: "MIT",
      compatibility: "Node 22+",
      "user-invocable": true,
      "allowed-tools": ["read_file", "grep"],
    });

    expect(result["user-invocable"]).toBe(true);
    expect(result["allowed-tools"]).toEqual(["read_file", "grep"]);
  });

  it("should expose primary and fallback import roots", () => {
    expect(VibeSkill.getSettablePaths()).toEqual({
      relativeDirPath: join(".vibe", "skills"),
      alternativeSkillRoots: [join(".agents", "skills")],
    });
    expect(VibeSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".vibe", "skills"),
    });
  });

  it("should convert a rulesync skill to .vibe/skills/<name>/SKILL.md", () => {
    const rulesyncSkill = new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "review",
      frontmatter: {
        name: "review",
        description: "Review changes",
        targets: ["vibe"],
        vibe: {
          license: "MIT",
          compatibility: "Node 22+",
          "user-invocable": true,
          "allowed-tools": ["read_file"],
        },
      },
      body: "Review the diff.",
      validate: true,
    });

    const vibeSkill = VibeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
    });

    expect(vibeSkill.getRelativeDirPath()).toBe(join(".vibe", "skills"));
    expect(vibeSkill.getDirName()).toBe("review");
    expect(vibeSkill.getFrontmatter()).toMatchObject({
      name: "review",
      description: "Review changes",
      license: "MIT",
      "user-invocable": true,
      "allowed-tools": ["read_file"],
    });
    expect(vibeSkill.getBody()).toBe("Review the diff.");
  });

  it("should import a Vibe skill into rulesync with a vibe metadata section", () => {
    const vibeSkill = new VibeSkill({
      outputRoot: testDir,
      relativeDirPath: join(".vibe", "skills"),
      dirName: "review",
      frontmatter: {
        name: "review",
        description: "Review changes",
        license: "MIT",
        "user-invocable": true,
        "allowed-tools": ["read_file"],
      },
      body: "Review the diff.",
    });

    const rulesyncSkill = vibeSkill.toRulesyncSkill();

    expect(rulesyncSkill.getRelativeDirPath()).toBe(RULESYNC_SKILLS_RELATIVE_DIR_PATH);
    expect(rulesyncSkill.getFrontmatter()).toMatchObject({
      name: "review",
      description: "Review changes",
      targets: ["*"],
      vibe: {
        license: "MIT",
        "user-invocable": true,
        "allowed-tools": ["read_file"],
      },
    });
  });

  it("should pick up root-level user-invocable when vibe section omits it", () => {
    const rulesyncSkill = new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "root-user-invocable",
      frontmatter: {
        name: "root-user-invocable",
        description: "Root user-invocable",
        targets: ["vibe"],
        "user-invocable": false,
      },
      body: "Body",
    });

    const vibeSkill = VibeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
    });

    expect(vibeSkill.getFrontmatter()["user-invocable"]).toBe(false);
  });

  it("should let the vibe section override the root-level user-invocable value", () => {
    const rulesyncSkill = new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "user-invocable-override",
      frontmatter: {
        name: "user-invocable-override",
        description: "Vibe overrides user-invocable",
        targets: ["vibe"],
        "user-invocable": true,
        vibe: {
          "user-invocable": false,
        },
      },
      body: "Body",
    });

    const vibeSkill = VibeSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill,
    });

    expect(vibeSkill.getFrontmatter()["user-invocable"]).toBe(false);
  });

  it("should load from .agents/skills import fallback when requested by the processor", async () => {
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

    const vibeSkill = await VibeSkill.fromDir({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "skills"),
      dirName: "fallback",
    });

    expect(vibeSkill.getRelativeDirPath()).toBe(join(".agents", "skills"));
    expect(vibeSkill.getFrontmatter().name).toBe("fallback");
    expect(vibeSkill.getBody()).toBe("Fallback body");
  });
});
