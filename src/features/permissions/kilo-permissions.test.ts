import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloPermissions } from "./kilo-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("KiloPermissions", () => {
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
    expect(KiloPermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "kilo.jsonc",
    });
    expect(KiloPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".config", "kilo"),
      relativeFilePath: "kilo.jsonc",
    });
  });

  it("should load kilo.jsonc and initialize permission", async () => {
    await writeFileContent(join(testDir, "kilo.jsonc"), JSON.stringify({ model: "x" }));

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const json = instance.getJson();

    expect(instance.getRelativeFilePath()).toBe("kilo.jsonc");
    expect(json.permission).toEqual({});
  });

  it("should merge rulesync permission into existing kilo.jsonc", async () => {
    await writeFileContent(join(testDir, "kilo.jsonc"), JSON.stringify({ model: "x" }));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
        },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(json.model).toBe("x");
    expect(json.permission.bash["git *"]).toBe("allow");
  });

  it("should round-trip permissions back to rulesync format", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "ask", read: { ".env": "deny" } } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
    expect(rulesync.permission.read).toEqual({ ".env": "deny" });
  });

  it("should support global mode file resolution", async () => {
    await ensureDir(join(testDir, ".config", "kilo"));
    await writeFileContent(
      join(testDir, ".config", "kilo", "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "ask" } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir, global: true });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = KiloPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "kilo.jsonc",
    });
    expect(instance.isDeletable()).toBe(false);
  });
});
