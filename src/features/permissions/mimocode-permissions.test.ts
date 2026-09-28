import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { MimocodePermissions } from "./mimocode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("MimocodePermissions", () => {
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

  it("should resolve project and global settable paths to mimocode.json", () => {
    expect(MimocodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".mimocode",
      relativeFilePath: "mimocode.json",
    });
    expect(MimocodePermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "mimocode"),
      relativeFilePath: "mimocode.json",
    });
  });

  it("should apply the mimocode override block and ignore the opencode one", async () => {
    await writeFileContent(
      join(testDir, ".mimocode", "mimocode.jsonc"),
      JSON.stringify({ model: "x" }),
    );
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        mimocode: { permission: { doom_loop: "deny" } },
        opencode: { permission: { doom_loop: "ask" } },
      }),
    });

    const instance = await MimocodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(instance).toBeInstanceOf(MimocodePermissions);
    expect(instance.getRelativeFilePath()).toBe("mimocode.jsonc");
    expect(json.model).toBe("x");
    expect(json.permission.bash["git *"]).toBe("allow");
    expect(json.permission.doom_loop).toBe("deny");
  });

  it("should import tool-only permission keys under the mimocode block", async () => {
    await writeFileContent(
      join(testDir, ".mimocode", "mimocode.jsonc"),
      JSON.stringify({ permission: { bash: { "git *": "allow" }, doom_loop: "deny" } }),
    );

    const instance = await MimocodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = JSON.parse(instance.toRulesyncPermissions().getFileContent());

    expect(rulesync.permission.bash["git *"]).toBe("allow");
    expect(rulesync.mimocode).toEqual({ permission: { doom_loop: "deny" } });
    expect(rulesync.opencode).toBeUndefined();
  });
});
