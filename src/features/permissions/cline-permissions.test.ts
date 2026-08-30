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

  it("should keep the wider allow beside a narrow bash deny", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "git push *": "deny" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // A `bash` pattern names a command, so Cline's documented deny-priority
    // carves the narrow deny out of the wider allow.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(content.deny).toEqual(["git push *"]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("withheld because"));
  });

  it("should write an all-tools deny and withhold the allow it covers", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          "*": { "rm *": "deny" },
          bash: { "rm *": "allow", "git *": "allow" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // A pattern under `*` need not name a command — `secrets/**` there denies a
    // path — so the deny is written *and* withholds the allow it covers, since
    // an entry naming no command would leave that allow auto-approving.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(content.deny).toEqual(["rm *"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("withheld because"));
  });

  it("should withhold the allow an all-tools ask covers instead of denying it", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          "*": { "*": "ask" },
          bash: { "git *": "allow" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // `{"*": {"*": "ask"}}` is the ordinary "prompt me for everything" config.
    // Translating it to `deny` would block every command — and Cline's `deny`
    // merge is additive, so the entry would outlive the rule that produced it.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual([]);
    expect(content.deny).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("withheld because"));
  });

  it("should keep an allow that a bash deny narrows, since Cline writes that deny", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow", "git push": "deny" } },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // A `bash` pattern is a command by construction, so the `deny` entry does
    // its own work and carving an exception out of a wider allow keeps working.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(content.deny).toEqual(["git push"]);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("withheld because"));
  });

  it("should still write an all-tools deny that names no command at all, and say it blocks nothing", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          "*": { "secrets/**": "deny" },
          bash: { "git *": "allow" },
        },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // `secrets/**` matches no command, so the entry is inert — but dropping it
    // would lose the rule on a later import, and it costs nothing to keep. It
    // withheld no allow rule either, which leaves the author's deny stopping
    // nothing; that is worth a word rather than silence.
    const content = JSON.parse(instance.getFileContent());
    expect(content.deny).toEqual(["secrets/**"]);
    expect(content.allow).toEqual(["git *"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("withheld no allow rule"));
  });

  it("should ignore the all-tools category's allow rules", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          "*": { "src/**": "allow" },
          bash: { "git *": "allow" },
        },
      }),
    });

    const logger = createMockLogger();
    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // `src/**` is a path, not a command — but the skip is reported, so the
    // rule is not dropped in silence.
    const content = JSON.parse(instance.getFileContent());
    expect(content.allow).toEqual(["git *"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("'allow' rules for [src/**] under the all-tools '*' category"),
    );
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

  it("should set allowRedirects from the cline override", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        cline: { allowRedirects: true },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(JSON.parse(instance.getFileContent()).allowRedirects).toBe(true);
  });

  it("should let the cline override win over an existing file value", async () => {
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
        cline: { allowRedirects: false },
      }),
    });

    const instance = await ClinePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(JSON.parse(instance.getFileContent()).allowRedirects).toBe(false);
  });

  it("should round-trip allowRedirects into the cline override", () => {
    const instance = new ClinePermissions({
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
      fileContent: JSON.stringify({ allow: ["git *"], allowRedirects: true }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.cline).toEqual({ allowRedirects: true });
  });

  it("should not emit a cline override when allowRedirects is the default false", () => {
    const instance = new ClinePermissions({
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
      fileContent: JSON.stringify({ allow: ["git *"], allowRedirects: false }),
    });

    expect(instance.toRulesyncPermissions().getJson().cline).toBeUndefined();
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

  describe("validate()", () => {
    it("should succeed for well-formed Cline command-permissions JSON", () => {
      const instance = new ClinePermissions({
        relativeDirPath: ".cline",
        relativeFilePath: "command-permissions.json",
        fileContent: JSON.stringify({ allow: ["git *"], deny: ["rm -rf *"] }),
      });
      const result = instance.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should fail when fileContent is not parseable JSON", () => {
      const instance = new ClinePermissions({
        relativeDirPath: ".cline",
        relativeFilePath: "command-permissions.json",
        fileContent: "{ not json",
      });
      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it("should fail when fileContent does not match schema", () => {
      const instance = new ClinePermissions({
        relativeDirPath: ".cline",
        relativeFilePath: "command-permissions.json",
        // `allow` must be an array of strings; numbers should fail validation.
        fileContent: JSON.stringify({ allow: [123] }),
      });
      const result = instance.validate();
      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
    });

    it("should throw when constructed with validate: true and malformed JSON", () => {
      // `fromFile({ validate: true })` flows through the constructor with
      // `validate: true`; the constructor must invoke `validate()` and throw
      // on failure so callers reading `validate: true` see schema violations
      // surface immediately rather than deeper in the pipeline.
      expect(
        () =>
          new ClinePermissions({
            relativeDirPath: ".cline",
            relativeFilePath: "command-permissions.json",
            fileContent: "{ not json",
            validate: true,
          }),
      ).toThrow();
    });

    it("should throw when constructed with validate: true and schema violation", () => {
      expect(
        () =>
          new ClinePermissions({
            relativeDirPath: ".cline",
            relativeFilePath: "command-permissions.json",
            fileContent: JSON.stringify({ allow: [123] }),
            validate: true,
          }),
      ).toThrow();
    });

    it("should not throw when constructed with validate: false even with malformed JSON", () => {
      // `forDeletion` and other permissive paths pass `validate: false` and
      // must not be rejected at construction time.
      expect(
        () =>
          new ClinePermissions({
            relativeDirPath: ".cline",
            relativeFilePath: "command-permissions.json",
            fileContent: "{ not json",
            validate: false,
          }),
      ).not.toThrow();
    });
  });
});
