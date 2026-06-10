import { join } from "node:path";

import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, toPosixPath, writeFileContent } from "../../utils/file.js";
import { CodexCliSkill } from "./codexcli-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

const OPENAI_YAML_PATH = join("agents", "openai.yaml");

function findOpenaiYaml(skill: CodexCliSkill): string | undefined {
  const file = skill
    .getOtherFiles()
    .find((f) => toPosixPath(f.relativeFilePathToDirPath) === toPosixPath(OPENAI_YAML_PATH));
  return file ? file.fileBuffer.toString("utf-8") : undefined;
}

describe("CodexCliSkill", () => {
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
    it("should return .agents/skills as relativeDirPath in project mode", () => {
      const paths = CodexCliSkill.getSettablePaths();
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });

    it("should return .agents/skills as relativeDirPath in global mode", () => {
      const paths = CodexCliSkill.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(join(".agents", "skills"));
    });
  });

  describe("constructor", () => {
    it("should create instance with valid content in global mode", () => {
      const skill = new CodexCliSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the codex cli skill.",
        validate: true,
        global: true,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getBody()).toBe("This is the body of the codex cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance with valid content in project mode", () => {
      const skill = new CodexCliSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test skill description",
        },
        body: "This is the body of the codex cli skill.",
        validate: true,
        global: false,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getBody()).toBe("This is the body of the codex cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance with metadata.short-description", () => {
      const skill = new CodexCliSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          metadata: {
            "short-description": "User-facing description",
          },
        },
        body: "This is the body of the codex cli skill.",
        validate: true,
        global: false,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
        metadata: {
          "short-description": "User-facing description",
        },
      });
    });
  });

  describe("fromDir", () => {
    it("should create instance from valid skill directory in global mode", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the codex cli skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await CodexCliSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: true,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getBody()).toBe("This is the body of the codex cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance from valid skill directory in project mode", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: Test skill description
---

This is the body of the codex cli skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await CodexCliSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getBody()).toBe("This is the body of the codex cli skill.");
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance with metadata.short-description from directory", async () => {
      const skillDir = join(testDir, ".agents", "skills", "test-skill");
      await ensureDir(skillDir);
      const skillContent = `---
name: Test Skill
description: AI-facing description
metadata:
  short-description: User-facing description
---

This is the body of the codex cli skill.`;
      await writeFileContent(join(skillDir, SKILL_FILE_NAME), skillContent);

      const skill = await CodexCliSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      expect(skill).toBeInstanceOf(CodexCliSkill);
      expect(skill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
        metadata: {
          "short-description": "User-facing description",
        },
      });
    });

    it("should throw error when SKILL.md not found", async () => {
      const skillDir = join(testDir, ".agents", "skills", "empty-skill");
      await ensureDir(skillDir);

      await expect(
        CodexCliSkill.fromDir({
          outputRoot: testDir,
          dirName: "empty-skill",
          global: true,
        }),
      ).rejects.toThrow(/SKILL\.md not found/);
    });
  });

  describe("fromRulesyncSkill", () => {
    it("should create instance from RulesyncSkill in global mode", () => {
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

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: true,
      });

      expect(codexCliSkill).toBeInstanceOf(CodexCliSkill);
      expect(codexCliSkill.getBody()).toBe("Test body content");
      expect(codexCliSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should create instance from RulesyncSkill in project mode", () => {
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

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: false,
      });

      expect(codexCliSkill).toBeInstanceOf(CodexCliSkill);
      expect(codexCliSkill.getBody()).toBe("Test body content");
      expect(codexCliSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test skill description",
      });
    });

    it("should convert codexcli.short-description to metadata.short-description", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          codexcli: {
            "short-description": "User-facing description",
          },
        },
        body: "Test body content",
        validate: true,
      });

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({
        rulesyncSkill,
        validate: true,
        global: false,
      });

      expect(codexCliSkill).toBeInstanceOf(CodexCliSkill);
      expect(codexCliSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
        metadata: {
          "short-description": "User-facing description",
        },
      });
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

      expect(CodexCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return true when targets includes 'codexcli'", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "codexcli-skill",
        frontmatter: {
          name: "CodexCli Skill",
          description: "Skill for codexcli",
          targets: ["copilot", "codexcli"],
        },
        body: "Test body",
        validate: true,
      });

      expect(CodexCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(true);
    });

    it("should return false when targets does not include 'codexcli'", () => {
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

      expect(CodexCliSkill.isTargetedByRulesyncSkill(rulesyncSkill)).toBe(false);
    });
  });

  describe("toRulesyncSkill", () => {
    it("should convert to a RulesyncSkill", () => {
      const skill = new CodexCliSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "Test description",
        },
        body: "Test body",
        validate: true,
        global: true,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "Test description",
        targets: ["*"],
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });

    it("should convert metadata.short-description to codexcli.short-description", () => {
      const skill = new CodexCliSkill({
        outputRoot: testDir,
        relativeDirPath: join(".agents", "skills"),
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          metadata: {
            "short-description": "User-facing description",
          },
        },
        body: "Test body",
        validate: true,
        global: false,
      });

      const rulesyncSkill = skill.toRulesyncSkill();

      expect(rulesyncSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
        targets: ["*"],
        codexcli: {
          "short-description": "User-facing description",
        },
      });
      expect(rulesyncSkill.getBody()).toBe("Test body");
    });
  });

  describe("agents/openai.yaml sidecar", () => {
    it("should emit agents/openai.yaml from codexcli interface/policy/dependencies", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          codexcli: {
            interface: {
              display_name: "Test Skill",
              short_description: "User-facing description",
              default_prompt: "Do the thing",
            },
            policy: {
              allow_implicit_invocation: false,
            },
            dependencies: {
              tools: [
                {
                  type: "mcp",
                  value: "example",
                  description: "Example MCP tool",
                  transport: "http",
                  url: "https://mcp.example.com/mcp",
                },
              ],
            },
          },
        },
        body: "Test body content",
        validate: true,
      });

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });

      // SKILL.md frontmatter stays name + description only
      expect(codexCliSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
      });

      const yamlContent = findOpenaiYaml(codexCliSkill);
      expect(yamlContent).toBeDefined();
      expect(load(yamlContent ?? "")).toEqual({
        interface: {
          display_name: "Test Skill",
          short_description: "User-facing description",
          default_prompt: "Do the thing",
        },
        policy: {
          allow_implicit_invocation: false,
        },
        dependencies: {
          tools: [
            {
              type: "mcp",
              value: "example",
              description: "Example MCP tool",
              transport: "http",
              url: "https://mcp.example.com/mcp",
            },
          ],
        },
      });
    });

    it("should route the legacy short-description to interface.short_description when the sidecar is emitted", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          codexcli: {
            "short-description": "User-facing description",
            policy: { allow_implicit_invocation: false },
          },
        },
        body: "Test body content",
        validate: true,
      });

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });

      // Legacy short-description still lands in SKILL.md metadata for backward compatibility
      expect(codexCliSkill.getFrontmatter()).toEqual({
        name: "Test Skill",
        description: "AI-facing description",
        metadata: { "short-description": "User-facing description" },
      });

      expect(load(findOpenaiYaml(codexCliSkill) ?? "")).toEqual({
        interface: { short_description: "User-facing description" },
        policy: { allow_implicit_invocation: false },
      });
    });

    it("should NOT emit agents/openai.yaml for a lone short-description", () => {
      const rulesyncSkill = new RulesyncSkill({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
        dirName: "test-skill",
        frontmatter: {
          name: "Test Skill",
          description: "AI-facing description",
          codexcli: { "short-description": "User-facing description" },
        },
        body: "Test body content",
        validate: true,
      });

      const codexCliSkill = CodexCliSkill.fromRulesyncSkill({ rulesyncSkill, validate: true });
      expect(findOpenaiYaml(codexCliSkill)).toBeUndefined();
    });

    it("should read agents/openai.yaml back into the codexcli section on import", async () => {
      const skillDir = join(testDir, ".codex", "skills", "test-skill");
      await ensureDir(join(skillDir, "agents"));
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---\nname: Test Skill\ndescription: AI-facing description\n---\n\nBody.`,
      );
      await writeFileContent(
        join(skillDir, "agents", "openai.yaml"),
        [
          "interface:",
          "  display_name: Test Skill",
          "  short_description: User-facing description",
          "policy:",
          "  allow_implicit_invocation: false",
          "",
        ].join("\n"),
      );

      const skill = await CodexCliSkill.fromDir({
        outputRoot: testDir,
        dirName: "test-skill",
        global: false,
      });

      const rulesyncSkill = skill.toRulesyncSkill();
      expect(rulesyncSkill.getFrontmatter().codexcli).toEqual({
        interface: {
          display_name: "Test Skill",
          short_description: "User-facing description",
        },
        policy: {
          allow_implicit_invocation: false,
        },
      });

      // The sidecar is consumed as structured data, not carried as a passthrough file.
      expect(
        rulesyncSkill
          .getOtherFiles()
          .some((f) => toPosixPath(f.relativeFilePathToDirPath) === toPosixPath(OPENAI_YAML_PATH)),
      ).toBe(false);
    });
  });
});
