import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ZeroSkill } from "./zero-skill.js";

describe("ZeroSkill", () => {
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
      dirName: "run-benchmarks",
      frontmatter: {
        name: "run-benchmarks",
        description: "Run the benchmark suite",
        targets,
      } as never,
      body: "Run make bench.",
      validate: true,
    });

  it.each(["linux", "darwin", "win32"] as const)(
    "should use ~/.local/share/zero/skills on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      expect(ZeroSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".local", "share", "zero", "skills"),
      );
    },
  );

  it("should write SKILL.md under the Zero skills root", () => {
    const skill = ZeroSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["zero"]),
      global: true,
    });

    expect(skill).toBeInstanceOf(ZeroSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".local", "share", "zero", "skills"));
    expect(skill.getDirName()).toBe("run-benchmarks");
    expect(skill.getFrontmatter()).toMatchObject({
      name: "run-benchmarks",
      description: "Run the benchmark suite",
    });
  });

  it("should only target zero or wildcard skills", () => {
    expect(ZeroSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(ZeroSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["zero"]))).toBe(true);
    expect(ZeroSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
