import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderSkill } from "./qoder-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("QoderSkill", () => {
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

  it("should use .qoder/skills for both scopes", () => {
    expect(QoderSkill.getSettablePaths().relativeDirPath).toBe(join(".qoder", "skills"));
    expect(QoderSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".qoder", "skills"),
    );
  });

  it("should write SKILL.md under .qoder/skills/<name>", () => {
    const skill = QoderSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["qoder"]),
    });

    expect(skill).toBeInstanceOf(QoderSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".qoder", "skills"));
    expect(skill.getDirName()).toBe("api-doc-generator");
    expect(skill.getMainFile()?.body).toContain("Document every endpoint.");
  });

  it("should only target qoder or wildcard skills", () => {
    expect(QoderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(QoderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["qoder"]))).toBe(true);
    expect(QoderSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
