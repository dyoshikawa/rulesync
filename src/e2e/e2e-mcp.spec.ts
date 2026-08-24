import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { load } from "js-yaml";
import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import {
  RULESYNC_MCP_LEGACY_RELATIVE_FILE_PATH,
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import { getZedGlobalDir } from "../constants/zed-paths.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  rulesyncArgs,
  rulesyncCmd,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

// Native MCP tools that emit "test-server" (takt writes a transport allowlist instead).
const mcpGenerateTargets = [
  { target: "aiassistant", outputPath: join(".ai", "mcp", "mcp.json") },
  { target: "augmentcode", outputPath: join(".augment", "settings.json") },
  { target: "amp", outputPath: join(".amp", "settings.json") },
  { target: "claudecode", outputPath: ".mcp.json" },
  { target: "claudecode-plugin", outputPath: ".mcp.json" },
  { target: "cursor", outputPath: join(".cursor", "mcp.json") },
  { target: "qwencode", outputPath: join(".qwen", "settings.json") },
  { target: "codexcli", outputPath: join(".codex", "config.toml") },
  { target: "grokcli", outputPath: join(".grok", "config.toml") },
  { target: "copilot", outputPath: join(".vscode", "mcp.json") },
  { target: "copilotcli", outputPath: join(".github", "mcp.json") },
  { target: "opencode", outputPath: "opencode.jsonc" },
  { target: "deepagents", outputPath: join(".deepagents", ".mcp.json") },
  { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
  { target: "goose", outputPath: join(".agents", "plugins", "rulesync", ".mcp.json") },
  { target: "kilo", outputPath: "kilo.jsonc" },
  { target: "kimi-code", outputPath: join(".kimi-code", "mcp.json") },
  { target: "roo", outputPath: join(".roo", "mcp.json") },
  { target: "zoocode", outputPath: join(".roo", "mcp.json") },
  { target: "kiro", outputPath: join(".kiro", "settings", "mcp.json") },
  { target: "kiro-cli", outputPath: join(".kiro", "settings", "mcp.json") },
  { target: "kiro-ide", outputPath: join(".kiro", "settings", "mcp.json") },
  { target: "junie", outputPath: join(".junie", "mcp", "mcp.json") },
  { target: "antigravity-ide", outputPath: join(".agents", "mcp_config.json") },
  { target: "antigravity-plugin", outputPath: "mcp_config.json" },
  { target: "antigravity-cli", outputPath: join(".agents", "mcp_config.json") },
  { target: "warp", outputPath: join(".warp", ".mcp.json") },
  { target: "zed", outputPath: join(".zed", "settings.json") },
  { target: "devin", outputPath: join(".devin", "mcp_config.json") },
  { target: "vibe", outputPath: join(".vibe", "config.toml") },
  { target: "reasonix", outputPath: "reasonix.toml" },
  { target: "rovodev", outputPath: join(".rovodev", "mcp.json") },
] as const;

describe("E2E: mcp", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native mcp tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: McpProcessor,
      testedTargets: mcpGenerateTargets.map((e) => e.target),
      // takt only writes a transport allowlist to .takt/config.yaml (no
      // "test-server" entry), so it is covered by its own dedicated test
      // "should generate Takt MCP transport allowlist into .takt/config.yaml".
      untested: ["takt"],
    });
  });

  it.each(mcpGenerateTargets)("should generate $target mcp", async ({ target, outputPath }) => {
    const testDir = getTestDir();

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

    await runGenerate({ target, features: "mcp" });

    const generatedContent = await readFileContent(join(testDir, outputPath));
    expect(generatedContent).toContain("test-server");
  });

  it("should point rovodev config.yml at the generated project mcp.json", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({ mcpServers: { "test-server": { command: "echo", args: ["hello"] } } }),
    );

    await runGenerate({ target: "rovodev", features: "mcp" });

    // `.rovodev/mcp.json` alone is inert: Rovo Dev's `mcpConfigPath` defaults
    // to the global MCP file, so the sibling `config.yml` has to name it.
    const configContent = await readFileContent(join(testDir, ".rovodev", "config.yml"));
    expect(configContent).toContain("mcpConfigPath: .rovodev/mcp.json");
  });

  it.each(["kiro", "kiro-cli", "kiro-ide"] as const)(
    "should preserve disabledTools for $target mcp",
    async (target) => {
      const testDir = getTestDir();
      await writeFileContent(
        join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
        JSON.stringify({
          mcpServers: {
            restricted: {
              command: "echo",
              disabledTools: ["delete", "write"],
            },
          },
        }),
      );

      await runGenerate({ target, features: "mcp" });

      const generated = JSON.parse(
        await readFileContent(join(testDir, ".kiro", "settings", "mcp.json")),
      );
      expect(generated.mcpServers.restricted.disabledTools).toEqual(["delete", "write"]);
    },
  );

  it("should map Kimi Code MCP transports and skip unsupported WebSocket servers", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: {
          local: {
            type: "local",
            command: ["node", "server.js"],
            enabledTools: ["read"],
          },
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            bearerTokenEnvVar: "MCP_TOKEN",
          },
          events: {
            type: "sse",
            url: "https://example.com/events",
          },
          socket: {
            type: "ws",
            url: "wss://example.com/mcp",
          },
        },
      }),
    );

    await runGenerate({ target: "kimi-code", features: "mcp" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".kimi-code", "mcp.json")));
    expect(generated.mcpServers).toEqual({
      local: {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        enabledTools: ["read"],
      },
      remote: {
        transport: "http",
        url: "https://example.com/mcp",
        bearerTokenEnvVar: "MCP_TOKEN",
      },
      events: {
        transport: "sse",
        url: "https://example.com/events",
      },
    });
  });

  it("should translate copilotcli enabledTools into the tools allowlist in both directions", async () => {
    const testDir = getTestDir();

    // Covers the processor-level `supportsEnabledTools` flag, not just the
    // adapter: with it off the field is stripped before the adapter sees it and
    // the server silently keeps exposing every tool (issue #2402).
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: {
          github: { command: "gh-mcp", enabledTools: ["create_issue", "list_issues"] },
        },
      }),
    );

    await runGenerate({ target: "copilotcli", features: "mcp" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".github", "mcp.json")));
    expect(generated.mcpServers.github).toEqual({
      type: "stdio",
      command: "gh-mcp",
      tools: ["create_issue", "list_issues"],
    });

    await runImport({ target: "copilotcli", features: "mcp" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.github.enabledTools).toEqual(["create_issue", "list_issues"]);
    expect(imported.mcpServers.github.tools).toBeUndefined();
  });

  it("should translate deepagents MCP transports and tool filters in both directions", async () => {
    const testDir = getTestDir();

    // dcode drops an individual server it cannot validate and keeps loading the
    // rest, so an untranslated `local` transport or an `enabledTools` key fails
    // silently at run time rather than at generate time.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: {
          local: { type: "local", command: "npx", args: ["server"], enabledTools: ["read_*"] },
          remote: { type: "streamable-http", url: "https://example.com/mcp" },
          denied: { command: "npx", disabledTools: ["delete"] },
          socket: { type: "ws", url: "wss://example.com/mcp" },
        },
      }),
    );

    await runGenerate({ target: "deepagents", features: "mcp" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".deepagents", ".mcp.json")));
    expect(generated.mcpServers).toEqual({
      local: { type: "stdio", command: "npx", args: ["server"], allowedTools: ["read_*"] },
      remote: { type: "http", url: "https://example.com/mcp" },
      denied: { command: "npx", disabledTools: ["delete"] },
    });

    await runImport({ target: "deepagents", features: "mcp" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.local.enabledTools).toEqual(["read_*"]);
    expect(imported.mcpServers.denied.disabledTools).toEqual(["delete"]);
    expect(imported.mcpServers.remote.type).toBe("http");
  });

  it("should apply tool-scoped {toolname}.mcpServers blocks and the deprecated targets filter", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          mcpServers: {
            shared: { type: "stdio", command: "echo", args: ["shared"] },
            // DEPRECATED per-server targets: still honored as a filter.
            cursorOnly: { type: "stdio", command: "echo", args: ["cursor"], targets: ["cursor"] },
          },
          claudecode: {
            mcpServers: {
              claudeExtra: { type: "stdio", command: "echo", args: ["claude"] },
              // null removes the shared server for Claude Code only.
              shared: null,
            },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "claudecode", features: "mcp" });
    await runGenerate({ target: "cursor", features: "mcp" });

    const claude = JSON.parse(await readFileContent(join(testDir, ".mcp.json")));
    expect(Object.keys(claude.mcpServers)).toEqual(["claudeExtra"]);

    const cursor = JSON.parse(await readFileContent(join(testDir, ".cursor", "mcp.json")));
    expect(Object.keys(cursor.mcpServers).toSorted()).toEqual(["cursorOnly", "shared"]);
  });

  it("should generate mcp from mcp.jsonc (preferred over mcp.json)", async () => {
    const testDir = getTestDir();

    // The stale .json variant must lose to the .jsonc variant.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_LEGACY_RELATIVE_FILE_PATH),
      JSON.stringify({ mcpServers: { staleServer: { type: "stdio", command: "echo" } } }),
    );
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      `{
        "mcpServers": {
          // JSONC source with comments and trailing commas
          "jsoncServer": { "type": "stdio", "command": "echo", },
        },
      }`,
    );

    await runGenerate({ target: "claudecode", features: "mcp" });

    const content = JSON.parse(await readFileContent(join(testDir, ".mcp.json")));
    expect(Object.keys(content.mcpServers)).toEqual(["jsoncServer"]);
  });

  it("should co-locate amp mcp and permissions in a single settings.json on a clean repo", async () => {
    const testDir = getTestDir();

    // Setup: both an MCP source and a permissions source, no pre-existing Amp settings file.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          mcpServers: {
            "test-server": { type: "stdio", command: "echo", args: ["hello"], env: {} },
          },
        },
        null,
        2,
      ),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({ permission: { edit_file: { "*": "deny" } } }, null, 2),
    );

    // Execute: generate both features together for Amp.
    await runGenerate({ target: "amp", features: "mcp,permissions" });

    // Both adapters default to settings.json, so the keys must co-locate there and
    // no stray settings.jsonc should be created.
    expect(await fileExists(join(testDir, ".amp", "settings.jsonc"))).toBe(false);
    const content = JSON.parse(await readFileContent(join(testDir, ".amp", "settings.json")));
    expect(content["amp.mcpServers"]).toHaveProperty("test-server");
    expect(content["amp.tools.disable"]).toEqual(["edit_file"]);
  });

  it("should write devin mcp to mcp_config.json and permissions to config.json", async () => {
    const testDir = getTestDir();

    // Setup: both an MCP source and a permissions source, no pre-existing Devin config.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          mcpServers: {
            "test-server": { type: "stdio", command: "echo", args: ["hello"], env: {} },
          },
        },
        null,
        2,
      ),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({ permission: { bash: { "rm *": "deny" } } }, null, 2),
    );

    // Execute: generate both features together for Devin. Since v3000.3 MCP
    // servers live in the dedicated mcp_config.json, while permissions keep
    // the shared config.json; the deprecated mcpServers key must not be
    // re-seeded there (Devin auto-migrates it away on startup).
    await runGenerate({ target: "devin", features: "mcp,permissions" });

    const mcpContent = JSON.parse(
      await readFileContent(join(testDir, ".devin", "mcp_config.json")),
    );
    expect(mcpContent.mcpServers).toHaveProperty("test-server");

    const configContent = JSON.parse(await readFileContent(join(testDir, ".devin", "config.json")));
    expect(configContent.permissions.deny).toContain("Exec(rm *)");
    expect(configContent.mcpServers).toBeUndefined();
  });

  it.each([
    // amp, codexcli, grokcli, opencode, kilo use merged config files
    // (isDeletable=false) — excluded
    { target: "claudecode", orphanPath: ".mcp.json" },
    { target: "cursor", orphanPath: join(".cursor", "mcp.json") },
    { target: "copilot", orphanPath: join(".vscode", "mcp.json") },
    { target: "copilotcli", orphanPath: join(".github", "mcp.json") },
    { target: "deepagents", orphanPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", orphanPath: join(".factory", "mcp.json") },
    { target: "roo", orphanPath: join(".roo", "mcp.json") },
    { target: "kiro", orphanPath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", orphanPath: join(".junie", "mcp", "mcp.json") },
    { target: "goose", orphanPath: join(".agents", "plugins", "rulesync", ".mcp.json") },
    { target: "devin", orphanPath: join(".devin", "mcp_config.json") },
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
      outputPath: join(".amp", "settings.json"),
      content: JSON.stringify({ "amp.dangerouslyAllowAll": false, "amp.mcpServers": {} }, null, 2),
    },
    {
      target: "codexcli",
      outputPath: join(".codex", "config.toml"),
      content: '[ui]\ntheme = "dark"\n',
    },
    {
      target: "grokcli",
      outputPath: join(".grok", "config.toml"),
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
    {
      target: "reasonix",
      outputPath: "reasonix.toml",
      content: 'default_model = "deepseek"\n',
    },
    {
      target: "takt",
      outputPath: join(".takt", "config.yaml"),
      content: "provider: claude\n",
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

  it("should carry disabledTools through the Vibe processor in both directions", async () => {
    const testDir = getTestDir();

    // Through the processor, not the adapter: the factory's
    // `supportsDisabledTools` flag strips the field before the adapter sees it,
    // so a unit test on the adapter alone cannot catch a regression here.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: { srv: { command: "node", args: ["server.js"], disabledTools: ["rm"] } },
      }),
    );

    await runGenerate({ target: "vibe", features: "mcp" });

    const generated = toTable(
      smolToml.parse(await readFileContent(join(testDir, ".vibe", "config.toml"))),
    );
    expect(toTableArray(generated.mcp_servers)[0]).toMatchObject({
      name: "srv",
      disabled_tools: ["rm"],
    });

    await runImport({ target: "vibe", features: "mcp" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.srv.disabledTools).toEqual(["rm"]);
  });

  it("should carry disabledTools through the Zoo Code processor in both directions", async () => {
    const testDir = getTestDir();

    // Zoo Code's per-server MCP schema is denylist-only: `disabledTools` clears
    // each named tool's `enabledForPrompt`, and there is no `enabledTools`.
    // `RooMcp` spreads the server verbatim, so only the processor's
    // `supportsDisabledTools` flag decides whether the field survives.
    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: { srv: { command: "node", args: ["server.js"], disabledTools: ["rm"] } },
      }),
    );

    await runGenerate({ target: "zoocode", features: "mcp" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".roo", "mcp.json")));
    expect(generated.mcpServers.srv.disabledTools).toEqual(["rm"]);

    await runImport({ target: "zoocode", features: "mcp" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.srv.disabledTools).toEqual(["rm"]);
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
    expect(bash.allowlist).toEqual(["git *"]);
    // The canonical `edit` category targets Vibe's `edit` tool; `write_file` is
    // a separate, create-only tool.
    expect(parsed.disabled_tools).toContain("edit");
  });

  it("should generate Takt MCP transport allowlist into .takt/config.yaml", async () => {
    const testDir = getTestDir();

    // Pre-seed an unrelated key so the in-place merge can be asserted.
    await writeFileContent(join(testDir, ".takt", "config.yaml"), "provider: claude\n");

    await writeFileContent(
      join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          mcpServers: {
            "test-server": { type: "stdio", command: "echo", args: ["hello"] },
            "remote-server": { type: "http", url: "https://example.com/mcp" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "takt", features: "mcp" });

    const parsed = toTable(
      load(await readFileContent(join(testDir, ".takt", "config.yaml"))) as Record<string, unknown>,
    );
    // The default-deny transport allowlist reflects the servers' transports.
    expect(toTable(parsed.workflow_mcp_servers)).toEqual({ stdio: true, sse: false, http: true });
    // The unrelated key is preserved by the in-place merge.
    expect(parsed.provider).toBe("claude");
    // Server definitions are NOT representable in config.yaml and are not written.
    const raw = await readFileContent(join(testDir, ".takt", "config.yaml"));
    expect(raw).not.toContain("test-server");
    expect(raw).not.toContain("remote-server");
  });

  it("should generate Reasonix MCP into reasonix.toml as [[plugins]] entries", async () => {
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

    await runGenerate({ target: "reasonix", features: "mcp" });

    const parsed = toTable(smolToml.parse(await readFileContent(join(testDir, "reasonix.toml"))));
    expect(toTableArray(parsed.plugins)).toMatchObject([
      { name: "test-server", type: "stdio", command: "echo", args: ["hello"] },
    ]);
  });
});

