import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ReasonixMcp } from "./reasonix-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("ReasonixMcp", () => {
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

  it("should export rulesync MCP servers as Reasonix [[plugins]] and preserve config keys", async () => {
    await writeFileContent(
      join(testDir, "reasonix.toml"),
      ['default_model = "deepseek"', "", "[ui]", 'theme = "dark"'].join("\n"),
    );

    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          filesystem: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
            env: { ROOT: "/path" },
          },
          remote: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;

    expect(parsed.default_model).toBe("deepseek");
    expect(parsed.ui.theme).toBe("dark");
    expect(parsed.plugins).toMatchObject([
      {
        name: "filesystem",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
        env: { ROOT: "/path" },
      },
      {
        name: "remote",
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    ]);
  });

  it("should import Reasonix [[plugins]] into rulesync mcpServers", () => {
    const fileContent = [
      'default_model = "deepseek"',
      "",
      "[[plugins]]",
      'name = "filesystem"',
      'type = "stdio"',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-filesystem", "/path"]',
      "",
      "[[plugins]]",
      'name = "remote"',
      'type = "http"',
      'url = "https://example.com/mcp"',
      'headers = { Authorization = "Bearer token" }',
    ].join("\n");

    const reasonixMcp = new ReasonixMcp({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
      fileContent,
    });

    const parsed = JSON.parse(reasonixMcp.toRulesyncMcp().getFileContent());

    expect(parsed.mcpServers).toMatchObject({
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      },
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
  });

  it("should default the transport to stdio for command-based servers", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          local: { command: "node", args: ["server.js"] },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
    expect(parsed.plugins[0]).toMatchObject({ name: "local", type: "stdio", command: "node" });
  });

  it("should collapse the deprecated sse transport onto http", async () => {
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({
        mcpServers: {
          legacy: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    });

    const reasonixMcp = await ReasonixMcp.fromRulesyncMcp({ outputRoot: testDir, rulesyncMcp });
    const parsed = smolToml.parse(reasonixMcp.getFileContent()) as any;
    expect(parsed.plugins[0].type).toBe("http");
  });

  it("should write the global config to .reasonix/config.toml", () => {
    expect(ReasonixMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".reasonix",
      relativeFilePath: "config.toml",
    });
    expect(ReasonixMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
    });
  });

  it("should not be deletable because the config file is shared", () => {
    const reasonixMcp = ReasonixMcp.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "reasonix.toml",
    });

    expect(reasonixMcp.isDeletable()).toBe(false);
  });
});
