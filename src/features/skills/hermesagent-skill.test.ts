import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
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
        "allowed-tools": ["terminal"],
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