describe("E2E: mcp (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "augmentcode", sourcePath: join(".augment", "settings.json") },
    { target: "claudecode", sourcePath: ".mcp.json" },
    { target: "cursor", sourcePath: join(".cursor", "mcp.json") },
    // copilot MCP uses VS Code-specific format — excluded from import test
    { target: "copilotcli", sourcePath: join(".github", "mcp.json") },
    { target: "deepagents", sourcePath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", sourcePath: join(".factory", "mcp.json") },
    { target: "kimi-code", sourcePath: join(".kimi-code", "mcp.json") },
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
    // Legacy pre-v3000.3 location: import must fall back to config.json's
    // mcpServers key when no mcp_config.json exists.
    { target: "devin", sourcePath: join(".devin", "config.json") },
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

  it("should import reasonix mcp from reasonix.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "reasonix.toml"),
      [
        'default_model = "deepseek"',
        "",
        "[[plugins]]",
        'name = "test-server"',
        'type = "stdio"',
        'command = "echo"',
        'args = ["hello"]',
      ].join("\n"),
    );

    await runImport({ target: "reasonix", features: "mcp" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("test-server");
    expect(importedContent).toContain("hello");
  });

  it("should import Kiro MCP disabledTools", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, ".kiro", "settings", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          restricted: {
            command: "echo",
            disabledTools: ["delete", "write"],
          },
        },
      }),
    );

    await runImport({ target: "kiro-cli", features: "mcp" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.restricted.disabledTools).toEqual(["delete", "write"]);
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

// Native global-scope MCP tools that emit "test-server" (takt writes a transport allowlist instead).
const mcpGlobalTargets = [
  { target: "aiassistant", outputPath: join(".ai", "mcp", "mcp.json") },
  { target: "augmentcode", outputPath: join(".augment", "settings.json") },
  { target: "claudecode", outputPath: ".claude.json" },
  { target: "cursor", outputPath: join(".cursor", "mcp.json") },
  { target: "qwencode", outputPath: join(".qwen", "settings.json") },
  { target: "goose", outputPath: join(".config", "goose", "config.yaml") },
  { target: "hermesagent", outputPath: join(getHermesagentGlobalDir(), "config.yaml") },
  { target: "opencode", outputPath: join(".config", "opencode", "opencode.jsonc") },
  { target: "codexcli", outputPath: join(".codex", "config.toml") },
  { target: "grokcli", outputPath: join(".grok", "config.toml") },
  { target: "copilotcli", outputPath: join(".copilot", "mcp-config.json") },
  { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
  { target: "rovodev", outputPath: join(".rovodev", "mcp.json") },
  {
    target: "cline",
    outputPath: join(".cline", "data", "settings", "cline_mcp_settings.json"),
  },
  { target: "musecode", outputPath: join(".config", "muse", "settings.json") },
  { target: "kilo", outputPath: join(".config", "kilo", "kilo.jsonc") },
  { target: "kimi-code", outputPath: join(".kimi-code", "mcp.json") },
  { target: "junie", outputPath: join(".junie", "mcp", "mcp.json") },
  { target: "amp", outputPath: join(".config", "amp", "settings.json") },
  {
    target: "antigravity-ide",
    outputPath: join(".gemini", "config", "mcp_config.json"),
  },
  {
    target: "antigravity-cli",
    outputPath: join(".gemini", "config", "mcp_config.json"),
  },
  { target: "warp", outputPath: join(".warp", ".mcp.json") },
  { target: "zed", outputPath: join(getZedGlobalDir(), "settings.json") },
  {
    target: "devin",
    outputPath: join(".config", "devin", "mcp_config.json"),
  },
  { target: "vibe", outputPath: join(".vibe", "config.toml") },
  { target: "reasonix", outputPath: join(".reasonix", "config.toml") },
  { target: "kiro", outputPath: join(".kiro", "settings", "mcp.json") },
  { target: "kiro-cli", outputPath: join(".kiro", "settings", "mcp.json") },
  { target: "kiro-ide", outputPath: join(".kiro", "settings", "mcp.json") },
] as const;

describe("E2E: mcp (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("generate matrix must cover every native mcp tool target in global mode", () => {
    assertGenerateMatrixCoversTargets({
      processor: McpProcessor,
      testedTargets: mcpGlobalTargets.map((e) => e.target),
      global: true,
      // takt only writes a transport allowlist to ~/.takt/config.yaml (no
      // "test-server" entry), so it is covered by its own dedicated global test
      // "should generate Takt MCP transport allowlist into ~/.takt/config.yaml (global)".
      //
      // deepagents skips a server that sets both tool filters — which the shared
      // fixture below deliberately does — because dcode rejects that combination
      // outright. It has its own dedicated global test
      // "should generate deepagents MCP into ~/.deepagents/.mcp.json (global)".
      untested: ["takt", "deepagents"],
    });
  });

  it("should generate and import the Kimi Code global MCP timeout defaults", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // `[mcp]` in the shared user config sets the default for every server,
    // including ones rulesync did not write; per-server values still win.
    await writeFileContent(
      join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        mcpServers: { remote: { type: "http", url: "https://example.com/mcp" } },
        "kimi-code": { startupTimeoutMs: 45000, toolTimeoutMs: 90000 },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(generated.mcp).toEqual({ startup_timeout_ms: 45000, tool_timeout_ms: 90000 });
    // The servers themselves stay in mcp.json.
    expect(
      JSON.parse(await readFileContent(join(homeDir, ".kimi-code", "mcp.json"))).mcpServers.remote
        .url,
    ).toBe("https://example.com/mcp");

    await runImport({
      target: "kimi-code",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported["kimi-code"]).toEqual({ startupTimeoutMs: 45000, toolTimeoutMs: 90000 });
  });

  it("should import Hermes OAuth and lifecycle settings into a target override", async () => {
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
      [
        "mcp_servers:",
        "  remote:",
        "    url: https://example.com/mcp",
        "    idle_timeout_seconds: 300",
        "    max_lifetime_seconds: 3600",
        "    tools:",
        "      include: [read]",
        "      exclude: [delete]",
        "    oauth:",
        "      redirect_uri: http://localhost:8080/callback",
        "      redirect_port: 8080",
        "      client_id: rulesync-e2e",
        "      scopes: [read, write]",
      ].join("\n"),
    );

    await runImport({
      target: "hermesagent",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_MCP_RELATIVE_FILE_PATH)),
    );
    expect(imported.mcpServers.remote).toEqual({
      url: "https://example.com/mcp",
      enabledTools: ["read"],
      disabledTools: ["delete"],
    });
    expect(imported.hermesagent.mcpServers.remote).toMatchObject({
      idle_timeout_seconds: 300,
      max_lifetime_seconds: 3600,
      oauth: {
        redirect_uri: "http://localhost:8080/callback",
        redirect_port: 8080,
        client_id: "rulesync-e2e",
        scopes: ["read", "write"],
      },
    });
  });

  it.each(mcpGlobalTargets)(
    "should generate $target mcp in home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

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
              enabledTools: ["read"],
              disabledTools: ["delete"],
            },
          },
        },
        null,
        2,
      );
      await writeFileContent(join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH), mcpContent);

      await runGenerate({
        target,
        features: "mcp",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      expect(generatedContent).toContain("test-server");
      if (target === "hermesagent") {
        const parsed = toTable(load(generatedContent) as Record<string, unknown>);
        const mcpServers = toTable(parsed.mcp_servers);
        const server = toTable(mcpServers["test-server"]);
        expect(toTable(server.tools)).toEqual({
          include: ["read"],
          exclude: ["delete"],
        });
      }
    },
  );

  it("should generate deepagents MCP into ~/.deepagents/.mcp.json (global)", async () => {
    // Not part of the shared global matrix: that fixture sets both tool filters
    // on one server, and dcode rejects a server that does, so deepagents skips
    // it. This covers the same ground with one filter per server, and pins the
    // skip end to end.
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify({
        root: true,
        mcpServers: {
          "test-server": {
            type: "stdio",
            command: "echo",
            args: ["hello"],
            enabledTools: ["read"],
          },
          denied: { command: "echo", disabledTools: ["delete"] },
          both: { command: "echo", enabledTools: ["read"], disabledTools: ["delete"] },
        },
      }),
    );

    await runGenerate({
      target: "deepagents",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(await readFileContent(join(homeDir, ".deepagents", ".mcp.json")));
    expect(generated.mcpServers).toEqual({
      "test-server": { type: "stdio", command: "echo", args: ["hello"], allowedTools: ["read"] },
      denied: { command: "echo", disabledTools: ["delete"] },
    });
  });

  it("should generate Takt MCP transport allowlist into ~/.takt/config.yaml (global)", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_MCP_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          root: true,
          mcpServers: {
            "test-server": { type: "sse", url: "https://example.com/sse" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "takt",
      features: "mcp",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = toTable(
      load(await readFileContent(join(homeDir, ".takt", "config.yaml"))) as Record<string, unknown>,
    );
    expect(toTable(parsed.workflow_mcp_servers)).toEqual({ stdio: false, sse: true, http: false });
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

    // Source: a fresh server in .rulesync/mcp.jsonc.
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
