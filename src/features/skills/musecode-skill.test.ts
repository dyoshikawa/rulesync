import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { MusecodeSkill } from "./musecode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("MusecodeSkill", () => {
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
    it("uses .agents/skills in project mode", () => {
      expect(MusecodeSkill.getSettablePaths().relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("uses .config/muse/skills (XDG default) in global mode", () => {
      expect(MusecodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "muse", "skills"),
      );
    });
  });

  describe("fromRulesyncSkill", () => {
    it("emits a SKILL.md with name/description frontmatter under .agents/skills", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const musecodeSkill = MusecodeSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(musecodeSkill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(musecodeSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
      });
      expect(musecodeSkill.getBody()).toBe("Skill body");
    });

    it("emits under .config/muse/skills in global mode", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "my-skill",
        frontmatter: { name: "my-skill", description: "Does a thing" },
        body: "Skill body",
        validate: true,
      });

      const musecodeSkill = MusecodeSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });
      expect(musecodeSkill.getRelativeDirPath()).toBe(join(".config", "muse", "skills"));
    });
  });

  describe("Agent Skills packaging fields", () => {
    const makeSkill = (frontmatter: Record<string, unknown>) =>
      new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo",
        frontmatter: { name: "demo", description: "Demo", ...frontmatter },
        body: "b",
        validate: true,
      });

    it("emits the root-level license, compatibility and metadata", () => {
      const musecodeSkill = MusecodeSkill.fromRulesyncSkill({
        rulesyncSkill: makeSkill({
          license: "MIT",
          compatibility: "Requires git",
          metadata: { "display-name": "Demo Skill" },
        }),
      });
      expect(musecodeSkill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        license: "MIT",
        compatibility: "Requires git",
        metadata: { "display-name": "Demo Skill" },
      });
    });

    it("lets the musecode section override the root values outright", () => {
      const musecodeSkill = MusecodeSkill.fromRulesyncSkill({
        rulesyncSkill: makeSkill({
          license: "MIT",
          metadata: { author: "root" },
          musecode: { license: "Apache-2.0", metadata: { "display-name": "Muse Demo" } },
        }),
        global: true,
      });
      expect(musecodeSkill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        license: "Apache-2.0",
        metadata: { "display-name": "Muse Demo" },
      });
    });

    it("writes the same packaging fields as agentsskills to the shared .agents/skills root", () => {
      const rulesyncSkill = makeSkill({
        license: "MIT",
        compatibility: { requires: "git" },
        metadata: { "display-name": "Demo Skill", version: 2 },
      });
      const musecodeSkill = MusecodeSkill.fromRulesyncSkill({ rulesyncSkill });
      const agentsSkill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(musecodeSkill.getRelativeDirPath()).toBe(agentsSkill.getRelativeDirPath());
      expect(musecodeSkill.getFrontmatter()).toEqual(agentsSkill.getFrontmatter());
    });

    it("round-trips the packaging fields through the musecode section on import", async () => {
      const skillDir = join(testDir, ".agents", "skills", "demo");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: demo\ndescription: Demo\nlicense: MIT\nmetadata:\n  display-name: Demo Skill\n---\n\nBody.`,
      );

      const musecodeSkill = await MusecodeSkill.fromDir({ outputRoot: testDir, dirName: "demo" });
      const rulesyncSkill = musecodeSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "demo",
        description: "Demo",
        targets: ["*"],
        musecode: { license: "MIT", metadata: { "display-name": "Demo Skill" } },
      });

      const regenerated = MusecodeSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(regenerated.getFrontmatter()).toEqual(musecodeSkill.getFrontmatter());
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it.each([
      [["*"], true],
      [["musecode"], true],
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
      expect(MusecodeSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(expected);
    });
  });

  describe("fromDir / toRulesyncSkill round-trip", () => {
    it("loads a SKILL.md directory and converts back to a RulesyncSkill", async () => {
      const skillDir = join(testDir, ".agents", "skills", "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Does a thing\n---\n\nSkill body.`,
      );

      const musecodeSkill = await MusecodeSkill.fromDir({
        outputRoot: testDir,
        dirName: "my-skill",
      });
      const rulesyncSkill = musecodeSkill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Does a thing",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Skill body.");
    });
  });
});
