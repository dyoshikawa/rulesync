import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLAUDECODE_COMMANDS_DIR_PATH } from "../constants/claudecode-paths.js";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, removeFile, writeFileContent } from "../utils/file.js";
import {
  execFileAsync,
  rulesyncArgs,
  rulesyncCmd,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
} from "./e2e-helper.js";

async function runGlobalHermesCommandConvert({
  env,
}: {
  env: Record<string, string>;
}): Promise<void> {
  await execFileAsync(
    rulesyncCmd,
    [
      ...rulesyncArgs,
      "convert",
      "--from",
      "claudecode",
      "--to",
      "hermesagent",
      "--features",
      "commands",
      "--global",
    ],
    { env: { ...process.env, ...env } },
  );
}

describe("E2E: HERMES_HOME", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("uses the custom Hermes profile root for every global feature", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    const hermesHome = join(homeDir, "custom-hermes");
    const env = { HOME_DIR: homeDir, HERMES_HOME: hermesHome };
    const commandSourcePath = join(projectDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "review-pr.md");

    await writeFileContent(
      commandSourcePath,
      [
        "---",
        'description: "Review a pull request"',
        'targets: ["hermesagent"]',
        "---",
        "Review it.",
      ].join("\n"),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md"),
      [
        "---",
        "name: Planner",
        'description: "Plans implementation work"',
        'targets: ["hermesagent"]',
        "---",
        "Break the work into steps.",
      ].join("\n"),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "release", "SKILL.md"),
      [
        "---",
        "name: release",
        'description: "Prepare a release"',
        'targets: ["hermesagent"]',
        "---",
        "Prepare the release.",
      ].join("\n"),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: {
          generated: { command: "node", args: ["server.js"] },
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "generated-session-start" }],
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {
          bash: { "git status *": "allow", "rm -rf *": "deny" },
        },
      }),
    );
    await writeFileContent(join(hermesHome, "config.yaml"), "model: hermes-large\n");

    await runGenerate({
      target: "hermesagent",
      features: "mcp,commands,subagents,skills,hooks,permissions",
      global: true,
      env,
    });

    expect(
      await readFileContent(join(hermesHome, "rulesync", "commands", "review-pr.json")),
    ).toContain("Review it.");
    expect(
      await readFileContent(join(hermesHome, "rulesync", "subagents", "planner.json")),
    ).toContain("Break the work into steps.");
    expect(await readFileContent(join(hermesHome, "skills", "release", "SKILL.md"))).toContain(
      "Prepare the release.",
    );

    const config = await readFileContent(join(hermesHome, "config.yaml"));
    expect(config).toContain("model: hermes-large");
    expect(config).toContain("generated:");
    expect(config).toContain("on_session_start:");
    expect(config).toContain("generated-session-start");
    expect(config).toContain("rm -rf *");
    expect(config).toContain("rulesync-commands");
    expect(config).toContain("rulesync-subagents");
    expect(await fileExists(join(homeDir, ".hermes", "config.yaml"))).toBe(false);

    await runGenerate({
      target: "hermesagent",
      features: "mcp,commands,subagents,skills,hooks,permissions",
      global: true,
      check: true,
      env,
    });

    await removeFile(commandSourcePath);
    await runGenerate({
      target: "hermesagent",
      features: "commands",
      global: true,
      deleteFiles: true,
      env,
    });
    expect(await fileExists(join(hermesHome, "rulesync", "commands", "review-pr.json"))).toBe(
      false,
    );
    expect(await fileExists(join(hermesHome, "plugins", "rulesync-commands", "__init__.py"))).toBe(
      false,
    );
    const configAfterDelete = await readFileContent(join(hermesHome, "config.yaml"));
    expect(configAfterDelete).not.toContain("rulesync-commands");
    expect(configAfterDelete).toContain("rulesync-subagents");
    expect(configAfterDelete).toContain("generated-session-start");
  });

  it("converts global commands into the custom profile without touching HOME config", async () => {
    const homeDir = getHomeDir();
    const hermesHome = join(homeDir, "custom-hermes");
    const env = { HOME_DIR: homeDir, HERMES_HOME: hermesHome };
    const homeConfigContent = [
      "# Preserve this comment and formatting.",
      "unrelated:",
      "  formatting: preserved",
      "",
    ].join("\n");

    await writeFileContent(
      join(homeDir, CLAUDECODE_COMMANDS_DIR_PATH, "review-pr.md"),
      "Review the pull request.",
    );
    await writeFileContent(join(homeDir, "config.yaml"), homeConfigContent);

    await runGlobalHermesCommandConvert({ env });

    expect(
      await readFileContent(join(hermesHome, "rulesync", "commands", "review-pr.json")),
    ).toContain("Review the pull request.");
    expect(await fileExists(join(hermesHome, "plugins", "rulesync-commands", "plugin.yaml"))).toBe(
      true,
    );
    expect(await fileExists(join(hermesHome, "plugins", "rulesync-commands", "__init__.py"))).toBe(
      true,
    );
    expect(
      await fileExists(join(hermesHome, "plugins", "rulesync-commands", ".rulesync-owned")),
    ).toBe(true);
    expect(await readFileContent(join(hermesHome, "config.yaml"))).toContain("rulesync-commands");

    expect(await readFileContent(join(homeDir, "config.yaml"))).toBe(homeConfigContent);
    expect(await fileExists(join(homeDir, "rulesync", "commands", "review-pr.json"))).toBe(false);
    expect(await fileExists(join(homeDir, "plugins", "rulesync-commands", "plugin.yaml"))).toBe(
      false,
    );
    expect(await fileExists(join(homeDir, ".hermes", "config.yaml"))).toBe(false);
  });

  it("imports every global feature from the custom profile into the global RuleSync root", async () => {
    const homeDir = getHomeDir();
    const hermesHome = join(homeDir, "custom-hermes");
    const env = { HOME_DIR: homeDir, HERMES_HOME: hermesHome };

    await writeFileContent(
      join(hermesHome, "config.yaml"),
      [
        "mcp_servers:",
        "  imported:",
        "    command: node",
        "    args: [imported.js]",
        "hooks:",
        "  on_session_start:",
        "    - command: imported-session-start",
        'command_allowlist: ["git status *"]',
        "approvals:",
        '  deny: ["rm -rf *"]',
      ].join("\n"),
    );
    await writeFileContent(
      join(homeDir, ".hermes", "config.yaml"),
      ["mcp_servers:", "  wrong-profile:", "    command: false"].join("\n"),
    );
    await writeFileContent(
      join(hermesHome, "rulesync", "commands", "imported-command.json"),
      JSON.stringify({
        slug: "imported-command",
        description: "Imported command",
        prompt: "Run the imported command.",
      }),
    );
    await writeFileContent(
      join(hermesHome, "rulesync", "subagents", "imported-agent.json"),
      JSON.stringify({
        slug: "imported-agent",
        name: "Imported agent",
        description: "Imported subagent",
        prompt: "Run the imported subagent.",
      }),
    );
    await writeFileContent(
      join(hermesHome, "skills", "imported-skill", "SKILL.md"),
      [
        "---",
        "name: imported-skill",
        'description: "Imported skill"',
        "---",
        "Run the imported skill.",
      ].join("\n"),
    );

    await runImport({
      target: "hermesagent",
      features: "mcp,commands,subagents,skills,hooks,permissions",
      global: true,
      env,
    });

    expect(
      await readFileContent(
        join(homeDir, RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "imported-command.md"),
      ),
    ).toContain("Run the imported command.");
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "imported-agent.md"),
      ),
    ).toContain("Run the imported subagent.");
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "imported-skill", "SKILL.md"),
      ),
    ).toContain("Run the imported skill.");

    const importedMcp = await readFileContent(join(homeDir, RULESYNC_MCP_RELATIVE_FILE_PATH));
    expect(importedMcp).toContain("imported.js");
    expect(importedMcp).not.toContain("wrong-profile");
    expect(await readFileContent(join(homeDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH))).toContain(
      "imported-session-start",
    );
    const importedPermissions = await readFileContent(
      join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
    );
    expect(importedPermissions).toContain("git status *");
    expect(importedPermissions).toContain("rm -rf *");
    expect(await fileExists(join(hermesHome, ".rulesync"))).toBe(false);
  });
});
