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

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const json = instance.getJson();

    expect(instance.getRelativeFilePath()).toBe("opencode.jsonc");
    expect(json.permission).toEqual({});
  });

  it("should merge rulesync permission into existing opencode config", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ model: "x" }));
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

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(instance.getRelativeFilePath()).toBe("opencode.json");
    expect(json.model).toBe("x");
    expect(json.permission.bash["git *"]).toBe("allow");
  });

  it("should import the top-level uniform string permission form (issue #2066)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ permission: "allow" }));

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });

    expect(instance.getJson().permission).toBe("allow");

    const rulesync = instance.toRulesyncPermissions().getJson();
    expect(rulesync.permission).toEqual({ "*": { "*": "allow" } });
  });

  it("should merge the opencode override on top of the shared block (override wins per category)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ model: "x" }));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "ask", "git *": "allow" },
          webfetch: { "*": "ask" },
        },
        opencode: {
          permission: {
            external_directory: "deny",
            webfetch: "allow",
          },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    // Shared block carried over untouched.
    expect(json.permission.bash).toEqual({ "*": "ask", "git *": "allow" });
    // OpenCode-only category emitted.
    expect(json.permission.external_directory).toBe("deny");
    // Override wins per category over the shared value.
    expect(json.permission.webfetch).toBe("allow");
  });

  it("should emit action-only OpenCode permissions as strings (issue #2336)", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "allow" },
          websearch: { "*": "ask" },
          todowrite: { "*": "deny" },
          question: { "*": "allow" },
          doom_loop: { "*": "ask" },
          bash: { "*": "ask", "git *": "allow" },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const permission = JSON.parse(instance.getFileContent()).permission;

    expect(permission).toEqual({
      webfetch: "allow",
      websearch: "ask",
      todowrite: "deny",
      question: "allow",
      doom_loop: "ask",
      bash: { "*": "ask", "git *": "allow" },
    });
  });

  it("should conservatively collapse unsupported patterns for action-only permissions", async () => {
    const logger = { warn: vi.fn() } as any;
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "allow", "https://private.example/**": "deny" },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });
    const permission = JSON.parse(instance.getFileContent()).permission;

    expect(permission.webfetch).toBe("deny");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("deny > ask > allow"));
  });

  it("should route OpenCode-only categories into the opencode override on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          external_directory: "deny",
        },
      }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // Shared canonical category stays in the shared block.
    expect(rulesync.permission.bash).toEqual({ "git *": "allow" });
    expect(rulesync.permission.external_directory).toBeUndefined();
    // OpenCode-only categories move under the override, preserving their shape.
    expect(rulesync.opencode?.permission).toEqual({
      external_directory: "deny",
    });
  });

  it("should translate OpenCode's `task` key into the canonical `agent` category on import (issue #2230)", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          task: "deny",
        },
      }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // OpenCode's `task` key is the subagent-launch permission; it maps to the
    // canonical `agent` category in the shared block (not the override).
    expect(rulesync.permission.agent).toEqual({ "*": "deny" });
    expect(rulesync.permission.task).toBeUndefined();
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should translate the canonical `agent` category into OpenCode's `task` key on export (issue #2230)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ model: "x" }));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          agent: { "*": "deny" },
        },
      }),
    });

    const instance = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    // The canonical `agent` category is written under OpenCode's real `task`
    // key, and never leaks the non-existent `agent` key into opencode.json.
    expect(json.permission.task).toEqual({ "*": "deny" });
    expect(json.permission.agent).toBeUndefined();
  });

  it("should round-trip the canonical `agent`/OpenCode `task` category (issue #2230)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({}));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { agent: { "*": "deny" } },
      }),
    });

    const generated = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    await writeFileContent(join(testDir, "opencode.json"), generated.getFileContent());

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = imported.toRulesyncPermissions().getJson();

    expect(rulesync.permission).toEqual({ agent: { "*": "deny" } });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should keep the all-tools wildcard category in the shared block on import", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { "*": "ask" } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // `"*"` is the all-tools key: it must stay shared (matching the string form
    // `"permission": "ask"`), not be routed into the OpenCode-only override.
    expect(rulesync.permission).toEqual({ "*": { "*": "ask" } });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should omit the opencode override when there are no OpenCode-only categories", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "git *": "allow" });
    expect(rulesync.opencode).toBeUndefined();
  });

  it("should round-trip an opencode override stably (generate → import)", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({}));
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        opencode: { permission: { external_directory: "deny" } },
      }),
    });

    const generated = await OpencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    await writeFileContent(join(testDir, "opencode.json"), generated.getFileContent());

    const imported = await OpencodePermissions.fromFile({ outputRoot: testDir });
    const rulesync = imported.toRulesyncPermissions().getJson();

    expect(rulesync.permission).toEqual({ bash: { "git *": "allow" } });
    expect(rulesync.opencode?.permission).toEqual({ external_directory: "deny" });
  });

  it("should support global mode file resolution", async () => {
    await ensureDir(join(testDir, ".config", "opencode"));
    await writeFileContent(
      join(testDir, ".config", "opencode", "opencode.jsonc"),
      JSON.stringify({ permission: { bash: "ask" } }),
    );

    const instance = await OpencodePermissions.fromFile({ outputRoot: testDir, global: true });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
  });
});
