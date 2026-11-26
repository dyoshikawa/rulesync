import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
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

  it("should use the shared .agents/skills root in both scopes", () => {
    expect(TheiaSkill.getSettablePaths()).toEqual({ relativeDirPath: join(".agents", "skills") });
    expect(TheiaSkill.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".agents", "skills"),
    });
  });

  it.each([false, true])(
    "should write exactly what agentsskills writes to the shared root (global: %s)",
    (global) => {
      const rulesyncSkill = makeRulesyncSkill({
        frontmatter: {
          license: "MIT",
          compatibility: "Requires git",
          metadata: { author: "me" },
          agentsskills: { "allowed-tools": ["Read", "Grep"], "disable-model-invocation": true },
        },
      });

      const theia = TheiaSkill.fromRulesyncSkill({ outputRoot: testDir, rulesyncSkill, global });
      const agentsskills = AgentsSkillsSkill.fromRulesyncSkill({
        outputRoot: testDir,
        rulesyncSkill,
        global,
      });

      expect(theia.getRelativeDirPath()).toBe(agentsskills.getRelativeDirPath());
      expect(theia.getFrontmatter()).toEqual(agentsskills.getFrontmatter());
      expect(theia.getFrontmatter()).toMatchObject({
        license: "MIT",
        compatibility: "Requires git",
        "allowed-tools": "Read Grep",
      });
    },
  );

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

  it("should import the standard fields back into the agentsskills section", () => {
    const skill = new TheiaSkill({
      outputRoot: testDir,
      dirName: "test-skill",
      frontmatter: { name: "test-skill", description: "A skill", license: "MIT" },
      body: "Skill body",
    });

    expect(skill.toRulesyncSkill().getFrontmatter()).toMatchObject({
      name: "test-skill",
      description: "A skill",
      agentsskills: { license: "MIT" },
    });
  });
});
