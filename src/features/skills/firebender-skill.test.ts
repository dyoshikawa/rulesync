import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderSkill } from "./firebender-skill.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";

describe("FirebenderSkill", () => {
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

  const makeRulesyncSkill = (targets: RulesyncSkillFrontmatterInput["targets"]) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "daily-report",
      frontmatter: {
        name: "daily-report",
        description: "Prepare a daily report",
        targets,
      },
      body: "Summarize my TODO items.",
      validate: true,
    });

  const makeRulesyncSkillWithFrontmatter = (extra: Partial<RulesyncSkillFrontmatterInput>) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: "daily-report",
      frontmatter: {
        name: "daily-report",
        description: "Prepare a daily report",
        targets: ["firebender"],
        ...extra,
      },
      body: "Summarize my TODO items.",
      validate: true,
    });

  it("should resolve .firebender/skills for both scopes", () => {
    expect(FirebenderSkill.getSettablePaths().relativeDirPath).toBe(join(".firebender", "skills"));
    expect(FirebenderSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".firebender", "skills"),
    );
  });

  it("should be targeted by firebender and wildcard skills only", () => {
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["firebender"]))).toBe(true);
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(FirebenderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });

  it("should write a SKILL.md with name and description into .firebender/skills", () => {
    const skill = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["firebender"]),
    });

    expect(skill).toBeInstanceOf(FirebenderSkill);
    expect(skill.getDirPath()).toBe(join(testDir, ".firebender", "skills", "daily-report"));
    expect(skill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(skill.getBody()).toBe("Summarize my TODO items.");
  });

  it("should import a skill from .firebender/skills back into rulesync", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "skills", "daily-report", "SKILL.md"),
      "---\nname: daily-report\ndescription: Prepare a daily report\n---\n\nSummarize my TODO items.\n",
    );

    const skill = await FirebenderSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    const rulesyncSkill = skill.toRulesyncSkill();

    expect(skill).toBeInstanceOf(FirebenderSkill);
    expect(rulesyncSkill.getFrontmatter()).toMatchObject({
      name: "daily-report",
      description: "Prepare a daily report",
    });
    expect(rulesyncSkill.getBody()).toBe("Summarize my TODO items.");
  });

  it("should write the firebender section verbatim on top of the Agent Skills fields", () => {
    const skill = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        license: "MIT",
        firebender: {
          version: "1.0.0",
          autoTrigger: false,
          projectTypes: ["android", "kotlin"],
          icon: "icon.svg",
          "future-key": "kept",
        },
      }),
    });

    expect(skill.getFrontmatter()).toEqual({
      name: "daily-report",
      description: "Prepare a daily report",
      license: "MIT",
      version: "1.0.0",
      autoTrigger: false,
      projectTypes: ["android", "kotlin"],
      icon: "icon.svg",
      "future-key": "kept",
    });
  });

  it("should fall back to the root disable-model-invocation and let the firebender section override it", () => {
    const fromRoot = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({ "disable-model-invocation": true }),
    });
    expect(fromRoot.getFrontmatter()["disable-model-invocation"]).toBe(true);

    const overridden = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        "disable-model-invocation": true,
        firebender: { "disable-model-invocation": false },
      }),
    });
    expect(overridden.getFrontmatter()["disable-model-invocation"]).toBe(false);
  });

  it("should ignore Agent Skills standard keys in the firebender section with a warning", () => {
    const logger = createMockLogger();
    const skill = FirebenderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      logger,
      rulesyncSkill: makeRulesyncSkillWithFrontmatter({
        agentsskills: { license: "MIT" },
        firebender: { license: "Apache-2.0", metadata: { a: "b" }, icon: "icon.png" },
      }),
    });

    expect(skill.getFrontmatter()).toEqual({
      name: "daily-report",
      description: "Prepare a daily report",
      license: "MIT",
      icon: "icon.png",
    });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings.some((message) => message.includes('"license", "metadata"'))).toBe(true);
  });

  it("should import Firebender-specific keys into the firebender section", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "skills", "daily-report", "SKILL.md"),
      [
        "---",
        "name: daily-report",
        "description: Prepare a daily report",
        "license: MIT",
        "version: 1.0.0",
        "autoTrigger: false",
        "disable-model-invocation: true",
        "projectTypes: android",
        "icon: icon.svg",
        "---",
        "Summarize my TODO items.",
        "",
      ].join("\n"),
    );

    const skill = await FirebenderSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    const rulesyncFrontmatter = skill.toRulesyncSkill().getFrontmatter();

    expect(rulesyncFrontmatter.agentsskills).toEqual({ license: "MIT" });
    expect(rulesyncFrontmatter.firebender).toEqual({
      version: "1.0.0",
      autoTrigger: false,
      "disable-model-invocation": true,
      projectTypes: "android",
      icon: "icon.svg",
    });
    expect(rulesyncFrontmatter).not.toHaveProperty("disable-model-invocation");
  });

  it("should not add a firebender section when the SKILL.md has only standard keys", async () => {
    await writeFileContent(
      join(testDir, ".firebender", "skills", "daily-report", "SKILL.md"),
      "---\nname: daily-report\ndescription: Prepare a daily report\n---\nBody\n",
    );

    const skill = await FirebenderSkill.fromDir({ outputRoot: testDir, dirName: "daily-report" });
    expect(skill.toRulesyncSkill().getFrontmatter()).not.toHaveProperty("firebender");
  });
});
