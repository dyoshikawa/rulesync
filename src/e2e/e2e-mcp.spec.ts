import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
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
    { target: "claudecode", outputPath: ".mcp.json" },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "codexcli", outputPath: join(".codex", "config.toml") },
    { target: "copilot", outputPath: join(".vscode", "mcp.json") },
    { target: "copilotcli", outputPath: join(".copilot", "mcp-config.json") },
    { target: "opencode", outputPath: "opencode.jsonc" },
    { target: "deepagents", outputPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
    { target: "cline", outputPath: join(".cline", "mcp.json") },
    { target: "kilo", outputPath: "kilo.jsonc" },
    { target: "roo", outputPath: join(".roo", "mcp.json") },
    { target: "kiro", outputPath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", outputPath: join(".junie", "mcp", "mcp.json") },
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
    // geminicli, codexcli, opencode, kilo use merged config files (isDeletable=false) — excluded
    { target: "claudecode", orphanPath: ".mcp.json" },
    { target: "cursor", orphanPath: join(".cursor", "mcp.json") },
    { target: "copilot", orphanPath: join(".vscode", "mcp.json") },
    { target: "copilotcli", orphanPath: join(".copilot", "mcp-config.json") },
    { target: "deepagents", orphanPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", orphanPath: join(".factory", "mcp.json") },
    { target: "cline", orphanPath: join(".cline", "mcp.json") },
    { target: "roo", orphanPath: join(".roo", "mcp.json") },
    { target: "kiro", orphanPath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", orphanPath: join(".junie", "mcp", "mcp.json") },
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
    { target: "cline", sourcePath: join(".cline", "mcp.json") },
    { target: "roo", sourcePath: join(".roo", "mcp.json") },
    { target: "kiro", sourcePath: join(".kiro", "settings", "mcp.json") },
    { target: "junie", sourcePath: join(".junie", "mcp", "mcp.json") },
  ])("should import $target mcp", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const mcpContent = JSON.stringify(
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
});

describe("E2E: mcp (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", ".claude.json") },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "opencode", outputPath: join(".config", "opencode", "opencode.jsonc") },
    { target: "codexcli", outputPath: join(".codex", "config.toml") },
    { target: "copilotcli", outputPath: join(".copilot", "mcp-config.json") },
    { target: "deepagents", outputPath: join(".deepagents", ".mcp.json") },
    { target: "factorydroid", outputPath: join(".factory", "mcp.json") },
    { target: "rovodev", outputPath: join(".rovodev", "mcp.json") },
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
    const generatedContent = await readFileContent(join(homeDir, ".claude", ".claude.json"));
    expect(generatedContent).toContain("root-server");
    expect(generatedContent).not.toContain("non-root-server");
  });
});
