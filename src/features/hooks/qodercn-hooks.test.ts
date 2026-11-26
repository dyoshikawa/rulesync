import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderHooks } from "./qoder-hooks.js";
import { QodercnHooks } from "./qodercn-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("QodercnHooks", () => {
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

  it("should share .qoder/settings.json in project scope and use ~/.qoder-cn/settings.json globally", () => {
    expect(QodercnHooks.getSettablePaths()).toEqual(QoderHooks.getSettablePaths());
    expect(QodercnHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".qoder-cn",
      relativeFilePath: "settings.json",
    });
    expect(QoderHooks.getSettablePaths({ global: true }).relativeDirPath).toBe(".qoder");
  });

  it("should write the qoder override hooks into ~/.qoder-cn/settings.json", async () => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({
        version: 1,
        hooks: {},
        qoder: { hooks: { stop: [{ command: "echo done" }] } },
      }),
      validate: false,
    });

    const hooks = await QodercnHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      global: true,
    });

    expect(hooks.getRelativeDirPath()).toBe(".qoder-cn");
    expect(JSON.parse(hooks.getFileContent()).hooks.Stop).toBeDefined();
  });
});
