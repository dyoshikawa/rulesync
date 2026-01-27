import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { loadPluginFromLocal } from "./plugin-loader.js";

describe("loadPluginFromLocal", () => {
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

  it("should load a valid plugin with manifest", async () => {
    // Setup plugin directory
    const pluginDir = join(testDir, "my-plugin");
    await ensureDir(pluginDir);
    await ensureDir(join(pluginDir, "rules"));

    // Create plugin.json
    await writeFileContent(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "my-plugin",
        description: "A test plugin",
        version: "1.0.0",
      }),
    );

    // Create a rule file
    await writeFileContent(
      join(pluginDir, "rules", "coding.md"),
      "---\nroot: true\n---\n\n# Coding Guidelines",
    );

    const result = await loadPluginFromLocal({
      pluginDir: "my-plugin",
      baseDir: testDir,
    });

    expect(result.manifest.name).toBe("my-plugin");
    expect(result.manifest.version).toBe("1.0.0");
    expect(result.pluginDir).toBe(pluginDir);
    expect(result.ruleFiles).toContain("rules/coding.md");
    expect(result.mcpConfigPath).toBeNull();
  });

  it("should load plugin with all feature directories", async () => {
    const pluginDir = join(testDir, "full-plugin");
    await ensureDir(pluginDir);
    await ensureDir(join(pluginDir, "rules"));
    await ensureDir(join(pluginDir, "commands"));
    await ensureDir(join(pluginDir, "subagents"));
    await ensureDir(join(pluginDir, "skills", "my-skill"));

    await writeFileContent(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "full-plugin",
        description: "A full plugin with all features",
        version: "2.0.0",
      }),
    );

    await writeFileContent(join(pluginDir, "rules", "rule1.md"), "# Rule 1");
    await writeFileContent(join(pluginDir, "commands", "cmd1.md"), "# Command 1");
    await writeFileContent(join(pluginDir, "subagents", "agent1.md"), "# Agent 1");
    await writeFileContent(join(pluginDir, "skills", "my-skill", "SKILL.md"), "# Skill");
    await writeFileContent(join(pluginDir, "mcp.json"), JSON.stringify({ mcpServers: {} }));

    const result = await loadPluginFromLocal({
      pluginDir: "full-plugin",
      baseDir: testDir,
    });

    expect(result.manifest.name).toBe("full-plugin");
    expect(result.ruleFiles).toContain("rules/rule1.md");
    expect(result.commandFiles).toContain("commands/cmd1.md");
    expect(result.subagentFiles).toContain("subagents/agent1.md");
    expect(result.skillDirs).toContain("my-skill");
    expect(result.mcpConfigPath).toBe(join(pluginDir, "mcp.json"));
  });

  it("should throw error when plugin directory does not exist", async () => {
    await expect(
      loadPluginFromLocal({
        pluginDir: "nonexistent-plugin",
        baseDir: testDir,
      }),
    ).rejects.toThrow("Plugin directory not found");
  });

  it("should throw error when plugin.json is missing", async () => {
    const pluginDir = join(testDir, "no-manifest");
    await ensureDir(pluginDir);

    await expect(
      loadPluginFromLocal({
        pluginDir: "no-manifest",
        baseDir: testDir,
      }),
    ).rejects.toThrow("Plugin manifest not found");
  });

  it("should throw error when plugin.json is invalid JSON", async () => {
    const pluginDir = join(testDir, "invalid-json");
    await ensureDir(pluginDir);
    await writeFileContent(join(pluginDir, "plugin.json"), "{ invalid json }");

    await expect(
      loadPluginFromLocal({
        pluginDir: "invalid-json",
        baseDir: testDir,
      }),
    ).rejects.toThrow("Invalid JSON in plugin manifest");
  });

  it("should throw error when plugin.json is missing required fields", async () => {
    const pluginDir = join(testDir, "incomplete-manifest");
    await ensureDir(pluginDir);
    await writeFileContent(
      join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "test" }), // Missing description and version
    );

    await expect(
      loadPluginFromLocal({
        pluginDir: "incomplete-manifest",
        baseDir: testDir,
      }),
    ).rejects.toThrow("Invalid plugin manifest");
  });

  it("should detect .rulesyncignore file", async () => {
    const pluginDir = join(testDir, "with-ignore");
    await ensureDir(pluginDir);

    await writeFileContent(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "with-ignore",
        description: "Plugin with ignore file",
        version: "1.0.0",
      }),
    );

    await writeFileContent(join(pluginDir, ".rulesyncignore"), "*.log\nnode_modules/");

    const result = await loadPluginFromLocal({
      pluginDir: "with-ignore",
      baseDir: testDir,
    });

    expect(result.ignoreFilePath).toBe(join(pluginDir, ".rulesyncignore"));
  });

  it("should resolve relative plugin paths", async () => {
    // Create nested project structure
    // testDir/
    //   project/packages/app/  <- baseDir
    //   shared-plugins/my-plugin/  <- plugin location
    const nestedDir = join(testDir, "project", "packages", "app");
    await ensureDir(nestedDir);

    // Plugin should be at testDir/shared-plugins/my-plugin
    // From nestedDir (testDir/project/packages/app), the relative path is:
    // ../../../shared-plugins/my-plugin
    const pluginDir = join(testDir, "shared-plugins", "my-plugin");
    await ensureDir(pluginDir);

    await writeFileContent(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "shared-plugin",
        description: "A shared plugin",
        version: "1.0.0",
      }),
    );

    const result = await loadPluginFromLocal({
      pluginDir: "../../../shared-plugins/my-plugin",
      baseDir: nestedDir,
    });

    expect(result.manifest.name).toBe("shared-plugin");
  });
});
