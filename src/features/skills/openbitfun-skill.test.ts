import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { OpenbitfunSkill } from "./openbitfun-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

describe("OpenbitfunSkill", () => {
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
      dirName: "release-checklist",
      frontmatter: {
        name: "release-checklist",
        description: "Run the release checklist",
        targets,
      } as never,
      body: "Check every item before tagging.",
      validate: true,
    });

  it("should use .openbitfun/skills in project scope", () => {
    expect(OpenbitfunSkill.getSettablePaths().relativeDirPath).toBe(join(".openbitfun", "skills"));
  });

  it.each([
    ["linux", join(".local", "share", "openbitfun", "skills")],
    ["darwin", join("Library", "Application Support", "openbitfun", "skills")],
    ["win32", join("AppData", "Roaming", "openbitfun", "skills")],
  ] as const)("should use the %s user skills dir in global scope", (platform, expected) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    expect(OpenbitfunSkill.getSettablePaths({ global: true }).relativeDirPath).toBe(expected);
  });

  it("should write SKILL.md under .openbitfun/skills/<name>", () => {
    const skill = OpenbitfunSkill.fromRulesyncSkill({
      outputRoot: testDir,
      rulesyncSkill: makeRulesyncSkill(["openbitfun"]),
    });

    expect(skill).toBeInstanceOf(OpenbitfunSkill);
    expect(skill.getRelativeDirPath()).toBe(join(".openbitfun", "skills"));
    expect(skill.getDirName()).toBe("release-checklist");
    expect(skill.getFrontmatter()).toMatchObject({
      name: "release-checklist",
      description: "Run the release checklist",
    });
    expect(skill.getMainFile()?.body).toContain("Check every item before tagging.");
  });

  it("should only target openbitfun or wildcard skills", () => {
    expect(OpenbitfunSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["*"]))).toBe(true);
    expect(OpenbitfunSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["openbitfun"]))).toBe(true);
    expect(OpenbitfunSkill.isTargetedByRulesyncSkill(makeRulesyncSkill(["cursor"]))).toBe(false);
  });

  describe("getConfiguredImportRoots", () => {
    it("should add no roots and warn about a moved XDG data home on a global import (issue #3971)", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.stubEnv("HOME_DIR", testDir);
      vi.stubEnv("XDG_DATA_HOME", join("/", "srv", "openbitfun-skills-import-xdg"));
      const logger = createMockLogger();
      try {
        await expect(
          OpenbitfunSkill.getConfiguredImportRoots({ outputRoot: testDir, global: true, logger }),
        ).resolves.toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("$XDG_DATA_HOME"));
    });

    it("should not warn on a project import", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      vi.stubEnv("XDG_DATA_HOME", join("/", "srv", "openbitfun-skills-project-xdg"));
      const logger = createMockLogger();
      try {
        await OpenbitfunSkill.getConfiguredImportRoots({ outputRoot: testDir, logger });
      } finally {
        vi.unstubAllEnvs();
      }

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
