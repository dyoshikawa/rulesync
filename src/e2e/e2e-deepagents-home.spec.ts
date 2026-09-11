import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, runImport, useGlobalTestDirectories } from "./e2e-helper.js";

describe("E2E: DEEPAGENTS_HOME", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should use the custom dcode profile root for every global feature", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    // `DEEPAGENTS_HOME` names the profile root itself, so the `.deepagents`
    // segment of every default path is dropped beneath it.
    const deepagentsHome = join(homeDir, "custom-deepagents");
    const env = { HOME_DIR: homeDir, DEEPAGENTS_HOME: deepagentsHome };

    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      [
        "---",
        "root: true",
        'targets: ["*"]',
        'description: "Custom deepagents home rule"',
        'globs: ["**/*"]',
        "---",
        "Generated custom-home rule.",
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
      join(projectDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "generated-skill", "SKILL.md"),
      [
        "---",
        "name: generated-skill",
        'description: "Generated skill"',
        'targets: ["*"]',
        "---",
        "Generated custom-home skill.",
      ].join("\n"),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "generated-agent.md"),
      [
        "---",
        "name: generated-agent",
        'description: "Generated agent"',
        'targets: ["*"]',
        "---",
        "Generated custom-home agent.",
      ].join("\n"),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        version: 1,
        hooks: { stop: [{ command: "generated-stop" }] },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: { bash: { "git status": "allow" } },
      }),
    );

    await runGenerate({
      target: "deepagents",
      features: "rules,mcp,skills,subagents,hooks,permissions",
      global: true,
      env,
    });

    expect(await readFileContent(join(deepagentsHome, "agent", "AGENTS.md"))).toContain(
      "Generated custom-home rule",
    );
    expect(await readFileContent(join(deepagentsHome, ".mcp.json"))).toContain("generated");
    expect(
      await readFileContent(join(deepagentsHome, "agent", "skills", "generated-skill", "SKILL.md")),
    ).toContain("Generated custom-home skill");
    expect(
      await readFileContent(
        join(deepagentsHome, "agent", "agents", "generated-agent", "AGENTS.md"),
      ),
    ).toContain("Generated custom-home agent");
    expect(await readFileContent(join(deepagentsHome, "hooks.json"))).toContain("generated-stop");
    // dcode auto-approves by executable name, so the rule is reduced to `git`.
    expect(await readFileContent(join(deepagentsHome, "config.toml"))).toContain('"git"');
    // Nothing lands under the default `~/.deepagents/` tree, and the profile
    // root never grows a nested `.deepagents/` directory of its own.
    expect(await fileExists(join(homeDir, ".deepagents"))).toBe(false);
    expect(await fileExists(join(deepagentsHome, ".deepagents"))).toBe(false);

    await writeFileContent(
      join(deepagentsHome, ".mcp.json"),
      JSON.stringify({
        mcpServers: { imported: { type: "stdio", command: "node", args: ["imported.js"] } },
      }),
    );
    await writeFileContent(
      join(deepagentsHome, "agent", "skills", "imported-skill", "SKILL.md"),
      [
        "---",
        "name: imported-skill",
        'description: "Imported skill"',
        "---",
        "Imported custom-home skill.",
      ].join("\n"),
    );
    await writeFileContent(
      join(deepagentsHome, "agent", "agents", "imported-agent", "AGENTS.md"),
      [
        "---",
        "name: imported-agent",
        'description: "Imported agent"',
        "---",
        "Imported custom-home agent.",
      ].join("\n"),
    );
    await writeFileContent(
      join(deepagentsHome, "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "imported-stop" }] }],
        },
      }),
    );
    await writeFileContent(
      join(deepagentsHome, "config.toml"),
      ["[shell]", 'allow_list = ["ls"]'].join("\n"),
    );

    // `rules` is left out of the import half, as in the Hermes spec: the rule
    // adapter still uses the shared default that writes imported rules under
    // the working directory in global scope, which is independent of the
    // override.
    await runImport({
      target: "deepagents",
      features: "mcp,skills,subagents,hooks,permissions",
      global: true,
      env,
    });

    // The override relocates dcode's own files only: the `.rulesync/` sources
    // written back by `import --global` stay under the rulesync home.
    expect(await readFileContent(join(homeDir, RULESYNC_MCP_RELATIVE_FILE_PATH))).toContain(
      "imported",
    );
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "imported-skill", "SKILL.md"),
      ),
    ).toContain("Imported custom-home skill");
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "imported-agent.md"),
      ),
    ).toContain("Imported custom-home agent");
    expect(await readFileContent(join(homeDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH))).toContain(
      "imported-stop",
    );
    expect(await readFileContent(join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH))).toContain(
      "ls",
    );
    expect(await fileExists(join(deepagentsHome, ".rulesync"))).toBe(false);
  });
});
