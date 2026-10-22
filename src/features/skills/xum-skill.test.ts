import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { XumSkill } from "./xum-skill.js";

describe("XumSkill", () => {
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

  const makeRulesyncSkill = (targets: string[]) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "api-doc-generator",
      frontmatter: {
        name: "api-doc-generator",
        description: "Generate API documentation",
        targets,
      } as never,
      body: "Document every endpoint.",
      validate: true,
    });

  it("should use .xum/skills for both scopes", () => {
    expect(XumSkill.getSettablePaths().relativeDirPath).toBe(join(".xum", "skills"));
    expect(XumSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".xum", "skills"),
    );
  });

  it("should write SKILL.md under .xum/skills/<name>", () => {
    const skill = XumSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["xum"]),
    });

    expect(skill).toBeInstanceOf(XumSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".xum", "skills"));
    expect(skill.getDirName()).toBe("api-doc-generator");
    expect(skill.getMainFile()?.body).toContain("Document every endpoint.");
  });

  it("should only target xum or wildcard skills", () => {
    expect(XumSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(XumSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["xum"]))).toBe(true);
    expect(XumSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
  const makeRulesyncSkillWithFrontmatter = (frontmatter: Record<string, unknown>) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "api-doc-generator",
      frontmatter: {
        name: "api-doc-generator",
        description: "Generate API documentation",
        targets: ["*"],
        ...frontmatter,
      } as never,
      body: "Document every endpoint.",
      validate: true,
    });

  it("should write the xum section verbatim on top of the Agent Skills fields", () => {
    const skill = XumSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        license: "MIT",
        xum: {
          paths: ["src/api/**", "*.sql"],
          advertise: false,
          "user-invocable": false,
          "argument-hint": "[endpoint]",
          when_to_use: "When documenting an endpoint",
          "future-key": "kept",
          name: "ignored-name",
        },
      }),
    });

    expect(skill.getFrontmatter()).toEqual({
      name: "api-doc-generator",
      description: "Generate API documentation",
      license: "MIT",
      paths: ["src/api/**", "*.sql"],
      advertise: false,
      "user-invocable": false,
      "argument-hint": "[endpoint]",
      when_to_use: "When documenting an endpoint",
      "future-key": "kept",
    });
  });

  it("should fall back to the root invocation gates and let the xum section override them", () => {
    const fromRoot = XumSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        "disable-model-invocation": true,
        "user-invocable": false,
      }),
    });
    expect(fromRoot.getFrontmatter()).toMatchObject({
      "disable-model-invocation": true,
      "user-invocable": false,
    });

    const overridden = XumSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        "disable-model-invocation": true,
        xum: { "disable-model-invocation": false },
      }),
    });
    expect(overridden.getFrontmatter()["disable-model-invocation"]).toBe(false);
  });

  it("should not take Claude Code-only paths into the Xum frontmatter", () => {
    const skill = XumSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({ claudecode: { paths: ["src/**"] } }),
    });
    expect(skill.getFrontmatter()).not.toHaveProperty("paths");
  });

  it("should import Xum-specific keys into the xum section and standard ones into agentsskills", async () => {
    const skillDir = join(testDir, ".xum", "skills", "api-doc-generator");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: api-doc-generator",
        "description: Generate API documentation",
        "license: MIT",
        "paths: src/api/**, *.sql",
        "user-invocable: false",
        "when_to_use: When documenting an endpoint",
        "---",
        "Document every endpoint.",
        "",
      ].join("\n"),
    );

    const skill = await XumSkill.fromDir({ outputRoot: testDir, dirName: "api-doc-generator" });
    const rulesyncFrontmatter = skill.toRulesyncSkill().getFrontmatter();

    expect(rulesyncFrontmatter.agentsskills).toEqual({ license: "MIT" });
    expect(rulesyncFrontmatter.xum).toEqual({
      paths: "src/api/**, *.sql",
      "user-invocable": false,
      when_to_use: "When documenting an endpoint",
    });
    expect(rulesyncFrontmatter).not.toHaveProperty("user-invocable");
  });

  it("should not add a xum section when the SKILL.md has only standard keys", async () => {
    const skillDir = join(testDir, ".xum", "skills", "api-doc-generator");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: api-doc-generator\ndescription: Generate API documentation\n---\nBody\n",
    );

    const skill = await XumSkill.fromDir({ outputRoot: testDir, dirName: "api-doc-generator" });
    expect(skill.toRulesyncSkill().getFrontmatter()).not.toHaveProperty("xum");
  });
});
