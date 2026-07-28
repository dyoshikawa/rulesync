import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { GROKCLI_SKILLS_DIR_PATH } from "../../constants/grokcli-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { GrokcliSkill } from "./grokcli-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("GrokcliSkill", () => {
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
    it("discovers skills under .grok/skills", () => {
      expect(GrokcliSkill.getSettablePaths().relativeDirPath).toBe(".grok/skills");
    });

    it("uses the same relative path in global mode (resolved by outputRoot)", () => {
      expect(GrokcliSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(".grok/skills");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("creates a SKILL.md skill with name and description under .grok/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user", targets: ["*"] },
        body: "Say hello.",
      });

      const grokcliSkill = GrokcliSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = grokcliSkill.getFrontmatter();

      expect(frontmatter.name).toBe("greet");
      expect(frontmatter.description).toBe("Greet the user");
      expect(grokcliSkill.getDirName()).toBe("greet");
      expect(grokcliSkill.getBody()).toBe("Say hello.");
    });
  });

  describe("toRulesyncSkill", () => {
    it("converts back to a rulesync skill targeting all tools", () => {
      const grokcliSkill = new GrokcliSkill({
        outputRoot: testDir,
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user" },
        body: "Say hello.",
      });

      const rulesyncSkill = grokcliSkill.toRulesyncSkill();
      const frontmatter = rulesyncSkill.getFrontmatter();

      expect(frontmatter.name).toBe("greet");
      expect(frontmatter.description).toBe("Greet the user");
      expect(frontmatter.targets).toEqual(["*"]);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("targets skills for grokcli and for all tools (*)", () => {
      const grok = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["grokcli"] },
        body: "b",
      });
      const all = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["*"] },
        body: "b",
      });
      const other = new RulesyncSkill({
        dirName: "s",
        frontmatter: { name: "s", description: "d", targets: ["cursor"] },
        body: "b",
      });

      expect(GrokcliSkill.isTargetedByRulesyncSkill(grok)).toBe(true);
      expect(GrokcliSkill.isTargetedByRulesyncSkill(all)).toBe(true);
      expect(GrokcliSkill.isTargetedByRulesyncSkill(other)).toBe(false);
    });
  });

  describe("validate", () => {
    it("succeeds for a well-formed skill", () => {
      const grokcliSkill = new GrokcliSkill({
        outputRoot: testDir,
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user" },
        body: "Say hello.",
        validate: false,
      });

      const result = grokcliSkill.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("global mode output", () => {
    // Unit-level global coverage: with `global: true` the adapter targets the
    // canonical `.grok/skills` root (relative to the supplied outputRoot) and
    // round-trips a SKILL.md. The actual `~/` home-directory resolution happens
    // in the SkillsProcessor and is covered by the e2e skills global-mode
    // matrix; here outputRoot stands in for the resolved home directory.
    let homeDir: string;
    let homeCleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ testDir: homeDir, cleanup: homeCleanup } = await setupTestDirectory({ home: true }));
    });

    afterEach(async () => {
      await homeCleanup();
    });

    it("generates a global skill into <outputRoot>/.grok/skills/<name>/SKILL.md and reads it back", async () => {
      // outputRoot stands in for the resolved home directory; the adapter writes
      // `<outputRoot>/.grok/skills/<name>/SKILL.md` in global mode.
      const rulesyncSkill = new RulesyncSkill({
        dirName: "greet",
        frontmatter: { name: "greet", description: "Greet the user", targets: ["*"] },
        body: "Say hello.",
      });

      const grokcliSkill = GrokcliSkill.fromRulesyncSkill({
        outputRoot: homeDir,
        rulesyncSkill,
        global: true,
      });

      // The skill targets the canonical `.grok/skills` root for both project and
      // global modes; the global location differs only via outputRoot.
      expect(grokcliSkill.getRelativeDirPath()).toBe(GROKCLI_SKILLS_DIR_PATH);
      expect(grokcliSkill.getGlobal()).toBe(true);

      // Write the generated SKILL.md to its resolved global location.
      const skillDir = join(homeDir, GROKCLI_SKILLS_DIR_PATH, grokcliSkill.getDirName());
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        stringifyFrontmatter(grokcliSkill.getBody(), grokcliSkill.getFrontmatter()),
      );

      // Read it back from the pseudo-home directory in global mode.
      const readBack = await GrokcliSkill.fromDir({
        outputRoot: homeDir,
        dirName: "greet",
        global: true,
      });

      expect(readBack.getGlobal()).toBe(true);
      expect(readBack.getRelativeDirPath()).toBe(GROKCLI_SKILLS_DIR_PATH);
      expect(readBack.getDirName()).toBe("greet");
      expect(readBack.getBody()).toBe("Say hello.");
      const frontmatter = readBack.getFrontmatter();
      expect(frontmatter.name).toBe("greet");
      expect(frontmatter.description).toBe("Greet the user");
    });
  });
});

function buildGrokcliSkill(frontmatter: Record<string, unknown>): GrokcliSkill {
  return GrokcliSkill.fromRulesyncSkill({
    rulesyncSkill: new RulesyncSkill({
      relativeDirPath: ".rulesync/skills",
      dirName: "sample",
      frontmatter: { name: "sample", description: "Sample", targets: ["*"], ...frontmatter },
      body: "Body.",
    }),
  });
}

describe("GrokcliSkill invocation flags", () => {
  it("carries the shared flags Grok honours", () => {
    // A skill with `user-invocable: false` is hidden from the skill tool, and
    // `disable-model-invocation: true` blocks auto-invocation.
    const frontmatter = buildGrokcliSkill({
      "user-invocable": false,
      "disable-model-invocation": true,
    }).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBe(false);
    expect(frontmatter["disable-model-invocation"]).toBe(true);
  });

  it("lets the grokcli section override the shared default", () => {
    const frontmatter = buildGrokcliSkill({
      "disable-model-invocation": true,
      grokcli: { "disable-model-invocation": false },
    }).getFrontmatter();

    expect(frontmatter["disable-model-invocation"]).toBe(false);
  });

  it("takes a restriction stated only in the grokcli section", () => {
    // The direction that matters: the section is the only place the flag is set,
    // so reading the root alone would drop the restriction entirely.
    const frontmatter = buildGrokcliSkill({
      grokcli: { "user-invocable": false },
    }).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBe(false);
  });

  it("omits both when neither is set", () => {
    const frontmatter = buildGrokcliSkill({}).getFrontmatter();

    expect(frontmatter["user-invocable"]).toBeUndefined();
    expect(frontmatter["disable-model-invocation"]).toBeUndefined();
  });

  it("reads both back on import", () => {
    const skill = new GrokcliSkill({
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
    // Into the `grokcli` section: the root is the shared default for every tool
    // that honours these flags, so importing there would apply Grok's setting
    // to Claude Code, Cursor, Zed and the rest.
    expect(imported.grokcli).toEqual({
      "user-invocable": false,
      "disable-model-invocation": true,
    });
    expect(imported["user-invocable"]).toBeUndefined();
    expect(imported["disable-model-invocation"]).toBeUndefined();
  });
});
