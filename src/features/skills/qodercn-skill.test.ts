import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderSkill } from "./qoder-skill.js";
import { QodercnSkill } from "./qodercn-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("QodercnSkill", () => {
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
      dirName: "doc-writer",
      frontmatter: { name: "doc-writer", description: "Write docs", targets } as never,
      body: "Write docs.",
      validate: true,
    });

  it("should share .qoder/skills in project scope and use ~/.qoder-cn/skills globally", () => {
    expect(QodercnSkill.getSettablePaths().relativeDirPath).toBe(join(".qoder", "skills"));
    expect(QodercnSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder-cn", "skills"),
    );
    expect(QoderSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "skills"),
    );
  });

  it("should be targeted by qodercn only", () => {
    expect(QodercnSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["qodercn"]))).toBe(true);
    expect(QodercnSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["qoder"]))).toBe(false);
    expect(QoderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["qodercn"]))).toBe(false);
  });
});
