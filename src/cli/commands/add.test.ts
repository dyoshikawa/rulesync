import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceEntry } from "../../config/config.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_CHECKS_RELATIVE_DIR_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_JSONC_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_MCP_JSONC_RELATIVE_FILE_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_JSONC_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { RulesyncSkill } from "../../features/skills/rulesync-skill.js";
import { RulesyncSubagent } from "../../features/subagents/rulesync-subagent.js";
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

  describe("feature scaffolding", () => {
    it.each([
      {
        source: "rule",
        name: "overview.md",
        relativeFilePath: join(RULESYNC_RULES_RELATIVE_DIR_PATH, "overview.md"),
        expectedContent: "# Project Overview",
      },
      {
        source: "command",
        name: "deploy.md",
        relativeFilePath: join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "deploy.md"),
        expectedContent: "Run the Deploy workflow",
      },
      {
        source: "subagent",
        name: "reviewer",
        relativeFilePath: join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "reviewer.md"),
        expectedContent: 'name: "reviewer"',
      },
      {
        source: "skill",
        name: "security.md",
        relativeFilePath: join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "security", SKILL_FILE_NAME),
        expectedContent: 'name: "security"',
      },
      {
        source: "check",
        name: "security",
        relativeFilePath: join(RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
        expectedContent: "severity: medium",
      },
    ])(
      "should scaffold the named $source feature",
      async ({ source, name, relativeFilePath, expectedContent }) => {
        await addCommand(logger, { source, name });

        expect(await readFileContent(join(testDir, relativeFilePath))).toContain(expectedContent);
        expect(logger.success).toHaveBeenCalledWith(`Created ${relativeFilePath}`);
        expect(resolveAndFetchSources).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        source: "mcp",
        relativeFilePath: RULESYNC_MCP_RELATIVE_FILE_PATH,
        expectedContent: '"mcpServers"',
      },
      {
        source: "hooks",
        relativeFilePath: RULESYNC_HOOKS_RELATIVE_FILE_PATH,
        expectedContent: '"hooks"',
      },
      {
        source: "ignore",
        relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
        expectedContent: "credentials/",
      },
      {
        source: "permissions",
        relativeFilePath: RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
        expectedContent: '"permission"',
      },
    ])(
      "should scaffold the singleton $source feature",
      async ({ source, relativeFilePath, expectedContent }) => {
        await addCommand(logger, { source });

        expect(await readFileContent(join(testDir, relativeFilePath))).toContain(expectedContent);
        expect(logger.success).toHaveBeenCalledWith(`Created ${relativeFilePath}`);
        expect(resolveAndFetchSources).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        source: "mcp",
        relativeFilePath: RULESYNC_MCP_JSONC_RELATIVE_FILE_PATH,
        expectedContent: '"mcpServers"',
      },
      {
        source: "mcp",
        relativeFilePath: join(".rulesync", ".mcp.json"),
        expectedContent: '"mcpServers"',
      },
      {
        source: "hooks",
        relativeFilePath: RULESYNC_HOOKS_JSONC_RELATIVE_FILE_PATH,
        expectedContent: '"hooks"',
      },
      {
        source: "ignore",
        relativeFilePath: RULESYNC_IGNORE_RELATIVE_FILE_PATH,
        expectedContent: "credentials/",
      },
      {
        source: "permissions",
        relativeFilePath: RULESYNC_PERMISSIONS_JSONC_RELATIVE_FILE_PATH,
        expectedContent: '"permission"',
      },
    ])(
      "should overwrite the effective $source variant at $relativeFilePath",
      async ({ source, relativeFilePath, expectedContent }) => {
        const targetPath = join(testDir, relativeFilePath);
        await writeFileContent(targetPath, "replace me\n");

        await addCommand(logger, { source, force: true });

        expect(await readFileContent(targetPath)).toContain(expectedContent);
      },
    );

    it.each([
      { source: "subagent", name: "null" },
      { source: "subagent", name: "true" },
      { source: "subagent", name: "123" },
      { source: "subagent", name: "2026-07-22" },
      { source: "skill", name: "null" },
      { source: "skill", name: "true" },
      { source: "skill", name: "123" },
      { source: "skill", name: "2026-07-22" },
    ])(
      "should preserve the $source name $name as a frontmatter string",
      async ({ source, name }) => {
        await addCommand(logger, { source, name });

        const feature =
          source === "subagent"
            ? await RulesyncSubagent.fromFile({
                outputRoot: testDir,
                relativeFilePath: `${name}.md`,
              })
            : await RulesyncSkill.fromDir({
                outputRoot: testDir,
                dirName: name,
              });
        expect(feature.getFrontmatter().name).toBe(name);
      },
    );

    it("should preserve an existing scaffold when overwrite confirmation is declined", async () => {
      const relativeFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md");
      const targetPath = join(testDir, relativeFilePath);
      await writeFileContent(targetPath, "keep me\n");
      const confirmOverwrite = vi.fn().mockResolvedValue(false);

      await addCommand(logger, {
        source: "rule",
        name: "existing",
        confirmOverwrite,
      });

      expect(confirmOverwrite).toHaveBeenCalledWith(relativeFilePath);
      expect(await readFileContent(targetPath)).toBe("keep me\n");
      expect(logger.info).toHaveBeenCalledWith(`Kept ${relativeFilePath} unchanged.`);
    });

    it("should replace an existing scaffold when overwrite confirmation is accepted", async () => {
      const relativeFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md");
      const targetPath = join(testDir, relativeFilePath);
      await writeFileContent(targetPath, "replace me\n");

      await addCommand(logger, {
        source: "rule",
        name: "existing",
        confirmOverwrite: vi.fn().mockResolvedValue(true),
      });

      expect(await readFileContent(targetPath)).toContain("# Existing");
    });

    it.each([
      { mode: "JSON", jsonMode: true, silent: false },
      { mode: "silent", jsonMode: false, silent: true },
    ])(
      "should fail without prompting before overwrite in $mode mode",
      async ({ jsonMode, silent }) => {
        const relativeFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md");
        const targetPath = join(testDir, relativeFilePath);
        await writeFileContent(targetPath, "keep me\n");
        const confirmOverwrite = vi.fn();
        logger = { ...createMockLogger(), jsonMode, silent };

        await expect(
          addCommand(logger, {
            source: "rule",
            name: "existing",
            confirmOverwrite,
          }),
        ).rejects.toThrow(/JSON or silent mode.*--force/);

        expect(confirmOverwrite).not.toHaveBeenCalled();
        expect(await readFileContent(targetPath)).toBe("keep me\n");
      },
    );

    it("should reject a nested scaffold path replaced with a symlink during overwrite confirmation", async () => {
      const projectRoot = join(testDir, "project");
      const relativeFilePath = join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "existing", SKILL_FILE_NAME);
      const targetPath = join(projectRoot, relativeFilePath);
      const targetDir = join(projectRoot, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
      const outsideDir = join(testDir, "outside-skills");
      const outsideSkillDir = join(outsideDir, "existing");
      await writeFileContent(targetPath, "replace me\n");
      await ensureDir(outsideDir);
      vi.mocked(process.cwd).mockReturnValue(projectRoot);

      await expect(
        addCommand(logger, {
          source: "skill",
          name: "existing",
          confirmOverwrite: async () => {
            await rm(targetDir, { recursive: true });
            await symlink(outsideDir, targetDir, "dir");
            return true;
          },
        }),
      ).rejects.toThrow(/Refusing to write through a symbolic link|must resolve inside the root/);

      expect(await fileExists(outsideSkillDir)).toBe(false);
    });

    it("should fail safely instead of overwriting in non-interactive mode", async () => {
      const relativeFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md");
      const targetPath = join(testDir, relativeFilePath);
      await writeFileContent(targetPath, "keep me\n");

      await expect(
        addCommand(logger, {
          source: "rule",
          name: "existing",
        }),
      ).rejects.toThrow(/non-interactive mode.*--force/);

      expect(await readFileContent(targetPath)).toBe("keep me\n");
    });

    it("should overwrite without prompting when force is set", async () => {
      const relativeFilePath = join(RULESYNC_RULES_RELATIVE_DIR_PATH, "existing.md");
      const targetPath = join(testDir, relativeFilePath);
      await writeFileContent(targetPath, "replace me\n");
      const confirmOverwrite = vi.fn();

      await addCommand(logger, {
        source: "rule",
        name: "existing",
        force: true,
        confirmOverwrite,
      });

      expect(confirmOverwrite).not.toHaveBeenCalled();
      expect(await readFileContent(targetPath)).toContain("# Existing");
    });

    it.each(["../outside", "nested/name", String.raw`nested\name`, ".curated"])(
      "should reject an unsafe feature name: %s",
      async (name) => {
        await expect(addCommand(logger, { source: "rule", name })).rejects.toThrow(
          /Invalid rule name/,
        );
      },
    );

    it("should reject a name for a singleton feature", async () => {
      await expect(addCommand(logger, { source: "mcp", name: "extra" })).rejects.toThrow(
        /does not accept --name/,
      );
    });

    it("should treat a feature keyword with source options as a declarative source", async () => {
      const configPath = join(testDir, "rulesync.jsonc");
      await writeFileContent(
        configPath,
        `{
  "targets": ["claudecode"],
  "features": ["skills"]
}
`,
      );

      await addCommand(logger, { source: "skill", transport: "npm" });

      const parsed = parseJsonc(await readFileContent(configPath)) as { sources: SourceEntry[] };
      expect(parsed.sources).toEqual([{ source: "skill", transport: "npm" }]);
      expect(resolveAndFetchSources).toHaveBeenCalled();
    });

    it("should reject mixed scaffold and declarative source options", async () => {
      await expect(
        addCommand(logger, {
          source: "rule",
          name: "overview",
          rules: ["remote-rule"],
        }),
      ).rejects.toThrow(/cannot be combined/);
    });
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
