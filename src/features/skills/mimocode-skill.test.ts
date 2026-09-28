import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { MimocodeSkill } from "./mimocode-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("MimocodeSkill", () => {
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
      dirName: "test-skill",
      frontmatter: {
        name: "test-skill",
        description: "Test skill description",
        targets,
        mimocode: { "allowed-tools": ["Bash"], license: "MIT" },
        opencode: { "allowed-tools": ["Read"] },
      } as never,
      body: "Test body",
      validate: true,
    });

  it("should resolve project and global settable paths under the mimocode dirs", () => {
    expect(MimocodeSkill.getSettablePaths().relativeDirPath).toBe(join(".mimocode", "skills"));
    expect(MimocodeSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "mimocode", "skills"),
    );
  });

  it("should be targeted by mimocode and wildcard skills only", () => {
    expect(MimocodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["mimocode"]))).toBe(true);
    expect(MimocodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(MimocodeSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["opencode"]))).toBe(false);
  });

  it("should read the mimocode section and round-trip it on import", () => {
    const skill = MimocodeSkill.fromRulesyncSkill({
      rulesyncSkill: makeRulesyncSkill(["mimocode"]),
    });

    expect(skill).toBeInstanceOf(MimocodeSkill);
    expect(skill.getFrontmatter()["allowed-tools"]).toEqual(["Bash"]);
    expect(skill.getFrontmatter().license).toBe("MIT");
    expect(skill.toRulesyncSkill().getFrontmatter().mimocode).toEqual({
      "allowed-tools": ["Bash"],
      license: "MIT",
    });
  });
});
