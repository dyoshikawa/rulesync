import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DeepagentsSkill } from "./deepagents-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("DeepagentsSkill", () => {
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
    it("should return .deepagents/skills", () => {
      const paths = DeepagentsSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".deepagents", "skills"));
    });

    it("should throw when global mode requested", () => {
      expect(() => DeepagentsSkill.getSettablePaths({ global: true })).toThrow(
        "DeepagentsSkill does not support global mode.",
      );
    });
  });

  describe("constructor", () => {
    it("should create with valid frontmatter", () => {
      const skill = new DeepagentsSkill({
        baseDir: testDir,
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something useful." },
        body: "## Instructions\n\nDo the thing.",
      });

      expect(skill.getDirName()).toBe("my-skill");
      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getBody()).toBe("## Instructions\n\nDo the thing.");
    });

    it("should create with allowed-tools", () => {
      const skill = new DeepagentsSkill({
        baseDir: testDir,
        dirName: "tool-skill",
        frontmatter: {
          name: "Tool Skill",
          description: "Uses specific tools.",
          "allowed-tools": ["read_file", "write_file"],
        },
        body: "Use the tools.",
      });

      expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["read_file", "write_file"]);
    });

    it("should throw on invalid frontmatter when validate=true", () => {
      expect(
        () =>
          new DeepagentsSkill({
            baseDir: testDir,
            dirName: "bad-skill",
            frontmatter: { name: "", description: "" },
            body: "",
            validate: false,
          }),
      ).not.toThrow();
    });
  });

  describe("fromDir", () => {
    it("should load skill from .deepagents/skills/<name>/SKILL.md", async () => {
      const skillDir = join(testDir, ".deepagents", "skills", "my-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: My Skill
description: A useful skill.
---

## Instructions

Do the thing.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await DeepagentsSkill.fromDir({
        baseDir: testDir,
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getFrontmatter().description).toBe("A useful skill.");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should map name and description from rulesync skill", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something.", targets: ["*"] },
        body: "Instructions here.",
      });

      const skill = DeepagentsSkill.fromRulesyncSkill({ baseDir: testDir, rulesyncSkill });

      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getFrontmatter().description).toBe("Does something.");
      expect(skill.getDirName()).toBe("my-skill");
      expect(skill.getBody()).toBe("Instructions here.");
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for deepagents target", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "Skill", description: "Desc.", targets: ["deepagents"] },
        body: "",
      });

      expect(DeepagentsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "Skill", description: "Desc.", targets: ["*"] },
        body: "",
      });

      expect(DeepagentsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false for different tool target", () => {
      const rulesyncSkill = new RulesyncSkill({
        baseDir: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "Skill", description: "Desc.", targets: ["claudecode"] },
        body: "",
      });

      expect(DeepagentsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to rulesync skill with targets wildcard", () => {
      const skill = new DeepagentsSkill({
        baseDir: testDir,
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something." },
        body: "Instructions.",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().name).toBe("My Skill");
      expect(rulesyncSkill.getFrontmatter().description).toBe("Does something.");
      expect(rulesyncSkill.getFrontmatter().targets).toEqual(["*"]);
    });
  });
});
