import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { PiPermissions } from "./pi-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

function rulesyncPermissionsFrom(config: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(config),
  });
}

describe("PiPermissions", () => {
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

  it("should write .pi/settings.json at project scope and .pi/agent/settings.json at global scope", () => {
    expect(PiPermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".pi",
      relativeFilePath: "settings.json",
    });
    expect(PiPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".pi", "agent"),
      relativeFilePath: "settings.json",
    });
  });

  it("should not be deletable because settings.json holds unrelated user settings", () => {
    const permissions = PiPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".pi",
      relativeFilePath: "settings.json",
    });

    expect(permissions.isDeletable()).toBe(false);
  });

  it("should author defaultTools from the pi override", async () => {
    const permissions = await PiPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {},
        pi: { defaultTools: ["bash", "edit", "write"] },
      }),
    });

    expect(JSON.parse(permissions.getFileContent())).toEqual({
      defaultTools: ["bash", "edit", "write"],
    });
  });

  it("should emit an empty defaultTools array verbatim", async () => {
    const permissions = await PiPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: {}, pi: { defaultTools: [] } }),
    });

    // Upstream reads `[]` as "no built-in tools, extension and SDK tools kept",
    // which is different from omitting the key.
    expect(JSON.parse(permissions.getFileContent()).defaultTools).toEqual([]);
  });

  it("should preserve unrelated hand-written settings keys", async () => {
    const dir = join(testDir, ".pi");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultModel: "sonnet", defaultTools: ["read"] }),
    );

    const permissions = await PiPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {},
        pi: { defaultTools: ["bash"] },
      }),
    });

    expect(JSON.parse(permissions.getFileContent())).toEqual({
      theme: "dark",
      defaultModel: "sonnet",
      defaultTools: ["bash"],
    });
  });

  it("should leave defaultTools untouched when the config does not state it", async () => {
    const dir = join(testDir, ".pi");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultTools: ["read"] }),
    );

    const permissions = await PiPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({ permission: {} }),
    });

    expect(JSON.parse(permissions.getFileContent())).toEqual({
      theme: "dark",
      defaultTools: ["read"],
    });
  });

  it("should round-trip defaultTools back into the pi override", async () => {
    const dir = join(testDir, ".pi");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultTools: ["bash", "read"] }),
    );

    const loaded = await PiPermissions.fromFile({ outputRoot: testDir });
    const json = loaded.toRulesyncPermissions().getJson() as { pi?: Record<string, unknown> };

    expect(json.pi).toEqual({ defaultTools: ["bash", "read"] });
  });

  it("should omit the override when the settings file has no defaultTools", async () => {
    const dir = join(testDir, ".pi");
    await ensureDir(dir);
    await writeFileContent(join(dir, "settings.json"), JSON.stringify({ theme: "dark" }));

    const loaded = await PiPermissions.fromFile({ outputRoot: testDir });
    const json = loaded.toRulesyncPermissions().getJson() as { pi?: Record<string, unknown> };

    expect(json.pi).toBeUndefined();
  });

  it("should write the global scope independently of the project one", async () => {
    const permissions = await PiPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: rulesyncPermissionsFrom({
        permission: {},
        pi: { defaultTools: ["bash"] },
      }),
      global: true,
    });

    // A project array replaces the global one upstream, so the two scopes are
    // never combined; each is written from the same authored list.
    expect(permissions.getRelativeDirPath()).toBe(join(".pi", "agent"));
    expect(JSON.parse(permissions.getFileContent())).toEqual({ defaultTools: ["bash"] });
  });
});
