import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { TheiaSkill } from "./theia-skill.js";

describe("TheiaSkill", () => {
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

  const makeRulesyncSkill = ({
    dirName = "test-skill",
    frontmatter = {},
  }: {
    dirName?: string;
    frontmatter?: Record<string, unknown>;
  } = {}) =>
    new RulesyncSkill({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName,
      frontmatter: { name: dirName, description: "A skill", ...frontmatter },
      body: "Skill body",
      validate: true,
    });

  it("should use .agents/skills in the project and .theia/skills globally", () => {
    expect(TheiaSkill.getSettablePaths()).toEqual({ relativeDirPath: join(".agents", "skills") });
    expect(TheiaSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".theia", "skills"),
    });
  });

  it("should write the standard name and description plus theia section keys", () => {
    const skill = TheiaSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill({ frontmatter: { theia: { license: "MIT" } } }),
    });

    expect(skill.getFrontmatter()).toEqual({
      name: "test-skill",
      description: "A skill",
      license: "MIT",
    });
  });

  it("should write the same frontmatter as other .agents/skills writers without a theia section", () => {
    const skill = TheiaSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill({ frontmatter: { "disable-model-invocation": true } }),
    });

    expect(skill.getFrontmatter()).toEqual({ name: "test-skill", description: "A skill" });
  });

  it("should warn about names and descriptions Theia skips", () => {
    const logger = createMockLogger();
    TheiaSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill({
        dirName: "Bad_Skill",
        frontmatter: { description: "x".repeat(1025) },
      }),
      logger,
    });

    const warnings = vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
    expect(warnings.some((w) => w.includes("lowercase letters"))).toBe(true);
    expect(warnings.some((w) => w.includes("1025 characters"))).toBe(true);
  });

  it("should round-trip theia-only keys through the theia section", () => {
    const skill = new TheiaSkill({
      outputRoot: testDir,
      dirName: "test-skill",
      frontmatter: { name: "test-skill", description: "A skill", license: "MIT" },
      body: "Skill body",
    });

    expect(skill.toRulesyncSkill().getFrontmatter()).toMatchObject({
      name: "test-skill",
      description: "A skill",
      theia: { license: "MIT" },
    });
  });
});
