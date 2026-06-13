import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  rulesyncArgs,
  rulesyncCmd,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: mcp", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "amp", outputPath: join(".amp", "settings.jsonc") },
    { target: "claudecode", outputPath: ".mcp.json" },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "codexcli", outputPath: join(".codex", "config.toml") },
    { target: "copilot", outputPath: join(".vscode", "mcp.json") },
    { target: "copilotcli", outputPath: join(".copilot", "mcp-config.json") },
    { target: "opencode", outputPath: "opencode.jsonc" },
    { target: "deepagents", outputPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
    { target: "kilo", outputPath: "kilo.jsonc" },
    { target: "roo", outputPath: join(".roo", "mcp.json") },
    { target: "kiro", outputPath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", outputPath: join(".junie", "mcp", "mcp.json") },
    { target: "antigravity-ide", outputPath: join(".agents", "mcp_config.json") },
    { target: "antigravity-cli", outputPath: join(".agents", "mcp_config.json") },
    { target: "warp", outputPath: join(".warp", ".mcp.json") },
    { target: "zed", outputPath: join(".zed", "settings.json") },
    { target: "devin", outputPath: join(".windsurf", "mcp_config.json") },
    { target: "vibe", outputPath: join(".vibe", "config.toml") },
  ])("should generate $target mcp", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/mcp.json with a test MCP server
    const mcpContent = JSON.stringify(
      {
        mcpServers: {
          "test-server": {
            description: "Test MCP server",
            type: "stdio",
            command: "echo",
            args: ["hello"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    // Execute: Generate mcp for the target
    await runGenerate({ target, features: "mcp" });

    // Verify that the expected output file was generated and contains the server
    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("test-server");
  });

  it.each([
    // amp, geminicli, codexcli, opencode, kilo use merged config files (isDeletable=false) — excluded
    { target: "claudecode", orphanPath: ".mcp.json" },
    { target: "cursor", orphanPath: join(".cursor", "mcp.json") },
    { target: "copilot", orphanPath: join(".vscode", "mcp.json") },
    { target: "copilotcli", orphanPath: join(".copilot", "mcp-config.json") },
    { target: "deepagents", orphanPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", orphanPath: join(".factory", "mcp.json") },
    { target: "roo", orphanPath: join(".roo", "mcp.json") },
    { target: "kiro", orphanPath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", orphanPath: join(".junie", "mcp", "mcp.json") },
    { target: "devin", orphanPath: join(".windsurf", "mcp_config.json") },
  ])(
    "should fail in check mode when delete would remove an orphan $target mcp file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(
        join(testDir, ".rulesync", "mcp.json"),
        JSON.stringify({ mcpServers: {} }),
      );
      const orphanContent = JSON.stringify(
        { mcpServers: { "orphan-server": { command: "echo", args: ["orphan"] } } },
        null,
        2,
      );
      await writeFileContent(join(testDir, orphanPath), orphanContent);

      await expect(
        runGenerate({
          target,
          features: "mcp",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Files are not up to date. Run 'rulesync generate' to update.",
        ),
      });

      expect(await readFileContent(join(testDir, orphanPath))).toBe(orphanContent);
    },
  );

  it.each([
    {
      target: "amp",
      outputPath: join(".amp", "settings.jsonc"),
      content: JSON.stringify({ "amp.dangerouslyAllowAll": false, "amp.mcpServers": {} }, null, 2),
    },
    {
      target: "geminicli",
      outputPath: join(".gemini", "settings.json"),
      content: JSON.stringify({ theme: "dark", mcpServers: {} }, null, 2),
    },
    {
      target: "codexcli",
      outputPath: join(".codex", "config.toml"),
      content: '[ui]\ntheme = "dark"\n',
    },
    {
      target: "opencode",
      outputPath: "opencode.jsonc",
      content: JSON.stringify({ theme: "dark", mcp: {} }, null, 2),
    },
    {
      target: "kilo",
      outputPath: "kilo.jsonc",
      content: JSON.stringify({ theme: "dark", mcp: {} }, null, 2),
    },
    {
      target: "vibe",
      outputPath: join(".vibe", "config.toml"),
      content: 'theme = "dark"\n',
    },
  ])(
    "should succeed in check mode when a $target mcp file is non-deletable",
    async ({ target, outputPath, content }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, outputPath), content);

      const { stdout } = await runGenerate({
        target,
        features: "mcp",
        deleteFiles: true,
        check: true,
        env: { NODE_ENV: "e2e" },
      });

      expect(stdout).toContain("All files are up to date.");
    },
  );

  it("should run mcp command as daemon without errors", async () => {
    const testDir = getTestDir();

    // Spawn the MCP server process in the background
    const mcpProcess = spawn(rulesyncCmd, [...rulesyncArgs, "mcp"], {
      cwd: testDir,
      stdio: "pipe",
    });

    let hasError = false;
    let stderrOutput = "";

    // Collect stderr output and check for actual errors
    mcpProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      stderrOutput += output;
      // Check if the output contains actual error messages (not just warnings)
      if (output.toLowerCase().includes("error") && !output.includes("warning")) {
        hasError = true;
      }
    });

    // Wait for 3 seconds to let the server run
    await setTimeout(3000);

    // Kill the process
    mcpProcess.kill("SIGTERM");

    // Wait for the process to exit
    await new Promise((resolve) => {
      mcpProcess.on("exit", resolve);
    });

    // Verify that there were no actual errors (warnings are acceptable)
    expect(hasError, `MCP daemon produced errors: ${stderrOutput}`).toBe(false);
  });

  it("should generate Vibe MCP and permissions into shared config.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          mcpServers: {
            "test-server": {
              type: "stdio",
              command: "echo",
              args: ["hello"],
            },
          },
        },
        null,
        2,
      ),
    );
    await writeFileContent(
      join(testDir, ".rulesync", "permissions.json"),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow" },
            edit: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "vibe", features: "mcp,permissions" });

    const parsed = toTable(
      smolToml.parse(await readFileContent(join(testDir, ".vibe", "config.toml"))),
    );
    const tools = toTable(parsed.tools);
    const bash = toTable(tools.bash);
    expect(toTableArray(parsed.mcp_servers)).toMatchObject([
      { name: "test-server", command: "echo" },
    ]);
    expect(bash.permission).toBe("ask");
    expect(bash.allow).toEqual(["git *"]);
    expect(parsed.disabled_tools).toContain("write_file");
  });
});

