import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { FirebenderMcp } from "./firebender-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("FirebenderMcp", () => {
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

  const makeRulesyncMcp = (mcpServers: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });

  it("should use firebender.json at the project root and under ~/.firebender globally", () => {
    expect(FirebenderMcp.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "firebender.json",
    });
    expect(FirebenderMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".firebender",
      relativeFilePath: "firebender.json",
    });
  });

  it("should write stdio and remote servers in Firebender's mcpServers shape", async () => {
    const mcp = await FirebenderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        "brave-search": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-brave-search"],
          env: { BRAVE_API_KEY: "key" },
        },
        "api-server": {
          type: "http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer token" },
        },
        orchestrator: { command: ["npx", "-y", "orchestrator-mcp"], deferLoading: false },
      }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      mcpServers: {
        "brave-search": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-brave-search"],
          env: { BRAVE_API_KEY: "key" },
        },
        "api-server": {
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer token" },
        },
        orchestrator: { deferLoading: false, command: "npx", args: ["-y", "orchestrator-mcp"] },
      },
    });
  });

  it("should skip disabled servers and servers without a transport with a warning", async () => {
    const logger = createMockLogger();
    const mcp = await FirebenderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({
        off: { command: "npx", disabled: true },
        empty: { env: { A: "b" } },
        on: { command: "node" },
      }),
      logger,
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({ mcpServers: { on: { command: "node" } } });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("should replace only mcpServers and keep the other keys of firebender.json", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({
        ignore: ["dist/**"],
        mcpServers: { old: { command: "old" } },
        mcpEnvFile: ".env.mcp",
      }),
    );

    const mcp = await FirebenderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ weather: { command: "npx" } }),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({
      ignore: ["dist/**"],
      mcpServers: { weather: { command: "npx" } },
      mcpEnvFile: ".env.mcp",
    });
  });

  it("should retract mcpServers when no server is left", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({ ignore: ["dist/**"], mcpServers: { old: { command: "old" } } }),
    );

    const mcp = await FirebenderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({}),
    });

    expect(JSON.parse(mcp.getFileContent())).toEqual({ ignore: ["dist/**"] });
  });

  it("should write the personal config under .firebender in global mode", async () => {
    const mcp = await FirebenderMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp: makeRulesyncMcp({ weather: { command: "npx" } }),
      global: true,
    });

    expect(mcp.getFilePath()).toBe(join(testDir, ".firebender", "firebender.json"));
  });

  it("should import mcpServers back into rulesync", async () => {
    await writeFileContent(
      join(testDir, "firebender.json"),
      JSON.stringify({
        ignore: ["dist/**"],
        mcpServers: {
          weather: { command: "npx", args: ["-y", "weather"] },
          api: { url: "http://localhost:3000/mcp", deferLoading: false },
        },
      }),
    );

    const mcp = await FirebenderMcp.fromFile({ outputRoot: testDir });

    expect(mcp.toRulesyncMcp().getJson().mcpServers).toEqual({
      weather: { command: "npx", args: ["-y", "weather"] },
      api: { url: "http://localhost:3000/mcp", deferLoading: false },
    });
  });

  it("should never be deletable", () => {
    expect(
      FirebenderMcp.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "firebender.json",
      }).isDeletable(),
    ).toBe(false);
  });
});
