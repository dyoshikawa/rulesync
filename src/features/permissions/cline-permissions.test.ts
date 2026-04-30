import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClinePermissions } from "./cline-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("ClinePermissions", () => {
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
    expect(ClinePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
    });
  });

  it("should map rulesync bash permissions to allow/deny arrays", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(content.deny).toEqual(["rm *"]);
    expect(content.allowRedirects).toBe(false);
  });

  it("should translate ask rules to deny (fail-closed) and aggregate notices into a single warn", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "ask" },
          read: { "src/**": "allow" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // ask is translated to deny (fail-closed) since Cline lacks ask semantics.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(content.deny).toEqual(["rm *"]);

    // Project convention: translation notices surface via `logger.warn`, not `logger.error`.
    expect(logger.error).not.toHaveBeenCalled();
    const warnCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("Cline command permissions translation notice"),
    );
    expect(warnCalls).toHaveLength(1);
    const message = warnCalls[0]?.[0] as string;
    expect(message).toContain("non-bash categories [read]");
    expect(message).toContain("translated to 'deny' for fail-closed safety");
    expect(message).toContain("rm *");
  });

  it("should preserve user-added denies in the existing file (additive deny)", async () => {
    const dir = join(testDir, ".cline");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "command-permissions.json"),
      JSON.stringify({ allow: ["old-allow"], deny: ["sudo *"], allowRedirects: false }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow", "rm *": "deny" } },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    // `allow` is wholesale-replaced; the previous `old-allow` entry must be gone.
    expect(content.allow).toEqual(["git *"]);
    // `deny` is additive: the user-added `sudo *` survives alongside the new `rm *`.
    expect(content.deny).toEqual(["rm *", "sudo *"]);
  });

  it("should preserve allowRedirects from existing file", async () => {
    const dir = join(testDir, ".cline");
    await ensureDir(dir);
    await writeFileContent(
      join(dir, "command-permissions.json"),
      JSON.stringify({ allowRedirects: true }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { ls: "allow" } },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.allowRedirects).toBe(true);
  });

  it("should round-trip permissions back to rulesync bash format", () => {
    const instance = new ClinePermissions({
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
      fileContent: JSON.stringify({
        allow: ["git *", "npm *"],
        deny: ["rm -rf *"],
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.bash).toEqual({
      "git *": "allow",
      "npm *": "allow",
      "rm -rf *": "deny",
    });
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = ClinePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
    });
    expect(instance.isDeletable()).toBe(false);
  });
});
