import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { McpProcessor } from "./mcp-processor.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

/**
 * Canonically an empty `enabledTools` allowlist allows no tools at all. The
 * targets below read an empty (or missing) list as "no filter", so a server
 * carrying one must be skipped rather than written unfiltered.
 */
describe("MCP servers with an empty enabledTools allowlist", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  const generate = async ({
    toolTarget,
    global,
    mcpServers,
  }: {
    toolTarget:
      | "factorydroid"
      | "pool"
      | "crush"
      | "openclaw"
      | "opencode"
      | "opencodev1"
      | "mimocode"
      | "kilo";
    global: boolean;
    mcpServers: Record<string, unknown>;
  }) => {
    const logger = createMockLogger();
    const rulesyncMcp = new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify({ mcpServers }),
    });
    const processor = new McpProcessor({ logger, outputRoot: testDir, toolTarget, global });
    const files = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);
    return { content: files.map((file) => file.getFileContent()).join("\n"), logger };
  };

  it.each([
    { toolTarget: "factorydroid", global: false },
    { toolTarget: "pool", global: false },
    { toolTarget: "crush", global: false },
    { toolTarget: "openclaw", global: true },
    { toolTarget: "opencode", global: false },
    { toolTarget: "opencodev1", global: false },
    { toolTarget: "mimocode", global: false },
    { toolTarget: "kilo", global: false },
  ] as const)("skips the server with a warning for $toolTarget", async ({ toolTarget, global }) => {
    const { content, logger } = await generate({
      toolTarget,
      global,
      mcpServers: {
        "no-tools-server": {
          type: "stdio",
          command: "node",
          args: ["no-tools.js"],
          enabledTools: [],
        },
        "kept-server": { type: "stdio", command: "node", args: ["kept.js"] },
      },
    });

    expect(content).not.toContain("no-tools-server");
    expect(content).not.toContain("no-tools.js");
    expect(content).toContain("kept.js");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("an empty enabledTools list"));
  });

  it("treats an OpenClaw allowlist of only blank names as empty", async () => {
    const { content, logger } = await generate({
      toolTarget: "openclaw",
      global: true,
      mcpServers: {
        "blank-server": { type: "stdio", command: "node", args: ["blank.js"], enabledTools: [" "] },
        "listed-server": {
          type: "stdio",
          command: "node",
          args: ["listed.js"],
          enabledTools: [" ", "read"],
        },
      },
    });

    expect(content).not.toContain("blank.js");
    expect(content).toContain("listed.js");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("an empty enabledTools list"));
  });
});
