import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
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

    it("should fall back to the root-level license/compatibility/metadata when the agentsskills section omits them", () => {
      // The same shared block as the native target, so the root-level fields
      // are normalized the same way — except `metadata`, which Hermes reads
      // structurally.
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "root-fields",
        frontmatter: {
          name: "root-fields",
          description: "Root-level standard fields",
          license: "MIT",
          compatibility: { runtime: "node" },
          metadata: { hermes: { requires_toolsets: ["terminal"] } },
        },
        body: "Body",
        validate: true,
      });

      expect(HermesagentSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter()).toEqual({
        name: "root-fields",
        description: "Root-level standard fields",
        license: "MIT",
        compatibility: "runtime: node",
        metadata: { hermes: { requires_toolsets: ["terminal"] } },
      });
    });

    it("should let the agentsskills section override the root-level license/compatibility/metadata", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "section-wins",
        frontmatter: {
          name: "section-wins",
          description: "Section overrides the root-level fields",
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "root" },
          agentsskills: {
            license: "Apache-2.0",
            compatibility: "Requires jq",
            metadata: { author: "section" },
          },
        },
        body: "Body",
        validate: true,
      });

      const frontmatter = HermesagentSkill.fromRulesyncSkill({ rulesyncSkill }).getFrontmatter();
      expect(frontmatter.license).toBe("Apache-2.0");
      expect(frontmatter.compatibility).toBe("Requires jq");
      expect(frontmatter.metadata).toEqual({ author: "section" });
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

  describe("fromDir", () => {
    it("should warn about an empty description, matching the agentsskills import", async () => {
      // Hermes reads the same `agentsskills` shape, so a diagnostic that fires
      // for one has to fire for the other.
      const skillDir = join(testDir, HERMESAGENT_SKILLS_DIR_PATH, "empty-description-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        ["---", "name: empty-description-skill", 'description: ""', "---", "", "Body."].join("\n"),
      );
      const warnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

      try {
        const skill = await HermesagentSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-description-skill",
        });

        expect(skill.getBody()).toBe("Body.");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("`description` is required and must not be empty"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

describe("HermesagentSkill global settable paths", () => {
  // Pinned as literals rather than re-calling getHermesagentGlobalDir(), so the
  // platform branch itself is asserted and not merely restated.
  const expectedGlobalDir =
    process.platform === "win32" ? join("AppData", "Local", "hermes") : ".hermes";

  const originalHermesHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  it("anchors global paths on the platform profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    expect(HermesagentSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(expectedGlobalDir, "skills"),
    });
  });

  it("drops the .hermes prefix when HERMES_HOME names the profile root itself", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(HermesagentSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: "skills",
    });
  });
});
