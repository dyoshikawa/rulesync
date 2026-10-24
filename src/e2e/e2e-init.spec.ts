import { readdir, rm, symlink } from "node:fs/promises";
import { join, normalize } from "node:path";

import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { SKILL_FILE_NAME } from "../constants/general.js";
import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
  RULESYNC_USER_CONFIG_DIR_NAME,
  RULESYNC_XDG_CONFIG_HOME_DEFAULT_DIR_NAME,
} from "../constants/rulesync-paths.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { parseJsonc } from "../utils/jsonc.js";
import {
  execFileAsync,
  rulesyncArgs,
  rulesyncCmd,
  runGenerate,
  useGlobalTestDirectories,
} from "./e2e-helper.js";

describe("E2E: init", () => {
  // `init` resolves the user-level config under the home directory, so the CLI
  // child gets a pseudo-home via HOME_DIR (the same way global-mode specs do)
  // instead of reading the runner's real `~/.config/rulesync/rulesync.jsonc`.
  const { getProjectDir: getTestDir, getHomeDir } = useGlobalTestDirectories();

  const runInit = async (): Promise<void> => {
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"], {
      env: { ...process.env, HOME_DIR: getHomeDir() },
    });
  };

  it("should initialize rulesync without errors and create files", async () => {
    const testDir = getTestDir();
    await runInit();

    const expectedPaths = [
      RULESYNC_CONFIG_RELATIVE_FILE_PATH,
      RULESYNC_MCP_RELATIVE_FILE_PATH,
      RULESYNC_HOOKS_RELATIVE_FILE_PATH,
      RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
      join(RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
    ];

    for (const path of expectedPaths) {
      const exists = await fileExists(join(testDir, path));
      expect(exists, `Expected ${path} to exist`).toBe(true);
    }

    const config = parseJsonc(
      await readFileContent(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH)),
    ) as Record<string, unknown>;
    expect(config.targets).toEqual(["codexcli", "claudecode", "opencode"]);
    expect(config.features).not.toContain("ignore");
    expect(config.features).not.toContain("commands");
    expect(config.features).toContain("permissions");
    expect(config.features).toContain("skills");
    expect(await fileExists(join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH))).toBe(false);
    expect(
      await fileExists(join(testDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md")),
    ).toBe(false);

    const permissions = parseJsonc(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    ) as Record<string, unknown>;
    expect(permissions.permission).toMatchObject({
      read: {
        ".env": "deny",
        "credentials/**": "deny",
      },
    });
    expect(permissions.codexcli).toEqual({
      approval_policy: "on-request",
      approvals_reviewer: "auto_review",
      base_permission_profile: ":danger-full-access",
    });

    await runGenerate({ target: "claudecode", features: "permissions" });
    const claude = parseJsonc(await readFileContent(join(testDir, ".claude", "settings.json"))) as {
      permissions?: {
        deny?: string[];
      };
    };
    expect(claude.permissions?.deny).toContain("Read(credentials/**)");

    await runGenerate({ target: "codexcli", features: "permissions" });
    const codex = smolToml.parse(
      await readFileContent(join(testDir, ".codex", "config.toml")),
    ) as Record<string, unknown>;
    expect(codex.default_permissions).toBe(":danger-full-access");
    expect(codex.approval_policy).toBe("on-request");
    expect(codex.approvals_reviewer).toBe("auto_review");
  });

  it("should seed targets and features from the user-level config", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(
        getHomeDir(),
        RULESYNC_XDG_CONFIG_HOME_DEFAULT_DIR_NAME,
        RULESYNC_USER_CONFIG_DIR_NAME,
        RULESYNC_CONFIG_RELATIVE_FILE_PATH,
      ),
      `{
  // User-level defaults picked up by \`rulesync init\`.
  "targets": ["cursor", "claudecode"],
  "features": ["rules", "mcp"],
  "baseDirs": ["./ignored-by-init"],
}
`,
    );

    await runInit();

    const config = parseJsonc(
      await readFileContent(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH)),
    ) as Record<string, unknown>;
    expect(config.targets).toEqual(["cursor", "claudecode"]);
    expect(config.features).toEqual(["rules", "mcp"]);
    expect(config.baseDirs).toBeUndefined();
    // Only `targets` / `features` are seeded; the sample files are unchanged.
    expect(await fileExists(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH))).toBe(true);
  });

  it("should scaffold named and singleton feature files through the add command", async () => {
    const testDir = getTestDir();
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "rule", "--name", "architecture.md"]);
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "skill", "--name", "project-audit"]);
    await execFileAsync(rulesyncCmd, [...rulesyncArgs, "add", "mcp"]);

    const rulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, "architecture.md");
    const skillPath = join(
      testDir,
      RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      "project-audit",
      SKILL_FILE_NAME,
    );
    const mcpPath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);

    expect(await readFileContent(rulePath)).toContain("# Architecture");
    expect(
      (
        await RulesyncSkill.fromDir({
          outputRoot: testDir,
          dirName: "project-audit",
        })
      ).getFrontmatter().name,
    ).toBe("project-audit");
    expect(await fileExists(skillPath)).toBe(true);
    expect(await readFileContent(mcpPath)).toContain('"mcpServers"');
  });

  describe("symbolic links out of the project", () => {
    it("should skip sample files a .rulesync linked outside the project lacks", async () => {
      const testDir = getTestDir();
      const outside = await setupTestDirectory();
      try {
        // A shared tree that is only partly populated: hooks.jsonc is missing.
        await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"], {
          cwd: outside.testDir,
          env: { ...process.env, HOME_DIR: getHomeDir() },
        });
        const outsideHooks = join(outside.testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH);
        await rm(outsideHooks);
        await rm(join(outside.testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH));
        await symlink(join(outside.testDir, ".rulesync"), join(testDir, ".rulesync"));

        const { stderr, stdout } = await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"], {
          env: { ...process.env, HOME_DIR: getHomeDir(), NODE_ENV: "e2e" },
        });

        expect(`${stdout}${stderr}`).toContain(
          `Skipped ${normalize(RULESYNC_HOOKS_RELATIVE_FILE_PATH)}: it would be written through a symbolic link that leads outside the project or is dangling.`,
        );
        expect(await fileExists(outsideHooks)).toBe(false);
        expect(await fileExists(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH))).toBe(true);
      } finally {
        await outside.cleanup();
      }
    });

    it("should create nothing through a .rulesync linked to an empty directory outside the project", async () => {
      const testDir = getTestDir();
      const outside = await setupTestDirectory();
      try {
        await symlink(outside.testDir, join(testDir, ".rulesync"));

        await runInit();

        expect(await readdir(outside.testDir)).toEqual([]);
        expect(await fileExists(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH))).toBe(true);
      } finally {
        await outside.cleanup();
      }
    });

    it("should write through a .rulesync linked inside the project", async () => {
      const testDir = getTestDir();
      const sharedDir = join(testDir, "shared", "rulesync");
      await writeFileContent(join(sharedDir, ".keep"), "");
      await symlink(join("shared", "rulesync"), join(testDir, ".rulesync"));

      await runInit();

      expect(await fileExists(join(sharedDir, "mcp.jsonc"))).toBe(true);
      expect(await fileExists(join(sharedDir, "rules", RULESYNC_OVERVIEW_FILE_NAME))).toBe(true);
    });

    it("should only read a .rulesync linked outside the project whose files already exist", async () => {
      const testDir = getTestDir();
      const outside = await setupTestDirectory();
      try {
        // Populate the shared source tree the way a dotfiles checkout would be.
        await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"], {
          cwd: outside.testDir,
          env: { ...process.env, HOME_DIR: getHomeDir() },
        });
        await symlink(join(outside.testDir, ".rulesync"), join(testDir, ".rulesync"));

        await runInit();

        expect(await fileExists(join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH))).toBe(true);
      } finally {
        await outside.cleanup();
      }
    });

    it("should not create the target of a dangling rulesync.jsonc link", async () => {
      const testDir = getTestDir();
      const outside = await setupTestDirectory();
      try {
        const outsideFile = join(outside.testDir, "new-file");
        await symlink(outsideFile, join(testDir, RULESYNC_CONFIG_RELATIVE_FILE_PATH));

        const { stdout } = await execFileAsync(rulesyncCmd, [...rulesyncArgs, "init"], {
          env: { ...process.env, HOME_DIR: getHomeDir(), NODE_ENV: "e2e" },
        });

        expect(stdout).toContain(`Skipped ${RULESYNC_CONFIG_RELATIVE_FILE_PATH}`);
        expect(await fileExists(outsideFile)).toBe(false);
        expect(await fileExists(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH))).toBe(true);
      } finally {
        await outside.cleanup();
      }
    });
  });
});
