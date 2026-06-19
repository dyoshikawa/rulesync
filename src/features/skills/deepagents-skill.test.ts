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

    it("should return the user-level path for global mode", () => {
      const paths = DeepagentsSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".deepagents", "deepagents", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create with valid frontmatter", () => {
      const skill = new DeepagentsSkill({
        outputRoot: testDir,
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something useful." },
        body: "## Instructions\n\nDo the thing.",
      });

      expect(skill.getDirName()).toBe("my-skill");
      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getBody()).toBe("## Instructions\n\nDo the thing.");
    });

    it("should create with allowed-tools as a space-delimited string", () => {
      const skill = new DeepagentsSkill({
        outputRoot: testDir,
        dirName: "tool-skill",
        frontmatter: {
          name: "Tool Skill",
          description: "Uses specific tools.",
          "allowed-tools": "read_file write_file",
        },
        body: "Use the tools.",
      });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("read_file write_file");
    });

    it("should not throw on invalid frontmatter when validate=false", () => {
      expect(
        () =>
          new DeepagentsSkill({
            outputRoot: testDir,
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
        outputRoot: testDir,
        dirName: "my-skill",
      });

      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getFrontmatter().description).toBe("A useful skill.");
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should map name and description from rulesync skill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something.", targets: ["*"] },
        body: "Instructions here.",
      });

      const skill = DeepagentsSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter().name).toBe("My Skill");
      expect(skill.getFrontmatter().description).toBe("Does something.");
      expect(skill.getDirName()).toBe("my-skill");
      expect(skill.getBody()).toBe("Instructions here.");
    });

    it("should omit allowed-tools when deepagents frontmatter is absent", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something.", targets: ["*"] },
        body: "Instructions here.",
      });

      const skill = DeepagentsSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()).not.toHaveProperty("allowed-tools");
    });

    it("should serialize allowed-tools as a space-delimited string", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: {
          name: "My Skill",
          description: "Does something.",
          targets: ["*"],
          deepagents: { "allowed-tools": ["Bash", "Read", "Write"] },
        },
        body: "Instructions here.",
      });

      const skill = DeepagentsSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Bash Read Write");
    });

    it("should carry license, compatibility, and metadata through", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: {
          name: "My Skill",
          description: "Does something.",
          targets: ["*"],
          deepagents: {
            license: "MIT",
            compatibility: { "deepagents-version": ">=0.1.0" },
            metadata: { author: "rulesync" },
          },
        },
        body: "Instructions here.",
      });

      const skill = DeepagentsSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill });
      const frontmatter = skill.getFrontmatter();

      expect(frontmatter.license).toBe("MIT");
      expect(frontmatter.compatibility).toEqual({ "deepagents-version": ">=0.1.0" });
      expect(frontmatter.metadata).toEqual({ author: "rulesync" });
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true for deepagents target", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "Skill", description: "Desc.", targets: ["deepagents"] },
        body: "",
      });

      expect(DeepagentsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "my-skill",
        frontmatter: { name: "Skill", description: "Desc.", targets: ["*"] },
        body: "",
      });

      expect(DeepagentsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false for different tool target", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
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
        outputRoot: testDir,
        dirName: "my-skill",
        frontmatter: { name: "My Skill", description: "Does something." },
        body: "Instructions.",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().name).toBe("My Skill");
      expect(rulesyncSkill.getFrontmatter().description).toBe("Does something.");
      expect(rulesyncSkill.getFrontmatter().targets).toEqual(["*"]);
    });

    it("should parse a space-delimited allowed-tools string back into an array", () => {
      const skill = new DeepagentsSkill({
        outputRoot: testDir,
        dirName: "tool-skill",
        frontmatter: {
          name: "Tool Skill",
          description: "Uses tools.",
          "allowed-tools": "Bash Read Write",
        },
        body: "Instructions.",
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter().deepagents?.["allowed-tools"]).toEqual([
        "Bash",
        "Read",
        "Write",
      ]);
    });

    it("should carry license, compatibility, and metadata through", () => {
      const skill = new DeepagentsSkill({
        outputRoot: testDir,
        dirName: "meta-skill",
        frontmatter: {
          name: "Meta Skill",
          description: "Has metadata.",
          license: "MIT",
          compatibility: { "deepagents-version": ">=0.1.0" },
          metadata: { author: "rulesync" },
        },
        body: "Instructions.",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      const deepagents = rulesyncSkill.getFrontmatter().deepagents;

      expect(deepagents?.license).toBe("MIT");
      expect(deepagents?.compatibility).toEqual({ "deepagents-version": ">=0.1.0" });
      expect(deepagents?.metadata).toEqual({ author: "rulesync" });
    });

    it("should accept a string-form compatibility (Agent Skills spec) on import", () => {
      // dcode follows the Agent Skills spec, where `compatibility` is a free-form
      // string. A hand-authored SKILL.md using that form must not be rejected.
      const skill = new DeepagentsSkill({
        outputRoot: testDir,
        dirName: "string-compat-skill",
        frontmatter: {
          name: "String Compat Skill",
          description: "Has string compatibility.",
          compatibility: "deepagents>=0.1.0",
        },
        body: "Instructions.",
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().deepagents?.compatibility).toBe("deepagents>=0.1.0");
    });
  });

  describe("allowed-tools round-trip", () => {
    it("should preserve the canonical array across emit and import", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: ".rulesync/skills",
        dirName: "round-trip-skill",
        frontmatter: {
          name: "Round Trip Skill",
          description: "Round-trips allowed-tools.",
          targets: ["*"],
          deepagents: { "allowed-tools": ["Bash", "Read", "Write"] },
        },
        body: "Instructions.",
      });

      const deepagentsSkill = DeepagentsSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
      });

      // dcode-specific serialization is a space-delimited string.
      expect(deepagentsSkill.getFrontmatter()["allowed-tools"]).toBe("Bash Read Write");

      // Importing back yields the canonical array representation again.
      const roundTripped = deepagentsSkill.toRulesyncSkill();
      expect(roundTripped.getFrontmatter().deepagents?.["allowed-tools"]).toEqual([
        "Bash",
        "Read",
        "Write",
      ]);
    });
  });

  describe("forDeletion", () => {
    it("should create a deletable placeholder skill", () => {
      const skill = DeepagentsSkill.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".deepagents", "skills"),
        dirName: "my-skill",
      });

      expect(skill.getRelativeDirPath()).toBe(join(".deepagents", "skills"));
      expect(skill.getDirName()).toBe("my-skill");
      expect(skill.getBody()).toBe("");
    });
  });
});
