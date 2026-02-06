import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: mcp", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: ".mcp.json" },
    { target: "cursor", outputPath: join(".cursor", "mcp.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
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
    await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "generate",
      "--targets",
      target,
      "--features",
      "mcp",
    ]);

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

    // Collect stderr output and check for actual errors
    mcpProcess.stderr?.on("data", (data) => {
      const output = data.toString();
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
    expect(hasError).toBe(false);
  });
});
