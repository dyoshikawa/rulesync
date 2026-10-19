import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { AndroidstudioSkill } from "./androidstudio-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("AndroidstudioSkill", () => {
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

  it("should use .android-studio/skills for both scopes", () => {
    expect(AndroidstudioSkill.getSettablePaths().relativeDirPath).toBe(
      join(".android-studio", "skills"),
    );
    expect(AndroidstudioSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".android-studio", "skills"),
    );
  });

  it("should write SKILL.md under .android-studio/skills/<name>", () => {
    const skill = AndroidstudioSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["androidstudio"]),
    });

    expect(skill).toBeInstanceOf(AndroidstudioSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".android-studio", "skills"));
    expect(skill.getDirName()).toBe("api-doc-generator");
    expect(skill.getMainFile()?.body).toContain("Document every endpoint.");
  });

  it("should only target androidstudio or wildcard skills", () => {
    expect(AndroidstudioSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(AndroidstudioSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["androidstudio"]))).toBe(
      true,
    );
    expect(AndroidstudioSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });
});
