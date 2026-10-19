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
});
