import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AgentsSkillsSkill", () => {
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

  describe("getSettablePaths", () => {
    it("should return .agents/skills as relativeDirPath", () => {
      const paths = AgentsSkillsSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return the same .agents/skills path in global mode (resolved under home)", () => {
      // The Agent Skills standard defines `~/.agents/skills/` as the personal location.
      const paths = AgentsSkillsSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should carry standard optional frontmatter through the agentsskills section", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        dirName: "std-skill",
        frontmatter: {
          name: "std-skill",
          description: "Standard",
          license: "MIT",
          compatibility: { "agent-skills": ">=1.0.0" },
          metadata: { version: "1.2.3" },
          "allowed-tools": "shell",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().agentsskills).toEqual({
        license: "MIT",
        compatibility: { "agent-skills": ">=1.0.0" },
        metadata: { version: "1.2.3" },
        // Normalized back to the canonical rulesync array on import.
        "allowed-tools": ["shell"],
      });

      const roundTripped = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });
      const fm = roundTripped.getFrontmatter();
      expect(fm.license).toBe("MIT");
      expect(fm["allowed-tools"]).toBe("shell");
      expect(fm.metadata).toEqual({ version: "1.2.3" });
    });

    it("should carry a string compatibility value through the agentsskills section", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        dirName: "string-compat-skill",
        frontmatter: {
          name: "string-compat-skill",
          description: "Standard",
          compatibility: "Requires Python 3.14+ and uv",
        },
        body: "Body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().agentsskills).toEqual({
        compatibility: "Requires Python 3.14+ and uv",
      });

      const roundTripped = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });
      expect(roundTripped.getFrontmatter().compatibility).toBe("Requires Python 3.14+ and uv");
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the agent skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getBody()).toBe("This is the body of the agent skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the agent skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getBody()).toBe("This is the body of the agent skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should import a SKILL.md with a string compatibility value (Agent Skills spec form)", async () => {
      const skillDir = join(testDir, ".agents", "skills", "string-compat-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: string-compat-skill
description: Spec-compliant skill
compatibility: Requires Python 3.14+ and uv
---

Body.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await AgentsSkillsSkill.fromDir({
        outputRoot: testDir,
        dirName: "string-compat-skill",
      });

      expect(skill.getFrontmatter().compatibility).toBe("Requires Python 3.14+ and uv");
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        AgentsSkillsSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "Test body content",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
      });

      expect(agentsSkillsSkill).toBeInstanceOf(AgentsSkillsSkill);
      expect(agentsSkillsSkill.getBody()).toBe("Test body content");
      expect(agentsSkillsSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should serialize allowed-tools, compatibility and metadata into the spec's scalar forms", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill for conformance check.",
          agentsskills: {
            "allowed-tools": ["Read", "Bash(git:*)"],
            compatibility: { runtime: "node", packages: ["jq"] },
            metadata: { version: 1, author: "example-org", tags: ["a", "b"] },
          },
        },
        body: "Body",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill });

      expect(agentsSkillsSkill.getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill for conformance check.",
        "allowed-tools": "Read Bash(git:*)",
        compatibility: 'runtime: node, packages: ["jq"]',
        metadata: { version: "1", author: "example-org", tags: '["a","b"]' },
      });
    });

    it("should leave already-conformant scalar values untouched", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: {
            "allowed-tools": "Bash(git:*) Read",
            compatibility: "Requires Python 3.14+ and uv",
            metadata: { version: "1.0" },
          },
        },
        body: "Body",
        validate: true,
      });

      expect(AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill.",
        "allowed-tools": "Bash(git:*) Read",
        compatibility: "Requires Python 3.14+ and uv",
        metadata: { version: "1.0" },
      });
    });

    it("should warn about every normative name/description violation without failing", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "My_Bad--Name",
        frontmatter: {
          name: "Totally-Different-NAME--x",
          description: "",
        },
        body: "Body",
        validate: true,
      });

      const agentsSkillsSkill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      // Generation still succeeds — import stays lenient per the spec's client guide.
      expect(agentsSkillsSkill).toBeInstanceOf(AgentsSkillsSkill);

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(3);
      expect(warnings.some((w) => w.includes("lowercase letters, digits and single hyphens"))).toBe(
        true,
      );
      expect(
        warnings.some((w) => w.includes('must match its parent directory name "My_Bad--Name"')),
      ).toBe(true);
      expect(
        warnings.some((w) => w.includes("`description` is required and must not be empty")),
      ).toBe(true);
      for (const warning of warnings) {
        // The reported path is rooted at outputRoot so a global-scope skill
        // points at the file that actually gets written.
        expect(warning).toContain(
          join(testDir, ".agents", "skills", "My_Bad--Name", SKILL_FILE_NAME),
        );
      }
    });

    it("should warn when name, description or compatibility exceed their length limits", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "a".repeat(65),
        frontmatter: {
          name: "a".repeat(65),
          description: "d".repeat(1025),
          agentsskills: { compatibility: "c".repeat(501) },
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((w) => w.includes("`name` is 65 characters"))).toBe(true);
      expect(warnings.some((w) => w.includes("`description` is 1025 characters"))).toBe(true);
      expect(warnings.some((w) => w.includes("`compatibility` is 501 characters"))).toBe(true);
    });

    it("should encode a self-referential metadata value instead of throwing", () => {
      // YAML anchors let a hand-written SKILL.md produce a genuinely circular
      // object, which a plain JSON.stringify would reject.
      const circular: Record<string, unknown> = { label: "root" };
      circular.self = circular;

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { metadata: { graph: circular } },
        },
        body: "Body",
        validate: true,
      });

      const metadata = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()
        .metadata as Record<string, string>;
      expect(metadata.graph).toBe('{"label":"root","self":"[repeated reference]"}');
    });

    it("should encode each shared metadata node once so aliases cannot blow up the output", () => {
      // Without this, N levels of YAML aliases expand exponentially: a few
      // hundred bytes of input becomes tens of megabytes of JSON.
      const leaf = { value: "x" };
      const shared = { a: leaf, b: leaf, c: leaf };

      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { metadata: { shared } },
        },
        body: "Body",
        validate: true,
      });

      const metadata = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()
        .metadata as Record<string, string>;
      expect(metadata.shared).toBe(
        '{"a":{"value":"x"},"b":"[repeated reference]","c":"[repeated reference]"}',
      );
    });

    it("should warn when an allowed-tools entry contains whitespace", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { "allowed-tools": ["Read", "Bash(git status)"] },
        },
        body: "Body",
        validate: true,
      });

      const skill = AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Read Bash(git status)");
      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"Bash(git status)" contains whitespace');
    });

    it("should render a YAML timestamp as its ISO form rather than a quoted JSON string", () => {
      // js-yaml resolves `released: 2024-01-01` into a Date; JSON-encoding it
      // would fold its own quotes into the emitted scalar.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: {
            metadata: { released: new Date("2024-01-01T00:00:00.000Z"), stable: true },
          },
        },
        body: "Body",
        validate: true,
      });

      expect(
        AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter().metadata,
      ).toEqual({ released: "2024-01-01T00:00:00.000Z", stable: "true" });
    });

    it("should drop values that normalize to the empty string instead of emitting them", () => {
      // The spec requires `compatibility` to be 1-500 characters when present,
      // and an empty `allowed-tools` says nothing.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { compatibility: {}, "allowed-tools": [] },
        },
        body: "Body",
        validate: true,
      });

      expect(AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "demo-skill",
        description: "Demo skill.",
      });
    });

    it("should warn when an object compatibility exceeds 500 characters only after flattening", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "demo-skill",
        frontmatter: {
          name: "demo-skill",
          description: "Demo skill.",
          agentsskills: { compatibility: { runtime: "n".repeat(500) } },
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(warnings.some((w) => w.includes("`compatibility` is 509 characters"))).toBe(true);
    });

    it("should not warn for a fully conformant skill", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "pdf-processing",
        frontmatter: {
          name: "pdf-processing",
          description: "Extract PDF text. Use when handling PDFs.",
        },
        body: "Body",
        validate: true,
      });

      AgentsSkillsSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("isTargetedByRulesyncSkill", () => {
    it("should return true when targets includes '*'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "all-targets-skill",
        frontmatter: {
          name: "All Targets Skill",
          description: "Skill for all targets",
          targets: ["*"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'agentsskills'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "agentsskills-skill",
        frontmatter: {
          name: "AgentsSkills Skill",
          description: "Skill for agentsskills",
          targets: ["copilot", "agentsskills"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'agentsskills'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "claudecode-only-skill",
        frontmatter: {
          name: "ClaudeCode Only Skill",
          description: "Skill for claudecode only",
          targets: ["claudecode"],
        },
        body: "Test body",
        validate: true,
      });

      expect(AgentsSkillsSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to RulesyncSkill", () => {
      const skill = new AgentsSkillsSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill).toBeInstanceOf(RulesyncSkill);
      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getDirName()).toBe("cleanup");
      expect(skill.getRelativeDirPath()).toBe(join(".agents", "skills"));
      expect(skill.getGlobal()).toBe(false);
    });

    it("should use process.cwd() as default outputRoot", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "cleanup",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill).toBeInstanceOf(AgentsSkillsSkill);
      expect(skill.getOutputRoot()).toBe(testDir);
    });

    it("should create instance with empty frontmatter for deletion", () => {
      const skill = AgentsSkillsSkill.forDeletion({
        dirName: "to-delete",
        relativeDirPath: join(".agents", "skills"),
      });

      expect(skill.getFrontmatter()).toEqual({
        name: "",
        description: "",
      });
      expect(skill.getBody()).toBe("");
    });
  });
});
