import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
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

describe("E2E: mcp (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: ".mcp.json" },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "opencode", outputPath: join(".opencode", "mcp.json") },
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
    const generatedContent = await readFileContent(join(homeDir, ".mcp.json"));
    expect(generatedContent).toContain("root-server");
    expect(generatedContent).not.toContain("non-root-server");
  });
});
