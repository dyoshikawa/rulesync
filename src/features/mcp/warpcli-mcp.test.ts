import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { McpProcessor } from "./mcp-processor.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { WarpcliMcp } from "./warpcli-mcp.js";

describe("WarpcliMcp", () => {
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

  describe("getSettablePaths", () => {
    it.each([
      ["darwin", ".warp_cli"],
      ["linux", join(".config", "warp-terminal", "cli")],
      ["win32", join("AppData", "Local", "warp", "Warp", "config", "cli")],
    ] as const)("targets the CLI's own .mcp.json on %s", (platform, expectedDir) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);

      expect(WarpcliMcp.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: expectedDir,
        relativeFilePath: ".mcp.json",
      });
    });
  });

  describe("fromRulesyncMcp", () => {
    it("returns a WarpcliMcp at the CLI path and maps cwd to working_directory", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { local: { command: "node", args: ["server.js"], cwd: "/srv" } },
        }),
      });

      const warpcliMcp = await WarpcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(warpcliMcp).toBeInstanceOf(WarpcliMcp);
      expect(warpcliMcp.getRelativeDirPath()).toBe(WarpcliMcp.getSettablePaths().relativeDirPath);
      expect(warpcliMcp.getJson()).toEqual({
        mcpServers: {
          local: { working_directory: "/srv", command: "node", args: ["server.js"] },
        },
      });
    });

    it("preserves other top-level keys of an existing file", async () => {
      const paths = WarpcliMcp.getSettablePaths();
      await ensureDir(join(testDir, paths.relativeDirPath));
      await writeFileContent(
        join(testDir, paths.relativeDirPath, paths.relativeFilePath),
        JSON.stringify({ mcpServers: { old: { command: "old" } }, other: true }),
      );
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({ mcpServers: { fresh: { command: "fresh" } } }),
      });

      const warpcliMcp = await WarpcliMcp.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        global: true,
      });

      expect(warpcliMcp.getJson()).toEqual({
        mcpServers: { fresh: { command: "fresh" } },
        other: true,
      });
    });
  });

  describe("fromFile", () => {
    it("imports working_directory back to cwd", async () => {
      const paths = WarpcliMcp.getSettablePaths();
      await ensureDir(join(testDir, paths.relativeDirPath));
      await writeFileContent(
        join(testDir, paths.relativeDirPath, paths.relativeFilePath),
        JSON.stringify({ mcpServers: { local: { command: "node", working_directory: "/srv" } } }),
      );

      const warpcliMcp = await WarpcliMcp.fromFile({ outputRoot: testDir, global: true });

      expect(warpcliMcp).toBeInstanceOf(WarpcliMcp);
      const imported = JSON.parse(warpcliMcp.toRulesyncMcp().getFileContent());
      expect(imported.mcpServers).toEqual({ local: { command: "node", cwd: "/srv" } });
    });
  });

  describe("McpProcessor", () => {
    it("is a global-only target", () => {
      expect(McpProcessor.getToolTargets({ global: false })).not.toContain("warpcli");
      expect(McpProcessor.getToolTargets({ global: true })).toContain("warpcli");
    });

    it("applies the warpcli tool-scoped block", async () => {
      const rulesyncMcp = new RulesyncMcp({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
        fileContent: JSON.stringify({
          mcpServers: { shared: { command: "shared" } },
          warpcli: { mcpServers: { cliOnly: { command: "cli-only" } } },
        }),
      });
      const processor = new McpProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "warpcli",
        global: true,
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncMcp]);
      await processor.writeAiFiles(toolFiles);

      const paths = WarpcliMcp.getSettablePaths();
      const written = JSON.parse(
        await readFileContent(join(testDir, paths.relativeDirPath, paths.relativeFilePath)),
      );
      expect(Object.keys(written.mcpServers).toSorted()).toEqual(["cliOnly", "shared"]);
    });
  });
});
