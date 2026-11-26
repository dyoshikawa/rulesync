import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderMcp } from "./qoder-mcp.js";
import { QodercnMcp } from "./qodercn-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

describe("QodercnMcp", () => {
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

  const makeRulesyncMcp = (config: Record<string, unknown>) =>
    new RulesyncMcp({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "mcp.json",
      fileContent: JSON.stringify(config),
    });

  it("should share the project .mcp.json and use ~/.qoder-cn/settings.json globally", () => {
    expect(QodercnMcp.getSettablePaths()).toEqual(QoderMcp.getSettablePaths());
    expect(QodercnMcp.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".qoder-cn",
      relativeFilePath: "settings.json",
    });
    expect(QoderMcp.getSettablePaths({ global: true }).relativeDirPath).toBe(".qoder");
  });

  it("should write the servers, with the qoder block, into ~/.qoder-cn/settings.json", async () => {
    const rulesyncMcp = makeRulesyncMcp({
      mcpServers: { shared: { command: "shared" } },
      qoder: { mcpServers: { qoderOnly: { command: "qoder-only" } } },
    }).forTarget({ toolTarget: "qodercn", global: true });

    const mcp = await QodercnMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      global: true,
    });

    expect(mcp).toBeInstanceOf(QodercnMcp);
    expect(mcp.getRelativeDirPath()).toBe(".qoder-cn");
    expect(Object.keys(JSON.parse(mcp.getFileContent()).mcpServers).sort()).toEqual([
      "qoderOnly",
      "shared",
    ]);
  });

  it("should resolve the same project .mcp.json servers as qoder", () => {
    const rulesyncMcp = makeRulesyncMcp({
      mcpServers: { shared: { command: "shared" } },
      qoder: { mcpServers: { qoderOnly: { command: "qoder-only" } } },
      claudecode: { mcpServers: { claudeOnly: { command: "claude-only" } } },
    });

    expect(rulesyncMcp.forTarget({ toolTarget: "qodercn" }).getMcpServers()).toEqual(
      rulesyncMcp.forTarget({ toolTarget: "qoder" }).getMcpServers(),
    );
  });
});
