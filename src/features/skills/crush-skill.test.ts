import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CRUSH_SKILLS_GLOBAL_DIR, CRUSH_SKILLS_PROJECT_DIR } from "../../constants/crush-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CrushSkill } from "./crush-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("CrushSkill", () => {
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
    it("discovers skills under .crush/skills in project mode", () => {
      expect(CrushSkill.getSettablePaths().relativeDirPath).toBe(CRUSH_SKILLS_PROJECT_DIR);
    });

    it("discovers skills under .config/crush/skills in global mode", () => {
      expect(CrushSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        CRUSH_SKILLS_GLOBAL_DIR,
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a SKILL.md with name/description frontmatter under .crush/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const crushSkill = CrushSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(crushSkill.getRelativeDirPath()).toBe(CRUSH_SKILLS_PROJECT_DIR);
      expect(crushSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
      });
      expect(crushSkill.getBody()).toBe("Skill body");
    });

    it("emits under .config/crush/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const crushSkill = CrushSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });
      expect(crushSkill.getRelativeDirPath()).toBe(CRUSH_SKILLS_GLOBAL_DIR);
      expect(crushSkill.getGlobal()).toBe(true);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      [["*"], true],
      [["crush"], true],
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
      expect(CrushSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });

  describe("validate", () => {
    it("succeeds for a well-formed skill", () => {
      const crushSkill = new CrushSkill({
        outputRoot: testDir,
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user" },
        body: "Say hello.",
        validate: false,
      });

      const result = crushSkill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("forDeletion", () => {
    it("creates a minimal instance for deletion", () => {
      const skill = CrushSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: CRUSH_SKILLS_PROJECT_DIR,
        dirName: "gone",
      });

      expect(skill.getDirName()).toBe("gone");
      expect(skill.getGlobal()).toBe(false);
    });
  });

  describe("fromDir / toRulesyncSkill round-trip", () => {
    it("loads a SKILL.md directory and converts back to a RulesyncSkill", async () => {
      const skillDir = join(testDir, CRUSH_SKILLS_PROJECT_DIR, "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.`,
      );

      const crushSkill = await CrushSkill.fromDir({ outputRoot: testDir, dirName: "my-skill" });
      const rulesyncSkill = crushSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Skill body.");
    });
  });
});

function buildCrushSkill(frontmatter: Record<string, unknown>): CrushSkill {
  return CrushSkill.fromRulesyncSkill({
    rulesyncSkill: new RulesyncSkill({
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "sample",
      frontmatter: { name: "sample", description: "Sample", targets: ["*"], ...frontmatter },
      body: "Body.",
    }),
  });
}

describe("CrushSkill invocation flags", () => {
  it("carries the shared flags Crush honours", () => {
    // A skill with `user-invocable: false` is hidden from the skill tool, and
    // `disable-model-invocation: true` blocks auto-invocation.
    const frontmatter = buildCrushSkill({
      "user-invocable": false,
      "disable-model-invocation": true,
    }).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBe(false);
    expect(frontmatter["disable-model-invocation"]).toBe(true);
  });

  it("lets the crush section override the shared default", () => {
    const frontmatter = buildCrushSkill({
      "disable-model-invocation": true,
      crush: { "disable-model-invocation": false },
    }).getFrontmatter();

    expect(frontmatter["disable-model-invocation"]).toBe(false);
  });

  it("takes a restriction stated only in the crush section", () => {
    const frontmatter = buildCrushSkill({
      crush: { "user-invocable": false },
    }).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBe(false);
  });

  it("omits both when neither is set", () => {
    const frontmatter = buildCrushSkill({}).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBeUndefined();
    expect(frontmatter["disable-model-invocation"]).toBeUndefined();
  });

  it("reads both back on import into the crush section", () => {
    const skill = new CrushSkill({
      dirName: "sample",
      frontmatter: {
        name: "sample",
        description: "Sample",
        "user-invocable": false,
        "disable-model-invocation": true,
      },
      body: "Body.",
    });

    const imported = skill.toRulesyncSkill().getFrontmatter();
    expect(imported.crush).toEqual({
      "user-invocable": false,
      "disable-model-invocation": true,
    });
    expect(imported["user-invocable"]).toBeUndefined();
    expect(imported["disable-model-invocation"]).toBeUndefined();
  });
});

describe("CrushSkill packaging metadata", () => {
  it("carries license/compatibility/metadata from the root frontmatter", () => {
    const frontmatter = buildCrushSkill({
      license: "MIT",
      compatibility: "Requires git",
      metadata: { author: "root" },
    }).getFrontmatter();

    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.compatibility).toBe("Requires git");
    expect(frontmatter.metadata).toEqual({ author: "root" });
  });

  it("lets the crush section override the root-level license/compatibility/metadata", () => {
    const frontmatter = buildCrushSkill({
      license: "MIT",
      compatibility: "Requires git",
      metadata: { author: "root" },
      crush: {
        license: "Apache-2.0",
        compatibility: "Requires jq",
        metadata: { author: "section" },
      },
    }).getFrontmatter();

    expect(frontmatter.license).toBe("Apache-2.0");
    expect(frontmatter.compatibility).toBe("Requires jq");
    expect(frontmatter.metadata).toEqual({ author: "section" });
  });

  it("carries the packaging fields into the crush section on import", () => {
    const skill = new CrushSkill({
      dirName: "with-meta",
      frontmatter: {
        name: "with-meta",
        description: "Desc",
        license: "MIT",
        compatibility: "Requires Python 3.14+ and uv",
        metadata: { author: "rulesync" },
      },
      body: "Body",
    });

    const rulesync = skill.toRulesyncSkill();
    expect(rulesync.getFrontmatter().crush).toEqual({
      license: "MIT",
      compatibility: "Requires Python 3.14+ and uv",
      metadata: { author: "rulesync" },
    });

    const roundTripped = CrushSkill.fromRulesyncSkill({
      outputRoot: process.cwd(),
      rulesyncSkill: rulesync,
      validate: true,
    });
    const fm = roundTripped.getFrontmatter();
    expect(fm.license).toBe("MIT");
    expect(fm.compatibility).toBe("Requires Python 3.14+ and uv");
    expect(fm.metadata).toEqual({ author: "rulesync" });
  });

  it("coerces an object compatibility and non-string metadata to the shapes Crush's Go struct requires", () => {
    // Crush's `Skill` struct types `Compatibility` as a bare string and
    // `Metadata` as `map[string]string`; its `yaml.Unmarshal` fails the whole
    // document on a type mismatch, so both must be flattened/stringified
    // before being written.
    const frontmatter = buildCrushSkill({
      compatibility: { runtime: "node", packages: ["jq"] },
      metadata: { version: 1, released: new Date("2024-01-01T00:00:00.000Z") },
    }).getFrontmatter();

    expect(frontmatter.compatibility).toBe('runtime: node, packages: ["jq"]');
    expect(frontmatter.metadata).toEqual({
      version: "1",
      released: "2024-01-01T00:00:00.000Z",
    });
  });

  it("drops an object compatibility that flattens to the empty string instead of writing an empty value", () => {
    const frontmatter = buildCrushSkill({
      compatibility: {},
    }).getFrontmatter();

    expect(frontmatter.compatibility).toBeUndefined();
  });
});
