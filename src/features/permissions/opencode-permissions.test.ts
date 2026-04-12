import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("OpencodePermissions", () => {
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

  it("should resolve project and global settable paths", () => {
    expect(OpencodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "opencode.json",
    });
    expect(OpencodePermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "opencode"),
      relativeFilePath: "opencode.json",
    });
  });

  it("should load opencode.jsonc and initialize permission", async () => {
    await writeFileContent(join(testDir, "opencode.jsonc"), JSON.stringify({ model: "x" }));

    const instance = await OpencodePermissions.fromFile({ baseDir: testDir });
    const json = instance.getJson();

    expect(instance.getRelativeFilePath()).toBe("opencode.jsonc");
    expect(json.permission).toEqual({});
  });

  it("should merge rulesync permission into existing opencode config", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ model: "x" }));
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(instance.getRelativeFilePath()).toBe("opencode.json");
    expect(json.model).toBe("x");
    expect(json.permission.bash["git *"]).toBe("allow");
  });

  it("should support global mode file resolution", async () => {
    await ensureDir(join(testDir, ".config", "opencode"));
    await writeFileContent(
      join(testDir, ".config", "opencode", "opencode.jsonc"),
      JSON.stringify({ permission: { bash: "ask" } }),
    );

    const instance = await OpencodePermissions.fromFile({ baseDir: testDir, global: true });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
  });
});
