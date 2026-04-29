import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodePermissions } from "./augmentcode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("AugmentcodePermissions", () => {
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

  it("should resolve settable paths", () => {
    expect(AugmentcodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
    });
  });

  it("should map rulesync permissions to AugmentCode toolPermissions entries", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          read: { "*": "allow" },
        },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    const entries = content.toolPermissions;

    const bashAllow = entries.find(
      (e: { toolName: string; permission: { type: string } }) =>
        e.toolName === "launch-process" && e.permission.type === "allow",
    );
    expect(bashAllow.shellInputRegex).toBe("^git .*$");

    const bashAsk = entries.find(
      (e: { toolName: string; permission: { type: string } }) =>
        e.toolName === "launch-process" && e.permission.type === "ask-user",
    );
    expect(bashAsk.shellInputRegex).toBeUndefined();

    const view = entries.find((e: { toolName: string }) => e.toolName === "view");
    expect(view.permission.type).toBe("allow");
  });

  it("should preserve unrelated toolPermissions entries and other top-level keys", async () => {
    const settingsDir = join(testDir, ".augment");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        userName: "alice",
        toolPermissions: [
          {
            toolName: "custom-tool",
            permission: { type: "allow" },
          },
          {
            toolName: "launch-process",
            shellInputRegex: "^old$",
            permission: { type: "deny" },
          },
        ],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
      }),
    });

    const instance = await AugmentcodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.userName).toBe("alice");
    const entries = content.toolPermissions as Array<{ toolName: string }>;
    expect(entries.find((e) => e.toolName === "custom-tool")).toBeDefined();
    // Old launch-process entry should be replaced (managed)
    expect(entries.filter((e) => e.toolName === "launch-process")).toHaveLength(1);
  });

  it("should round-trip toolPermissions back to rulesync format", () => {
    const instance = new AugmentcodePermissions({
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        toolPermissions: [
          {
            toolName: "launch-process",
            shellInputRegex: "^git .*$",
            permission: { type: "allow" },
          },
          {
            toolName: "view",
            permission: { type: "deny" },
          },
          {
            toolName: "save-file",
            permission: { type: "ask-user" },
          },
        ],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.bash).toBeDefined();
    expect(config.permission.bash!["git *"]).toBe("allow");
    expect(config.permission.read).toEqual({ "*": "deny" });
    expect(config.permission.write).toEqual({ "*": "ask" });
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = AugmentcodePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".augment",
      relativeFilePath: "settings.json",
    });
    expect(instance.isDeletable()).toBe(false);
  });
});
