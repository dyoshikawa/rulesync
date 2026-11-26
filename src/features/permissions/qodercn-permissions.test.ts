import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { QoderPermissions } from "./qoder-permissions.js";
import { QodercnPermissions } from "./qodercn-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("QodercnPermissions", () => {
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
    expect(QodercnPermissions.getSettablePaths()).toEqual(QoderPermissions.getSettablePaths());
    expect(QodercnPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".qoder-cn",
      relativeFilePath: "settings.json",
    });
    expect(QoderPermissions.getSettablePaths({ global: true }).relativeDirPath).toBe(".qoder");
  });

  it("should apply the qoder block when generating for qodercn", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "ls *": "allow" } },
        // A tool-scoped category replaces the shared one wholesale.
        qoder: { permission: { bash: { "git *": "allow", "rm *": "deny" } } },
      }),
      validate: true,
    }).forTarget({ toolTarget: "qodercn" });

    const permissions = await QodercnPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      global: true,
    });

    expect(permissions).toBeInstanceOf(QodercnPermissions);
    expect(permissions.getRelativeDirPath()).toBe(".qoder-cn");
    expect(JSON.parse(permissions.getFileContent()).permissions).toEqual({
      allow: ["Bash(git *)"],
      deny: ["Bash(rm *)"],
    });
  });
});
