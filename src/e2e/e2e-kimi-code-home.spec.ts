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

describe("E2E: KIMI_CODE_HOME", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should use the custom Kimi data root for every global feature", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    const kimiCodeHome = join(homeDir, "custom-kimi");
    const env = { HOME_DIR: homeDir, KIMI_CODE_HOME: kimiCodeHome };

    await writeFileContent(
      join(projectDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      [
        "---",
        "root: true",
        'targets: ["*"]',
        'description: "Custom Kimi home rule"',
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
      target: "kimi-code",
      features: "rules,mcp,skills,subagents,hooks,permissions",
      global: true,
      env,
    });

    expect(await readFileContent(join(kimiCodeHome, "AGENTS.md"))).toContain(
      "Generated custom-home rule",
    );
    expect(await readFileContent(join(kimiCodeHome, "mcp.json"))).toContain("generated");
    expect(
      await readFileContent(join(kimiCodeHome, "skills", "generated-skill", "SKILL.md")),
    ).toContain("Generated custom-home skill");
    expect(await readFileContent(join(kimiCodeHome, "agents", "generated-agent.md"))).toContain(
      "Generated custom-home agent",
    );
    const config = await readFileContent(join(kimiCodeHome, "config.toml"));
    expect(config).toContain("generated-stop");
    expect(config).toContain("Bash(git status)");
    expect(await fileExists(join(homeDir, ".kimi-code", "AGENTS.md"))).toBe(false);

    await writeFileContent(join(kimiCodeHome, "AGENTS.md"), "Imported custom-home rule.\n");
    await writeFileContent(
      join(kimiCodeHome, "mcp.json"),
      JSON.stringify({
        mcpServers: { imported: { transport: "stdio", command: "node", args: ["imported.js"] } },
      }),
    );
    await writeFileContent(
      join(kimiCodeHome, "skills", "imported-skill", "SKILL.md"),
      [
        "---",
        "name: imported-skill",
        'description: "Imported skill"',
        "---",
        "Imported custom-home skill.",
      ].join("\n"),
    );
    await writeFileContent(
      join(kimiCodeHome, "agents", "imported-agent.md"),
      [
        "---",
        "name: imported-agent",
        'description: "Imported agent"',
        "---",
        "Imported custom-home agent.",
      ].join("\n"),
    );
    await writeFileContent(
      join(homeDir, ".agents", "skills", "shared-skill", "SKILL.md"),
      [
        "---",
        "name: shared-skill",
        'description: "Shared skill"',
        "---",
        "Shared-home skill.",
      ].join("\n"),
    );
    await writeFileContent(
      join(homeDir, ".agents", "agents", "shared-agent.md"),
      [
        "---",
        "name: shared-agent",
        'description: "Shared agent"',
        "---",
        "Shared-home agent.",
      ].join("\n"),
    );
    await writeFileContent(
      join(kimiCodeHome, "config.toml"),
      [
        "[[hooks]]",
        'event = "Stop"',
        'command = "imported-stop"',
        "",
        "[[permission.rules]]",
        'decision = "deny"',
        'pattern = "Bash(rm *)"',
      ].join("\n"),
    );

    await runImport({
      target: "kimi-code",
      features: "rules,mcp,skills,subagents,hooks,permissions",
      global: true,
      env,
    });

    expect(
      await readFileContent(
        join(homeDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      ),
    ).toContain("Imported custom-home rule");
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
        join(homeDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "shared-skill", "SKILL.md"),
      ),
    ).toContain("Shared-home skill");
    expect(
      await readFileContent(
        join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "imported-agent.md"),
      ),
    ).toContain("Imported custom-home agent");
    expect(
      await readFileContent(join(homeDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "shared-agent.md")),
    ).toContain("Shared-home agent");
    expect(await readFileContent(join(homeDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH))).toContain(
      "imported-stop",
    );
    expect(await readFileContent(join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH))).toContain(
      "Bash(rm *)",
    );
  });
});
