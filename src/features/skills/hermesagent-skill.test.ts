import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { getHermesagentGlobalDir } from "../../utils/hermesagent.js";
import { HermesagentSkill } from "./hermesagent-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("HermesagentSkill", () => {
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
    it("should return the Hermes skills directory as relativeDirPath", () => {
      const paths = HermesagentSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(HERMESAGENT_SKILLS_DIR_PATH);
    });
  });

  describe("constructor", () => {
    it("should force the Hermes skills directory even when another relativeDirPath is passed", () => {
      const skill = new HermesagentSkill({
        outputRoot: testDir,
        relativeDirPath: "ignored",
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the Hermes skill.",
        validate: true,
      });

      expect(skill).toBeInstanceOf(HermesagentSkill);
      expect(skill.getRelativeDirPath()).toBe(HERMESAGENT_SKILLS_DIR_PATH);
      expect(skill.getBody()).toBe("This is the body of the Hermes skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should not warn about source allowed-tools entries a hermesagent override replaces", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
          agentsskills: { "allowed-tools": ["Bash(git log)"] },
          hermesagent: { "allowed-tools": "Read" },
        },
        body: "Test body content",
        validate: true,
      });

      const skill = HermesagentSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      expect(skill.getFrontmatter()["allowed-tools"]).toBe("Read");
      expect(logger.warn).not.toHaveBeenCalled();
    });
    it("should keep structured metadata that Hermes reads natively", () => {
      // Hermes resolves `metadata.hermes.*` as structured YAML, so the Agent
      // Skills string-map coercion must not apply on this target.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
          agentsskills: { metadata: { hermes: { requires_toolsets: ["terminal"] } } },
        },
        body: "Test body content",
        validate: true,
      });

      expect(
        HermesagentSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter().metadata,
      ).toEqual({ hermes: { requires_toolsets: ["terminal"] } });
    });

    it("should warn when a hermesagent override reintroduces a non-conformant shape", () => {
      const logger = createMockLogger();
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test skill description",
          agentsskills: { "allowed-tools": ["Read"], compatibility: "fine" },
          hermesagent: { "allowed-tools": ["Read", "Write"], compatibility: { a: "b" } },
        },
        body: "Test body content",
        validate: true,
      });

      HermesagentSkill.fromRulesyncSkill({ rulesyncSkill, logger });

      const warnings = logger.warn.mock.calls.map(([message]) => String(message));
      expect(
        warnings.some((w) => w.includes("`allowed-tools` must be a space-separated string")),
      ).toBe(true);
      expect(warnings.some((w) => w.includes("`compatibility` must be a string"))).toBe(true);
    });
    it("should create an instance routed to the Hermes skills directory", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
          agentsskills: {
            license: "MIT",
            "allowed-tools": ["terminal"],
          },
          hermesagent: {
            name: "Ignored override",
            version: "1.2.3",
            author: "Rulesync",
            platforms: ["darwin", "linux"],
            environments: ["cli"],
            required_environment_variables: ["API_TOKEN"],
            required_credential_files: ["~/.config/example/credentials"],
            metadata: {
              hermes: {
                setup: { script: "scripts/setup.sh" },
                blueprint: { enabled: true },
              },
            },
          },
        },
        body: "Test body content",
        validate: true,
      });

      const skill = HermesagentSkill.fromRulesyncSkill({ rulesyncSkill, global: true });

      expect(skill).toBeInstanceOf(HermesagentSkill);
      expect(skill.getRelativeDirPath()).toBe(HERMESAGENT_SKILLS_DIR_PATH);
      expect(skill.getBody()).toBe("Test body content");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
        license: "MIT",
        // Normalized to the Agent Skills space-separated form, exactly as the
        // native `agentsskills` target writes it from the same rulesync input.
        "allowed-tools": "terminal",
        version: "1.2.3",
        author: "Rulesync",
        platforms: ["darwin", "linux"],
        environments: ["cli"],
        required_environment_variables: ["API_TOKEN"],
        required_credential_files: ["~/.config/example/credentials"],
        metadata: {
          hermes: {
            setup: { script: "scripts/setup.sh" },
            blueprint: { enabled: true },
          },
        },
      });
    });
  });

  describe("toRulesyncSkill", () => {
    it("should normalize a space-separated allowed-tools scalar back to the canonical array", () => {
      // Generation now writes the spec's scalar form, so import has to reverse
      // it or a generate → import round trip rewrites the rulesync source.
      const skill = new HermesagentSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "test-skill",
          description: "Test description",
          "allowed-tools": "Read Write",
        },
        body: "Test body",
        validate: true,
      });

      expect(skill.toRulesyncSkill().getFrontmatter().agentsskills).toEqual({
        "allowed-tools": ["Read", "Write"],
      });
    });
    it("should convert back to a RulesyncSkill", () => {
      const skill = new HermesagentSkill({
        outputRoot: testDir,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
          license: "Apache-2.0",
          compatibility: "Hermes Agent v0.19.0",
          "allowed-tools": ["terminal"],
          version: "2.0.0",
          author: { name: "Rulesync" },
          platforms: ["darwin"],
          environments: ["cli"],
          required_environment_variables: ["API_TOKEN"],
          required_credential_files: ["~/.config/example/credentials"],
          metadata: {
            hermes: {
              config: { mode: "strict" },
              blueprint: { enabled: true },
            },
          },
        },
        body: "Test body",
        validate: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toMatchObject({
        name: "Test Skill",
        description: "Test description",
        agentsskills: {
          license: "Apache-2.0",
          compatibility: "Hermes Agent v0.19.0",
          "allowed-tools": ["terminal"],
        },
        hermesagent: {
          version: "2.0.0",
          author: { name: "Rulesync" },
          platforms: ["darwin"],
          environments: ["cli"],
          required_environment_variables: ["API_TOKEN"],
          required_credential_files: ["~/.config/example/credentials"],
          metadata: {
            hermes: {
              config: { mode: "strict" },
              blueprint: { enabled: true },
            },
          },
        },
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });
});

describe("HermesagentSkill global settable paths", () => {
  const originalHermesHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  it("anchors global paths on the platform profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    expect(HermesagentSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(getHermesagentGlobalDir(), "skills"),
    });
  });

  it("drops the .hermes prefix when HERMES_HOME names the profile root itself", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(HermesagentSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: "skills",
    });
  });
});
