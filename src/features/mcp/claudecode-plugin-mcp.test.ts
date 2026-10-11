import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClaudecodePluginMcp } from "./claudecode-plugin-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ClaudecodePluginMcp", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  const buildRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  const generate = async (mcpServers: Record<string, unknown>) => {
    const mcp = await ClaudecodePluginMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp(mcpServers),
    });
    return { mcp, servers: JSON.parse(mcp.getFileContent()).mcpServers };
  };

  it("writes .mcp.json at the plugin root like claudecode", async () => {
    const { mcp } = await generate({});
    expect(mcp).toBeInstanceOf(ClaudecodePluginMcp);
    expect(mcp.getRelativeFilePath()).toBe(ClaudecodeMcp.getSettablePaths().relativeFilePath);
  });

  it.each([
    ["./servers/db-server", "${CLAUDE_PLUGIN_ROOT}/servers/db-server"],
    ["servers/db-server", "${CLAUDE_PLUGIN_ROOT}/servers/db-server"],
  ])("anchors the relative command %s to the plugin root", async (command, expected) => {
    const { servers } = await generate({ db: { command } });
    expect(servers.db.command).toBe(expected);
  });

  it.each([
    "npx",
    "node",
    "/usr/local/bin/server",
    "~/bin/server",
    "../shared/server",
    "${CLAUDE_PLUGIN_ROOT}/server",
    "$HOME/bin/server",
  ])("leaves the command %s as written", async (command) => {
    const { servers } = await generate({ s: { command } });
    expect(servers.s.command).toBe(command);
  });

  it.each([
    [
      { command: "node", args: ["./dist/server.js", "--port", "8080"] },
      { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.js", "--port", "8080"] },
    ],
    [
      { command: "python3", args: ["-u", "./server.py", "./data"] },
      { command: "python3", args: ["-u", "${CLAUDE_PLUGIN_ROOT}/server.py", "./data"] },
    ],
    [
      { command: "uv", args: ["run", "--quiet", "./server.py"] },
      { command: "uv", args: ["run", "--quiet", "${CLAUDE_PLUGIN_ROOT}/server.py"] },
    ],
    [
      { command: ["node", "./dist/server.js"], args: ["./data"] },
      { command: ["node", "${CLAUDE_PLUGIN_ROOT}/dist/server.js"], args: ["./data"] },
    ],
  ])("anchors the script a runner executes in %j", async (server, expected) => {
    const { servers } = await generate({ s: server });
    expect(servers.s).toEqual(expected);
  });

  it.each([
    [
      { command: "node", args: ["-r", "./register.js", "./dist/server.js"] },
      {
        command: "node",
        args: ["-r", "${CLAUDE_PLUGIN_ROOT}/register.js", "${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      },
    ],
    [
      { command: "uv", args: ["run", "--with", "requests", "./server.py"] },
      { command: "uv", args: ["run", "--with", "requests", "${CLAUDE_PLUGIN_ROOT}/server.py"] },
    ],
    [
      { command: "bun", args: ["--smol", "run", "./x.ts"] },
      { command: "bun", args: ["--smol", "run", "${CLAUDE_PLUGIN_ROOT}/x.ts"] },
    ],
    [
      { command: "bun", args: ["./x.ts"] },
      { command: "bun", args: ["${CLAUDE_PLUGIN_ROOT}/x.ts"] },
    ],
    [
      { command: "npx", args: ["tsx", "./server.ts", "./data"] },
      { command: "npx", args: ["tsx", "${CLAUDE_PLUGIN_ROOT}/server.ts", "./data"] },
    ],
    [
      { command: ["node", "--inspect"], args: ["./x.js"] },
      { command: ["node", "--inspect"], args: ["${CLAUDE_PLUGIN_ROOT}/x.js"] },
    ],
  ])("anchors the files a runner loads in %j", async (server, expected) => {
    const { servers } = await generate({ s: server });
    expect(servers.s).toEqual(expected);
  });

  it.each([
    { command: "sh", args: ["-c", "./start.sh --flag"] },
    { command: "bash", args: ["-lc", "./start.sh --flag"] },
    { command: "python3", args: ["-m", "pkg", "./data"] },
    { command: "node", args: ["-e", "1", "./x.js"] },
    { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "./docs"] },
    { command: "node", args: ["dist/server.js"] },
    { command: "node", args: ["${CLAUDE_PLUGIN_DATA}/server.js"] },
    { command: "node", args: ["../shared/server.js"] },
  ])("leaves the data arguments of %j as written", async (server) => {
    const { servers } = await generate({ s: server });
    expect(servers.s).toEqual(server);
  });

  it.each([
    ["..\\shared\\server", "..\\shared\\server"],
    ["%APPDATA%\\server.exe", "%APPDATA%\\server.exe"],
    [".\\server.exe", "${CLAUDE_PLUGIN_ROOT}/server.exe"],
  ])("handles the Windows command %s", async (command, expected) => {
    const { servers } = await generate({ s: { command } });
    expect(servers.s.command).toBe(expected);
  });

  it("leaves env, url and headers as written", async () => {
    const { servers } = await generate({
      local: { command: "node", env: { CONFIG: "./config.json" } },
      remote: { type: "http", url: "./not-a-url", headers: { X: "./h" } },
    });
    expect(servers.local.env).toEqual({ CONFIG: "./config.json" });
    expect(servers.remote).toEqual({ type: "http", url: "./not-a-url", headers: { X: "./h" } });
  });

  it.each([
    "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
    '"$CLAUDE_PLUGIN_ROOT"/servers/db-server',
    "$CLAUDE_PLUGIN_ROOT/servers/db-server",
  ])("imports the plugin-root form %s back as ./", async (command) => {
    await writeFileContent(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          db: { command, args: ["--verbose"] },
          script: { command: "node", args: [command.replace("servers/db-server", "server.js")] },
        },
      }),
    );
    const mcp = await ClaudecodePluginMcp.fromFile({ outputRoot: testDir });
    expect(mcp).toBeInstanceOf(ClaudecodePluginMcp);
    expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
      db: { command: "./servers/db-server", args: ["--verbose"] },
      script: { command: "node", args: ["./server.js"] },
    });
  });

  it("keeps a hand-written plugin-root data argument on import", async () => {
    await writeFileContent(
      join(testDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          s: { command: "npx", args: ["some-server", "${CLAUDE_PLUGIN_ROOT}/schema.json"] },
        },
      }),
    );
    const mcp = await ClaudecodePluginMcp.fromFile({ outputRoot: testDir });
    expect(mcp.toRulesyncMcp().getMcpServers()).toEqual({
      s: { command: "npx", args: ["some-server", "${CLAUDE_PLUGIN_ROOT}/schema.json"] },
    });
  });

  it("round-trips a ./ command through generate and import", async () => {
    const { mcp } = await generate({ db: { command: "./servers/db-server", args: ["./a.sql"] } });
    await writeFileContent(join(testDir, ".mcp.json"), mcp.getFileContent());
    const imported = await ClaudecodePluginMcp.fromFile({ outputRoot: testDir });
    expect(imported.toRulesyncMcp().getMcpServers()).toEqual({
      db: { command: "./servers/db-server", args: ["./a.sql"] },
    });
  });

  it("keeps a plain claudecode .mcp.json command untouched", async () => {
    const mcp = await ClaudecodeMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: buildRulesyncMcp({ db: { command: "./servers/db-server" } }),
    });
    expect(JSON.parse(mcp.getFileContent()).mcpServers.db.command).toBe("./servers/db-server");
  });
});