describe("E2E: mcp (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", sourcePath: ".mcp.json" },
    { target: "cursor", sourcePath: join(".cursor", "mcp.json") },
    // copilot MCP uses VS Code-specific format — excluded from import test
    { target: "copilotcli", sourcePath: join(".copilot", "mcp-config.json") },
    { target: "deepagents", sourcePath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", sourcePath: join(".factory", "mcp.json") },
    { target: "roo", sourcePath: join(".roo", "mcp.json") },
    { target: "kiro", sourcePath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", sourcePath: join(".junie", "mcp", "mcp.json") },
    // Amp stores servers under the `amp.mcpServers` key inside the shared
    // settings file, so the source content shape differs from the other targets.
    {
      target: "amp",
      sourcePath: join(".amp", "settings.jsonc"),
      sourceContent: JSON.stringify(
        {
          "amp.mcpServers": {
            "test-server": {
              command: "echo",
              args: ["hello"],
            },
          },
        },
        null,
        2,
      ),
    },
    { target: "antigravity-ide", sourcePath: join(".agents", "mcp_config.json") },
    { target: "antigravity-cli", sourcePath: join(".agents", "mcp_config.json") },
    { target: "warp", sourcePath: join(".warp", ".mcp.json") },
    { target: "devin", sourcePath: join(".windsurf", "mcp_config.json") },
  ])("should import $target mcp", async ({ target, sourcePath, sourceContent }) => {
    const testDir = getTestDir();

    const mcpContent =
      sourceContent ??
      JSON.stringify(
        {
          mcpServers: {
            "test-server": {
              command: "echo",
              args: ["hello"],
            },
          },
        },
        null,
        2,
      );
    await writeFileContent(join(testDir, sourcePath), mcpContent);

    await runImport({ target, features: "mcp" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("test-server");
  });

  it("should import vibe mcp from config.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'theme = "dark"',
        "",
        "[[mcp_servers]]",
        'name = "test-server"',
        'transport = "stdio"',
        'command = "echo"',
        'args = ["hello"]',
      ].join("\n"),
    );

    await runImport({ target: "vibe", features: "mcp" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("test-server");
    expect(importedContent).toContain("hello");
  });

  // Zed stores MCP servers under `context_servers` (not `mcpServers`) inside a
  // shared settings.json, so it needs a bespoke source rather than the generic
  // `mcpServers`-seeded import case above.
  it("should import zed mcp from context_servers", async () => {
    const testDir = getTestDir();

    const settingsContent = JSON.stringify(
      {
        private_files: ["**/.env"],
        context_servers: {
          "test-server": { command: "echo", args: ["hello"] },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".zed", "settings.json"), settingsContent);

    await runImport({ target: "zed", features: "mcp" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("test-server");
  });
});

describe("E2E: mcp (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "augmentcode", outputPath: join(".augment", "settings.json") },
    { target: "claudecode", outputPath: ".claude.json" },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "goose", outputPath: join(".config", "goose", "config.yaml") },
    { target: "opencode", outputPath: join(".config", "opencode", "opencode.jsonc") },
    { target: "codexcli", outputPath: join(".codex", "config.toml") },
    { target: "copilotcli", outputPath: join(".copilot", "mcp-config.json") },
    { target: "deepagents", outputPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
    { target: "rovodev", outputPath: join(".rovodev", "mcp.json") },
    {
      target: "cline",
      outputPath: join(".cline", "data", "settings", "cline_mcp_settings.json"),
    },
    { target: "kilo", outputPath: join(".config", "kilo", "kilo.jsonc") },
    { target: "junie", outputPath: join(".junie", "mcp", "mcp.json") },
    { target: "amp", outputPath: join(".config", "amp", "settings.jsonc") },
    {
      target: "antigravity-ide",
      outputPath: join(".gemini", "config", "mcp_config.json"),
    },
    {
      target: "antigravity-cli",
      outputPath: join(".gemini", "config", "mcp_config.json"),
    },
    { target: "warp", outputPath: join(".warp", ".mcp.json") },
    { target: "zed", outputPath: join(".config", "zed", "settings.json") },
    {
      target: "devin",
      outputPath: join(".codeium", "windsurf", "mcp_config.json"),
    },
    { target: "vibe", outputPath: join(".vibe", "config.toml") },
  ])("should generate $target mcp in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create .rulesync/mcp.json with root: true and a test MCP server
    const mcpContent = JSON.stringify(
      {
        root: true,
        mcpServers: {
          "test-server": {
            description: "Test MCP server",
            type: "stdio",
            command: "echo",
            args: ["hello"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    // Execute: Generate mcp in global mode with HOME pointed to temp dir
    await runGenerate({
      target,
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify that the expected output file was generated and contains the server
    const generatedContent = await readFileContent(join(homeDir, outputPath));
    expect(generatedContent).toContain("test-server");
  });

  it("should preserve legacy ~/.claude/.claude.json when writing to recommended path (global)", async () => {
    // Pins both behaviors end-to-end: (a) canonical ~/.claude.json receives
    // fresh mcpServers AND preserves Claude Code's own user-config keys via
    // RMW; (b) legacy ~/.claude/.claude.json is byte-identical after
    // generate (matches the no-destructive-action invariant from PR #333).
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Pre-seed the canonical ~/.claude.json with Claude Code's own keys.
    await writeFileContent(
      join(homeDir, ".claude.json"),
      JSON.stringify(
        {
          mcpServers: { "previously-managed": { command: "node" } },
          projects: { "/home/user/proj-a": { allowedTools: ["*"] } },
          feedbackSurveyState: { lastShownAt: 1234567890 },
        },
        null,
        2,
      ),
    );

    // Pre-seed a legacy orphan with specific content for byte-identical check.
    const legacyPath = join(homeDir, ".claude", ".claude.json");
    const legacyContent = JSON.stringify(
      { mcpServers: { "stale-server": { command: "node", args: ["stale.js"] } } },
      null,
      2,
    );
    await writeFileContent(legacyPath, legacyContent);

    // Source: a fresh server in .rulesync/mcp.json.
    const mcpContent = JSON.stringify(
      {
        root: true,
        mcpServers: {
          "test-server": {
            description: "Test MCP server",
            type: "stdio",
            command: "echo",
            args: ["hello"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

    await runGenerate({
      target: "claudecode",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Canonical ~/.claude.json has fresh mcpServers from rulesync and
    // retains Claude Code's own user-config keys via RMW spread.
    const newContent = await readFileContent(join(homeDir, ".claude.json"));
    expect(newContent).toContain("test-server");
    expect(newContent).not.toContain("previously-managed");
    expect(newContent).toContain("projects");
    expect(newContent).toContain("/home/user/proj-a");
    expect(newContent).toContain("feedbackSurveyState");
    expect(newContent).toContain("1234567890");

    // Legacy file is preserved byte-for-byte. rulesync never modifies it.
    expect(await fileExists(legacyPath)).toBe(true);
    expect(await readFileContent(legacyPath)).toBe(legacyContent);
  });

  it("should ignore non-root mcp in global mode", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Setup: Create a root mcp config and a non-root mcp config (legacy path)
    const rootMcpContent = JSON.stringify(
      {
        root: true,
        mcpServers: {
          "root-server": {
            description: "Root MCP server",
            type: "stdio",
            command: "echo",
            args: ["root"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    const nonRootMcpContent = JSON.stringify(
      {
        mcpServers: {
          "non-root-server": {
            description: "Non-root MCP server",
            type: "stdio",
            command: "echo",
            args: ["non-root"],
            env: {},
          },
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH), rootMcpContent);
    await writeFileContent(join(projectDir, ".rulesync", ".mcp.json"), nonRootMcpContent);

    // Execute: Generate mcp in global mode
    await runGenerate({
      target: "claudecode",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Verify: root mcp content is present, non-root mcp content is absent
    const generatedContent = await readFileContent(join(homeDir, ".claude.json"));
    expect(generatedContent).toContain("root-server");
    expect(generatedContent).not.toContain("non-root-server");
  });
});

function toTable(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function toTableArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(toTable);
}
