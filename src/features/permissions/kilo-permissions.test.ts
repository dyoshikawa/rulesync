import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloPermissions } from "./kilo-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const withSandbox = (sandbox: Record<string, unknown>): RulesyncPermissions =>
  new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify({ permission: {}, kilo: { sandbox } }),
  });

const withKiloPermission = (permission: Record<string, unknown>): RulesyncPermissions =>
  new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify({ permission: {}, kilo: { permission } }),
  });

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

  it("should preserve existing tool keys not present in rulesync output (per-key merge)", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({
        permission: {
          // `bash` is replaced by rulesync.
          bash: { "old *": "allow" },
          // `read` is NOT in the rulesync output and must be preserved verbatim.
          read: { ".env": "deny" },
        },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    // Replaced managed key.
    expect(json.permission.bash).toEqual({ "git *": "allow" });
    expect(json.permission.bash["old *"]).toBeUndefined();
    // Preserved unmanaged key.
    expect(json.permission.read).toEqual({ ".env": "deny" });
  });

  it("should warn (aggregated) when replacing a key drops existing deny patterns", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({
        permission: {
          bash: { "rm -rf *": "deny", "sudo *": "deny" },
        },
      }),
    );

    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        // rulesync output drops both denies — only allow git.
        permission: { bash: { "git *": "allow" } },
      }),
    });

    await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(logger.error).not.toHaveBeenCalled();
    const warnCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("Kilo permissions regeneration drops existing"),
    );
    expect(warnCalls).toHaveLength(1);
    const message = warnCalls[0]?.[0] as string;
    expect(message).toContain("bash");
    expect(message).toContain("rm -rf *");
    expect(message).toContain("sudo *");
  });

  it("should NOT warn when the rulesync output preserves the existing deny patterns", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({
        permission: { bash: { "rm -rf *": "deny" } },
      }),
    );

    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "rm -rf *": "deny", "git *": "allow" } },
      }),
    });

    await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const warnCalls = logger.warn.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" && c[0].includes("Kilo permissions regeneration drops existing"),
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("should author Kilo-only keys from the kilo override", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        kilo: {
          permission: {
            external_directory: "deny",
            doom_loop: "ask",
            notebook_edit: { "*.ipynb": "allow" },
          },
        },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const json = JSON.parse(instance.getFileContent());

    expect(json.permission.bash["git *"]).toBe("allow");
    expect(json.permission.external_directory).toBe("deny");
    expect(json.permission.doom_loop).toBe("ask");
    expect(json.permission.notebook_edit).toEqual({ "*.ipynb": "allow" });
  });

  it("should route Kilo-only keys into the kilo override on import", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({
        permission: {
          bash: "ask",
          external_directory: "deny",
          notebook_edit: { "*.ipynb": "allow" },
        },
      }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    // Shared canonical category stays in the shared block.
    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
    // Kilo-only keys are NOT in the shared block (would leak to other tools).
    expect(rulesync.permission.external_directory).toBeUndefined();
    expect(rulesync.permission.notebook_edit).toBeUndefined();
    // ...they live under the kilo override instead, keeping their original shape.
    expect(rulesync.kilo).toEqual({
      permission: {
        external_directory: "deny",
        notebook_edit: { "*.ipynb": "allow" },
      },
    });
  });

  it("should keep a Kilo-only key stable across a full import -> generate round-trip", async () => {
    const original = {
      permission: {
        bash: "ask",
        external_directory: "deny",
        notebook_edit: { "*.ipynb": "allow" },
      },
    };
    await writeFileContent(join(testDir, "kilo.jsonc"), JSON.stringify(original));

    // import -> canonical (Kilo-only keys land in the kilo override)
    const imported = await KiloPermissions.fromFile({ outputRoot: testDir });
    const canonical = imported.toRulesyncPermissions();

    // canonical -> generate back into a fresh project (no pre-existing kilo.jsonc)
    const freshProjectDir = join(testDir, "fresh-project");
    await ensureDir(freshProjectDir);
    const regenerated = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: freshProjectDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: freshProjectDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: canonical.getFileContent(),
      }),
    });

    expect(JSON.parse(regenerated.getFileContent()).permission).toEqual({
      bash: { "*": "ask" },
      external_directory: "deny",
      notebook_edit: { "*.ipynb": "allow" },
    });
  });

  it("should let the kilo override win over the shared block for the same key", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { webfetch: { "*": "ask" } },
        kilo: { permission: { webfetch: "deny" } },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(JSON.parse(instance.getFileContent()).permission.webfetch).toBe("deny");
  });

  it("should warn when a kilo override key drops an existing deny", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { external_directory: { "/etc": "deny" } } }),
    );
    const logger = createMockLogger();

    await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
          kilo: { permission: { external_directory: "allow" } },
        }),
      }),
      logger,
    });

    const warned = logger.warn.mock.calls.some(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("external_directory: [/etc]"),
    );
    expect(warned).toBe(true);
  });

  it("should not emit a kilo override when only shared categories are present", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "ask", read: { ".env": "deny" } } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    expect(instance.toRulesyncPermissions().getJson().kilo).toBeUndefined();
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

  it("should import from the alternative .kilo/kilo.jsonc project location", async () => {
    await ensureDir(join(testDir, ".kilo"));
    await writeFileContent(
      join(testDir, ".kilo", "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "ask" } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "ask" });
    expect(instance.getRelativeDirPath()).toBe(".kilo");
    expect(instance.getFilePath()).toBe(join(testDir, ".kilo", "kilo.jsonc"));
  });

  it("should import from the alternative .kilo/kilo.json project location", async () => {
    await ensureDir(join(testDir, ".kilo"));
    await writeFileContent(
      join(testDir, ".kilo", "kilo.json"),
      JSON.stringify({ permission: { read: { ".env": "deny" } } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.read).toEqual({ ".env": "deny" });
    expect(instance.getFilePath()).toBe(join(testDir, ".kilo", "kilo.json"));
  });

  it("should prefer the root kilo.jsonc over the .kilo/ alternative location", async () => {
    await ensureDir(join(testDir, ".kilo"));
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "allow" } }),
    );
    await writeFileContent(
      join(testDir, ".kilo", "kilo.jsonc"),
      JSON.stringify({ permission: { bash: "deny" } }),
    );

    const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
    const rulesync = instance.toRulesyncPermissions().getJson();

    expect(rulesync.permission.bash).toEqual({ "*": "allow" });
    expect(instance.getRelativeDirPath()).toBe(".");
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = KiloPermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "kilo.jsonc",
    });
    expect(instance.isDeletable()).toBe(false);
  });

  it("should NOT throw on schema-incompatible input when validate=false (parsing deferred)", () => {
    // Permission value of `true` is not in the schema enum, but with validate=false the constructor
    // must not throw. This matches the behavior of `RulesyncPermissions` and is required so that
    // `forDeletion` and dry-run scenarios can construct the instance without strict parsing.
    expect(
      () =>
        new KiloPermissions({
          relativeDirPath: ".",
          relativeFilePath: "kilo.jsonc",
          fileContent: JSON.stringify({ permission: { bash: 12345 } }),
          validate: false,
        }),
    ).not.toThrow();
  });

  it("should throw on schema-incompatible input when validate=true (default)", () => {
    expect(
      () =>
        new KiloPermissions({
          relativeDirPath: ".",
          relativeFilePath: "kilo.jsonc",
          fileContent: JSON.stringify({ permission: { bash: 12345 } }),
          validate: true,
        }),
    ).toThrow();
  });

  it("fromFile should throw on malformed JSONC instead of silently dropping existing rules", async () => {
    // Missing closing brace — `jsonc-parser`'s best-effort `parse()` would silently coerce this
    // to `undefined`/`{}`, which would cause a regenerate to overwrite the corrupted file with
    // an empty `permission: {}` and lose the user's `deny` rules. We now surface the error.
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      '{ "permission": { "bash": { "rm -rf *": "deny"',
    );

    await expect(KiloPermissions.fromFile({ outputRoot: testDir })).rejects.toThrow(
      /Failed to parse Kilo Code config/,
    );
  });

  it("fromRulesyncPermissions should throw on malformed JSONC instead of silently overwriting", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      '{ "permission": { "bash": { "rm -rf *": "deny"',
    );
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    });

    await expect(
      KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      }),
    ).rejects.toThrow(/Failed to parse Kilo Code config/);
  });
  it("should move exact deny keys last and keep every other key in order", async () => {
    // Kilo evaluates `permission` last-match-wins in key order. The MCP feature
    // writes `{server}_{tool}` keys first; the catch-all appended afterwards
    // must not lift an exact deny.
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { github_delete_repo: "deny", "github_*": "ask" } }),
    );
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "rm *": "deny" }, "*": { "*": "allow" } },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(Object.keys(instance.getJson().permission ?? {})).toEqual([
      "github_*",
      "bash",
      "*",
      "github_delete_repo",
    ]);
  });

  it("should keep a catch-all deny written after a category allow in place", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { read: { "*": "allow" }, "*": { "/secrets/**": "deny" } },
      }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(Object.keys(instance.getJson().permission ?? {})).toEqual(["read", "*"]);
  });

  it("should not reorder user-authored keys ahead of a catch-all deny", async () => {
    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify({ permission: { edit: "allow", "*": "deny" } }),
    );
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
    });

    const instance = await KiloPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(Object.keys(instance.getJson().permission ?? {})).toEqual(["edit", "*", "bash"]);
  });

  it("should leave MCP tool keys of listed servers to the MCP feature on import", () => {
    const kilo = new KiloPermissions({
      outputRoot: testDir,
      relativeDirPath: ".",
      relativeFilePath: "kilo.jsonc",
      fileContent: JSON.stringify({
        mcp: { github: { type: "local", command: ["gh-mcp"] }, external: { enabled: false } },
        permission: {
          github_create_issue: "allow",
          github_delete_repo: "deny",
          github_approved: { "*": "allow" },
          github_list: "ask",
          other_tool: "deny",
          external_directory: "deny",
        },
      }),
    });

    const json = kilo.toRulesyncPermissions().getJson();

    expect(json.kilo?.permission).toEqual({
      github_list: "ask",
      other_tool: "deny",
      external_directory: "deny",
    });
  });

  describe("markdown_source", () => {
    it("should drop allow patterns at project scope with a warning", async () => {
      const logger = createMockLogger();

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({
          markdown_source: {
            "/shared/commands/*": "allow",
            "/private/*": "deny",
            "/review/*": "ask",
          },
        }),
        logger,
      });

      expect(JSON.parse(instance.getFileContent()).permission.markdown_source).toEqual({
        "/private/*": "deny",
        "/review/*": "ask",
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("/shared/commands/*"));
    });

    it("should remove a stale project entry when nothing survives narrowing", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({ permission: { markdown_source: { "/shared/*": "allow" } } }),
      );

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({ markdown_source: { "/shared/*": "allow" } }),
      });

      expect(JSON.parse(instance.getFileContent()).permission).not.toHaveProperty(
        "markdown_source",
      );
    });

    it("should keep a bare deny or ask and drop a bare allow at project scope", async () => {
      const denied = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({ markdown_source: "deny" }),
      });
      const asked = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({ markdown_source: "ask" }),
      });
      const allowed = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({ markdown_source: "allow" }),
      });

      expect(JSON.parse(denied.getFileContent()).permission.markdown_source).toBe("deny");
      expect(JSON.parse(asked.getFileContent()).permission.markdown_source).toBe("ask");
      expect(JSON.parse(allowed.getFileContent()).permission).not.toHaveProperty("markdown_source");
    });

    it("should leave a project entry alone when rulesync does not author the key", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({ permission: { markdown_source: { "/shared/*": "allow" } } }),
      );

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({ edit: "ask" }),
      });

      expect(JSON.parse(instance.getFileContent()).permission.markdown_source).toEqual({
        "/shared/*": "allow",
      });
    });

    it("should write every pattern verbatim at global scope", async () => {
      const logger = createMockLogger();

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withKiloPermission({
          markdown_source: { "/shared/commands/*": "allow" },
        }),
        global: true,
        logger,
      });

      expect(JSON.parse(instance.getFileContent()).permission.markdown_source).toEqual({
        "/shared/commands/*": "allow",
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("sandbox override", () => {
    it("should write the tighten-only keys at project scope", async () => {
      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({ enabled: true, network: "deny" }),
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({
        enabled: true,
        network: "deny",
      });
    });

    it("should drop global-only keys at project scope with a warning", async () => {
      const logger = createMockLogger();

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({
          enabled: true,
          allowed_hosts: ["example.com:443"],
          writable_paths: ["/tmp"],
        }),
        logger,
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({ enabled: true });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("allowed_hosts, writable_paths"),
      );
    });

    it("should write every key at global scope", async () => {
      await ensureDir(join(testDir, ".config", "kilo"));

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({
          enabled: true,
          network: "deny",
          allowed_hosts: ["example.com:443"],
          writable_paths: ["/tmp"],
        }),
        global: true,
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({
        enabled: true,
        network: "deny",
        allowed_hosts: ["example.com:443"],
        writable_paths: ["/tmp"],
      });
    });

    it("should preserve sibling sandbox keys the user set directly", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({ sandbox: { enabled: false, custom_key: 1 } }),
      );

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({ enabled: true }),
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({
        enabled: true,
        custom_key: 1,
      });
    });

    it("should leave an existing sandbox block alone when nothing authors it", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({ sandbox: { enabled: true } }),
      );

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({ permission: { bash: { "*": "ask" } } }),
        }),
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({ enabled: true });
    });

    it("should not materialize an empty sandbox when every authored key is dropped", async () => {
      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({ allowed_hosts: ["example.com"] }),
      });

      expect(JSON.parse(instance.getFileContent())).not.toHaveProperty("sandbox");
    });

    it("should preserve sibling sandbox keys at global scope too", async () => {
      await ensureDir(join(testDir, ".config", "kilo"));
      await writeFileContent(
        join(testDir, ".config", "kilo", "kilo.jsonc"),
        JSON.stringify({ sandbox: { allowed_hosts: ["kept.example.com"], custom_key: 1 } }),
      );

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: withSandbox({ enabled: true, writable_paths: ["/tmp"] }),
        global: true,
      });

      expect(JSON.parse(instance.getFileContent()).sandbox).toEqual({
        enabled: true,
        writable_paths: ["/tmp"],
        allowed_hosts: ["kept.example.com"],
        custom_key: 1,
      });
    });

    it("should not abort the run when the existing sandbox is not an object", async () => {
      await writeFileContent(join(testDir, "kilo.jsonc"), JSON.stringify({ sandbox: true }));

      const instance = await KiloPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({ permission: { bash: { "*": "ask" } } }),
        }),
      });

      // rulesync does not manage this value, so it passes through untouched
      // rather than failing the whole Kilo generate.
      expect(JSON.parse(instance.getFileContent()).sandbox).toBe(true);
    });

    it("should round-trip the sandbox block into the kilo override on import", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({
          permission: { bash: "ask" },
          sandbox: { enabled: true, allowed_hosts: ["example.com"] },
        }),
      );

      const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(imported.kilo.sandbox).toEqual({
        enabled: true,
        allowed_hosts: ["example.com"],
      });
    });

    it("should not add a kilo override when there is no sandbox or Kilo-only key", async () => {
      await writeFileContent(
        join(testDir, "kilo.jsonc"),
        JSON.stringify({ permission: { bash: "ask" } }),
      );

      const instance = await KiloPermissions.fromFile({ outputRoot: testDir });
      const imported = JSON.parse(instance.toRulesyncPermissions().getFileContent());

      expect(imported.kilo).toBeUndefined();
    });
  });
});
