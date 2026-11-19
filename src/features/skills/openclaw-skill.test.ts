import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpenclawSkill } from "./openclaw-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("OpenclawSkill", () => {
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

  const projectSkillsDir = join(".agents", "skills");
  const globalSkillsDir = join(".openclaw", "skills");

  const makeRulesyncSkill = (frontmatter: RulesyncSkillFrontmatterInput) =>
    new RulesyncSkill({
      outputRoot: testDir,
      dirName: "test-skill",
      frontmatter,
      body: "Skill body",
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .agents/skills for project mode and .openclaw/skills for global mode", () => {
      expect(OpenclawSkill.getSettablePaths().relativeDirPath).toBe(projectSkillsDir);
      expect(OpenclawSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        globalSkillsDir,
      );
    });
  });

  describe("fromRulesyncSkill / toRulesyncSkill", () => {
    it("should emit a name/description SKILL.md and round-trip back", () => {
      const rulesyncSkill = makeRulesyncSkill({
        name: "test-skill",
        description: "A test skill",
        targets: ["*"],
      });

      const skill = OpenclawSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      expect(skill.getRelativeDirPath()).toBe(projectSkillsDir);
      expect(skill.getFrontmatter()).toEqual({ name: "test-skill", description: "A test skill" });
      expect(skill.getBody()).toBe("Skill body");

      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter().name).toBe("test-skill");
      expect(back.getFrontmatter().description).toBe("A test skill");
      expect(back.getFrontmatter().openclaw).toBeUndefined();
      expect(back.getBody()).toBe("Skill body");
    });

    it("should write to ~/.openclaw/skills in global mode", () => {
      const rulesyncSkill = makeRulesyncSkill({
        name: "test-skill",
        description: "A test skill",
        targets: ["*"],
      });

      const skill = OpenclawSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global: true,
      });

      expect(skill.getRelativeDirPath()).toBe(globalSkillsDir);
    });

    it("should apply the root invocation flags and metadata, and drop root fields OpenClaw does not read", () => {
      const rulesyncSkill = makeRulesyncSkill({
        name: "test-skill",
        description: "A test skill",
        targets: ["*"],
        license: "MIT",
        metadata: { author: "example-org" },
        "disable-model-invocation": true,
        "user-invocable": false,
      });

      const skill = OpenclawSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "A test skill",
        metadata: { author: "example-org" },
        "disable-model-invocation": true,
        "user-invocable": false,
      });
    });

    it("should let the openclaw section override the root defaults and pass its keys through", () => {
      const rulesyncSkill = makeRulesyncSkill({
        name: "test-skill",
        description: "A test skill",
        targets: ["*"],
        metadata: { author: "example-org" },
        "disable-model-invocation": true,
        "user-invocable": true,
        openclaw: {
          // A stray name/description in the section never wins over the canonical pair.
          name: "other",
          description: "ignored",
          homepage: "https://example.com",
          "command-dispatch": "tool",
          "command-tool": "exec",
          "command-arg-mode": "raw",
          metadata: { openclaw: { os: ["linux"], requires: { bins: ["gh"] } } },
          "disable-model-invocation": false,
          "user-invocable": false,
        },
      });

      const skill = OpenclawSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).toEqual({
        name: "test-skill",
        description: "A test skill",
        homepage: "https://example.com",
        "command-dispatch": "tool",
        "command-tool": "exec",
        "command-arg-mode": "raw",
        metadata: { openclaw: { os: ["linux"], requires: { bins: ["gh"] } } },
        "disable-model-invocation": false,
        "user-invocable": false,
      });
    });

    it("should import every key beyond name/description into the openclaw section", () => {
      const skill = new OpenclawSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "A test skill",
          "user-invocable": false,
          metadata: { openclaw: { always: true } },
          custom: "kept",
        },
        body: "Skill body",
      });

      const back = skill.toRulesyncSkill();
      expect(back.getFrontmatter()["user-invocable"]).toBeUndefined();
      expect(back.getFrontmatter().metadata).toBeUndefined();
      expect(back.getFrontmatter().openclaw).toEqual({
        "user-invocable": false,
        metadata: { openclaw: { always: true } },
        custom: "kept",
      });
    });
  });

  describe("fromDir", () => {
    it("should load a directory-layout SKILL.md", async () => {
      const skillDir = join(testDir, projectSkillsDir, "my-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: my-skill\ndescription: Loaded from disk\nuser-invocable: false\n---\n\nBody here`,
      );

      const skill = await OpenclawSkill.fromDir({
        outputRoot: testDir,
        relativeDirPath: projectSkillsDir,
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "my-skill",
        description: "Loaded from disk",
        "user-invocable": false,
      });
      expect(skill.getBody().trim()).toBe("Body here");
    });

    it("should throw for frontmatter missing the required pair", async () => {
      const skillDir = join(testDir, projectSkillsDir, "broken");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: broken\n---\n\nNo description`,
      );

      await expect(
        OpenclawSkill.fromDir({
          outputRoot: testDir,
          relativeDirPath: projectSkillsDir,
          dirName: "broken",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });

    it("should throw for a non-boolean invocation flag", async () => {
      const skillDir = join(testDir, projectSkillsDir, "flag");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: flag\ndescription: Bad flag\ndisable-model-invocation: maybe\n---\n\nBody`,
      );

      await expect(
        OpenclawSkill.fromDir({
          outputRoot: testDir,
          relativeDirPath: projectSkillsDir,
          dirName: "flag",
        }),
      ).rejects.toThrow(/Invalid frontmatter/);
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should target openclaw for wildcard and explicit targets, not others", () => {
      const make = (targets: ("*" | "openclaw" | "claudecode")[]) =>
        new RulesyncSkill({
          outputRoot: testDir,
          dirName: "s",
          frontmatter: { name: "s", description: "d", targets },
          body: "b",
          validate: false,
        });

      expect(OpenclawSkill.isTargetedByRulesyncSkill(make(["*"]))).toBe(true);
      expect(OpenclawSkill.isTargetedByRulesyncSkill(make(["openclaw"]))).toBe(true);
      expect(OpenclawSkill.isTargetedByRulesyncSkill(make(["claudecode"]))).toBe(false);
    });
  });
});
