import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";
import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import {
  getInstalledSourceRuleNames,
  getInstalledSourceSkillNames,
  resolveAndFetchSources,
} from "../../lib/sources.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { addCommand } from "./add.js";

vi.mock("../../lib/sources.js");

describe("addCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    logger = createMockLogger();
    vi.mocked(getInstalledSourceSkillNames).mockResolvedValue([]);
    vi.mocked(getInstalledSourceRuleNames).mockResolvedValue([]);
    vi.mocked(resolveAndFetchSources).mockResolvedValue({
      fetchedSkillCount: 2,

      fetchedRuleCount: 0,
      sourcesProcessed: 1,
      failedSourceCount: 0,
    });
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("should append a source, preserve comments, and install only the added source", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  // Keep this project comment.
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    // Keep this source comment.
    { "source": "owner/existing" },
  ],
}
`,
    );

    await addCommand(logger, {
      source: "anthropics/skills",
      skills: ["skill-creator"],
    });

    const updatedContent = await readFileContent(configPath);
    expect(updatedContent).toContain("// Keep this project comment.");
    expect(updatedContent).toContain("// Keep this source comment.");
    const parsed = parseJsonc(updatedContent) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([
      { source: "owner/existing" },
      { source: "anthropics/skills", skills: ["skill-creator"] },
    ]);
    expect(getInstalledSourceSkillNames).toHaveBeenCalledWith({
      sources: [{ source: "owner/existing" }],
      projectRoot: testDir,
      logger,
    });
    expect(getInstalledSourceRuleNames).toHaveBeenCalledWith({
      sources: [{ source: "owner/existing" }],
      projectRoot: testDir,
      logger,
    });
    expect(resolveAndFetchSources).toHaveBeenCalledWith({
      sources: [{ source: "anthropics/skills", skills: ["skill-creator"] }],
      projectRoot: testDir,
      options: {
        token: undefined,
        updateSources: true,
        preserveUnlistedLockEntries: true,
        requireResolvedSkills: true,
        requireResolvedRules: false,
        reservedSkillNames: [],
        reservedRuleNames: [],
      },
      logger,
    });
    expect(logger.success).toHaveBeenCalledWith(
      'Added "anthropics/skills" to rulesync.jsonc and installed 2 skill(s) and 0 rule(s).',
    );
  });

  it("should add a rule-only source with an independent rules path", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  "targets": ["claudecode"],
  "features": ["rules"]
}
`,
    );
    vi.mocked(resolveAndFetchSources).mockResolvedValue({
      fetchedSkillCount: 0,
      fetchedRuleCount: 1,
      sourcesProcessed: 1,
      failedSourceCount: 0,
    });

    await addCommand(logger, {
      source: "owner/rules",
      rules: ["testing-guidelines"],
      rulesPath: "exports/rules",
    });

    const parsed = parseJsonc(await readFileContent(configPath)) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([
      {
        source: "owner/rules",
        rules: ["testing-guidelines"],
        rulesPath: "exports/rules",
      },
    ]);
    expect(resolveAndFetchSources).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          requireResolvedSkills: false,
          requireResolvedRules: true,
        }),
      }),
    );
  });

  it("should create the sources property when it is absent", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    await writeFileContent(
      configPath,
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );

    await addCommand(logger, { source: "owner/new" });

    const parsed = parseJsonc(await readFileContent(configPath)) as { sources: SourceEntry[] };
    expect(parsed.sources).toEqual([{ source: "owner/new" }]);
  });

  it("should reject a duplicate normalized source without modifying the config", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "https://github.com/Owner/Repo.git" }]
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(/already declared/);

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a duplicate shared by the GitHub and git transports", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "owner/repo", "transport": "github" }]
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(
      addCommand(logger, {
        source: "https://github.com/owner/repo.git",
        transport: "git",
      }),
    ).rejects.toThrow(/already declared/);

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a missing configuration file", async () => {
    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Run 'rulesync init' first/,
    );
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject invalid JSONC without modifying the config", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
}
`;
    await writeFileContent(configPath, originalContent);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Failed to parse rulesync\.jsonc/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should roll back the edit when rulesync.local.jsonc overrides sources", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [{ "source": "owner/base" }]
}
`;
    await writeFileContent(configPath, originalContent);
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      `{
  "sources": [{ "source": "owner/local" }]
}
`,
    );

    await expect(addCommand(logger, { source: "owner/new" })).rejects.toThrow(
      /rulesync\.local\.jsonc.*overrides sources/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a source already declared by the local config without editing the base", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`;
    await writeFileContent(configPath, originalContent);
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      `{
  "sources": [{ "source": "owner/local" }]
}
`,
    );

    await expect(addCommand(logger, { source: "owner/local" })).rejects.toThrow(
      /already declared in the effective configuration/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a config symlink that resolves outside the project root", async () => {
    const projectRoot = join(testDir, "project");
    const outsideConfigPath = join(testDir, "outside.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`;
    await ensureDir(projectRoot);
    await writeFileContent(outsideConfigPath, originalContent);
    await symlink(outsideConfigPath, join(projectRoot, "rulesync.jsonc"));
    vi.mocked(process.cwd).mockReturnValue(projectRoot);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /must resolve inside the project root/,
    );

    expect(await readFileContent(outsideConfigPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a lockfile symlink without modifying its target", async () => {
    const projectRoot = join(testDir, "project");
    const outsideLockPath = join(testDir, "outside.lock");
    await ensureDir(projectRoot);
    await writeFileContent(
      join(projectRoot, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );
    await writeFileContent(outsideLockPath, "outside lock\n");
    await symlink(outsideLockPath, join(projectRoot, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH));
    vi.mocked(process.cwd).mockReturnValue(projectRoot);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Refusing to write through a symbolic link/,
    );

    expect(await readFileContent(outsideLockPath)).toBe("outside lock\n");
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a curated tree containing a symbolic link", async () => {
    const projectRoot = join(testDir, "project");
    const outsideSkillDir = join(testDir, "outside-skill");
    const curatedPath = join(projectRoot, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    await ensureDir(outsideSkillDir);
    await writeFileContent(
      join(projectRoot, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );
    await ensureDir(curatedPath);
    await symlink(outsideSkillDir, join(curatedPath, "escaped"));
    vi.mocked(process.cwd).mockReturnValue(projectRoot);

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /tree containing a symbolic link/,
    );

    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject a curated path that is not a directory", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const curatedPath = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    await writeFileContent(
      configPath,
      `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
    );
    await writeFileContent(curatedPath, "not a directory\n");

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      /Expected a directory at writable path/,
    );

    expect(await readFileContent(curatedPath)).toBe("not a directory\n");
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should reject source URLs containing credentials", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`;
    await writeFileContent(configPath, originalContent);
    const credentials = ["user", "secret"].join(":");

    await expect(
      addCommand(logger, {
        source: `https://${credentials}@example.com/owner/repo.git`,
        transport: "git",
      }),
    ).rejects.toThrow(/must not contain credentials/);

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(resolveAndFetchSources).not.toHaveBeenCalled();
  });

  it("should restore the manifest and report a failed install", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const sourcesLockPath = join(testDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
    const npmSourcesLockPath = join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);
    const existingSkillPath = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "existing",
      "SKILL.md",
    );
    const addedSkillPath = join(
      testDir,
      RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
      "added",
      "SKILL.md",
    );
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`;
    await writeFileContent(configPath, originalContent);
    await writeFileContent(sourcesLockPath, "original lock\n");
    await writeFileContent(existingSkillPath, "original skill\n");
    vi.mocked(resolveAndFetchSources).mockImplementation(async () => {
      await writeFileContent(sourcesLockPath, "updated lock\n");
      await writeFileContent(npmSourcesLockPath, "new npm lock\n");
      await writeFileContent(existingSkillPath, "modified skill\n");
      await writeFileContent(addedSkillPath, "added skill\n");
      return {
        fetchedSkillCount: 1,

        fetchedRuleCount: 0,
        sourcesProcessed: 1,
        failedSourceCount: 1,
      };
    });

    await expect(addCommand(logger, { source: "owner/unavailable" })).rejects.toThrow(
      /Failed to install.*restored rulesync\.jsonc/,
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
    expect(await readFileContent(sourcesLockPath)).toBe("original lock\n");
    expect(await fileExists(npmSourcesLockPath)).toBe(false);
    expect(await readFileContent(existingSkillPath)).toBe("original skill\n");
    expect(await fileExists(addedSkillPath)).toBe(false);
  });

  it("should restore the manifest when source resolution rejects", async () => {
    const configPath = join(testDir, "rulesync.jsonc");
    const originalContent = `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`;
    await writeFileContent(configPath, originalContent);
    vi.mocked(resolveAndFetchSources).mockRejectedValue(new Error("Lockfile write failed"));

    await expect(addCommand(logger, { source: "owner/repo" })).rejects.toThrow(
      "Lockfile write failed",
    );

    expect(await readFileContent(configPath)).toBe(originalContent);
  });
});
