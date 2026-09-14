import { join } from "node:path";

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
});
