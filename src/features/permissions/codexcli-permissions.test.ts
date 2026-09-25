import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
import { CodexcliPermissions, createCodexcliBashRulesFile } from "./codexcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

type ParsedToml = Record<string, any>;

const parseWorkspaceRoots = (fileContent: string): Record<string, unknown> => {
  const parsed = smolToml.parse(fileContent) as ParsedToml;
  return parsed.permissions?.rulesync?.filesystem?.[":workspace_roots"] ?? {};
};

describe("CodexcliPermissions", () => {
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

  it("should convert rulesync permissions to Codex CLI config.toml profile", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "/workspace/project/**": "allow", "/workspace/project/.env": "deny" },
          write: { "/workspace/project/src/**": "allow" },
          webfetch: { "github.com": "allow", "example.com": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('default_permissions = "rulesync"');
    expect(fileContent).toContain("[permissions.rulesync.filesystem]");
    expect(fileContent).toContain('"/workspace/project/**" = "read"');
    expect(fileContent).toContain('"/workspace/project/.env" = "deny"');
    expect(fileContent).toContain('"/workspace/project/src/**" = "write"');
    expect(fileContent).toContain("[permissions.rulesync.network]");
    expect(fileContent).toContain("enabled = true");
    expect(fileContent).toContain("[permissions.rulesync.network.domains]");
    expect(fileContent).toContain('"github.com" = "allow"');
    expect(fileContent).toContain('"example.com" = "deny"');
  });

  it("should merge per-path rules across read/edit/write categories instead of last-category-wins", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "/data/readable/**": "allow",
            "/data/full/**": "allow",
            "/data/blocked/**": "deny",
            "/data/asked/**": "allow",
          },
          write: {
            // read allow + write deny → "read" (this was the last-wins bug).
            "/data/readable/**": "deny",
            // read allow + write allow → "write".
            "/data/full/**": "allow",
            // read deny + write allow → contradiction, warn + "deny".
            "/data/blocked/**": "allow",
            // read allow + write ask → "read" (ask is approximated as read-only).
            "/data/asked/**": "ask",
          },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/data/readable/**" = "read"');
    expect(fileContent).toContain('"/data/full/**" = "write"');
    expect(fileContent).toContain('"/data/blocked/**" = "deny"');
    expect(fileContent).toContain('"/data/asked/**" = "read"');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Codex CLI cannot express "writable but not readable"'),
    );
    // An explicit `read: allow` already asks for Codex's "read" level, so the
    // write-side deny → read warning is reserved for an unspecified read side.
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("maps a write-side deny to read-only access"),
    );
  });

  it("should collapse edit and write for the same path with the more restrictive action winning", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "/data/mixed/**": "allow", "/data/open/**": "allow" },
          write: { "/data/mixed/**": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/data/mixed/**" = "read"');
    expect(fileContent).toContain('"/data/open/**" = "write"');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("maps a write-side deny to read-only access"),
    );
  });

  it("should preserve read access when an edit rule asks for write approval", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { ".rulesync/**": "ask" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('".rulesync/**" = "read"');
    expect(fileContent).not.toContain('".rulesync/**" = "deny"');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Codex CLI cannot express "ask" for filesystem write permissions'),
    );
  });

  it("should not warn about an ask rule masked by a read denial", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { ".rulesync/**": "deny" },
          edit: { ".rulesync/**": "ask" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(codexPermissions.getFileContent()).toContain('".rulesync/**" = "deny"');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should emit deny for an unsupported glob when a write-side deny restricts it", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "lib/types/src/transport/*.ts": "allow" },
          edit: { "lib/types/src/transport/*.ts": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // The `edit: deny` (not the read glob) triggers the downgrade: Codex accepts
    // only `deny` for non-trailing globs, and restrictive wins. This is the one
    // path where an explicit `read: allow` is dropped to `deny`.
    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"lib/types/src/transport/*.ts" = "deny"');
    expect(fileContent).not.toContain('"lib/types/src/transport/*.ts" = "read"');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("only supports deny access for non-trailing filesystem globs"),
    );
    // The deny → read warning must not fire on top of the glob downgrade.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("should deny a write-side-only restriction covered by a broader read deny", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "/home/me/.ssh/**": "deny", "secrets/**": "ask" },
          write: { "/home/me/.ssh/id_rsa": "deny", "/home/me/.ssh/**": "deny" },
          edit: { "secrets/**": "deny", "secrets/nested/**": "ask", secrets: "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // Codex resolves the most specific path, so a `"read"` entry here would
    // re-open reads that the ancestor `read: deny` / `read: ask` forbids.
    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/home/me/.ssh/**" = "deny"');
    expect(fileContent).toContain('"/home/me/.ssh/id_rsa" = "deny"');
    expect(fileContent).not.toContain('"/home/me/.ssh/id_rsa" = "read"');
    const workspaceRoots = parseWorkspaceRoots(fileContent);
    expect(workspaceRoots["secrets/**"]).toBe("deny");
    expect(workspaceRoots["secrets/nested/**"]).toBe("deny");
    expect(workspaceRoots["secrets"]).toBe("deny");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should deny write-side-only restrictions when :root is read-denied", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { ":root": "deny" },
          edit: { "/etc/hosts": "deny", "~/.bashrc": "ask" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/etc/hosts" = "deny"');
    expect(fileContent).toContain('"~/.bashrc" = "deny"');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should keep read-only access for a write-side-only restriction without a covering read deny", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          // Neither a sibling subtree nor a name-prefix match covers the key.
          read: { "/home/me/.ssh-backup/**": "deny", "/home/me/.aws/**": "allow" },
          write: { "/home/me/.ssh/id_rsa": "deny", "/home/me/.aws/credentials": "deny" },
          edit: { "~/**": "ask" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/home/me/.ssh/id_rsa" = "read"');
    expect(fileContent).toContain('"/home/me/.aws/credentials" = "read"');
    expect(fileContent).toContain('"~/**" = "read"');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'maps a write-side deny to read-only access: pattern "/home/me/.ssh/id_rsa"',
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'cannot express "ask" for filesystem write permissions: pattern "~/**"',
      ),
    );
  });

  it("should skip Windows device paths that would land in the :workspace_roots table", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "\\\\?\\C:\\proj\\docs": "allow",
            "\\\\.\\C:\\proj\\secret": "deny",
          },
          edit: { "\\\\.\\UNC\\server\\share\\notes": "deny" },
        },
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    // On a non-Windows host a device path is not absolute and would be nested
    // under `:workspace_roots`, where Codex rejects it (Windows path
    // convention) or treats it as a meaningless literal name (POSIX), so no
    // entry is emitted for it — not even a deny.
    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain("C:\\\\proj");
    expect(fileContent).not.toContain("UNC");
    expect(logger.warn).toHaveBeenCalledTimes(3);
    for (const pattern of [
      "\\\\?\\C:\\proj\\docs",
      "\\\\.\\C:\\proj\\secret",
      "\\\\.\\UNC\\server\\share\\notes",
    ]) {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`filesystem entry for Windows device path "${pattern}"`),
      );
    }
    // The warning must make clear that even a deny is dropped and the path is
    // left unprotected.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /Windows device path "\\\\\.\\C:\\proj\\secret".*the rule is dropped entirely — even a deny — and the path is NOT protected/,
      ),
    );
  });

  it("should skip \\\\.\\ device-path read and write grants", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "\\\\.\\C:\\proj\\docs": "allow", "\\\\.\\C:\\proj\\src": "allow" },
          write: { "\\\\.\\C:\\proj\\src": "allow", "\\\\.\\C:\\proj\\out": "allow" },
        },
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain("C:\\\\proj");
    expect(fileContent).not.toContain('= "write"');
    expect(parseWorkspaceRoots(fileContent)).toEqual({});
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipping Codex CLI read filesystem entry for Windows device path "\\\\.\\C:\\proj\\docs"',
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipping Codex CLI write filesystem entry for Windows device path "\\\\.\\C:\\proj\\src"',
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipping Codex CLI write filesystem entry for Windows device path "\\\\.\\C:\\proj\\out"',
      ),
    );
  });

  describe("read-deny coverage and :workspace_roots preservation (#3152)", () => {
    const generate = async ({
      permission,
      logger,
      gitWriteRules = false,
    }: {
      permission: Record<string, Record<string, string>>;
      gitWriteRules?: boolean;
      logger: ReturnType<typeof createMockLogger>;
    }): Promise<string> => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission,
          ...(gitWriteRules ? {} : { codexcli: { git_write_rules: false } }),
        }),
      });
      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });
      return codexPermissions.getFileContent();
    };

    const importPermission = (fileContent: string) =>
      new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent,
      })
        .toRulesyncPermissions()
        .getJson().permission as Record<string, Record<string, string>>;

    it("preserves a direct :workspace_roots deny as the '.' entry when relative rules exist", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: { read: { ":workspace_roots": "deny" }, edit: { "src/a.ts": "deny" } },
        logger,
      });

      // Without the `"."` entry the workspace would fall back to the
      // `:workspace` baseline (read/write), and `"src/a.ts" = "read"` would
      // re-open a file under the denied workspace.
      expect(parseWorkspaceRoots(fileContent)).toEqual({ ".": "deny", "src/a.ts": "deny" });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('it is emitted as the "." entry of the ":workspace_roots" table'),
      );
    });

    it("preserves a direct :workspace_roots grant and keeps the more restrictive of it and an explicit '.' rule", async () => {
      const logger = createMockLogger();
      expect(
        parseWorkspaceRoots(
          await generate({
            permission: { write: { ":workspace_roots": "allow", "src/**": "deny" } },
            logger,
          }),
        ),
      ).toEqual({ ".": "write", "src/**": "read" });

      expect(
        parseWorkspaceRoots(
          await generate({
            permission: {
              read: { ":workspace_roots": "allow", ".": "deny" },
              edit: { "src/**": "deny" },
            },
            logger,
          }),
        ),
      ).toEqual({ ".": "deny", "src/**": "deny" });
    });

    it("imports the '.' entry of the :workspace_roots table as the portable '.' pattern", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: { read: { ":workspace_roots": "deny" }, edit: { "src/a.ts": "deny" } },
        logger,
      });

      const permission = importPermission(fileContent);

      // `.` is understood by every tool, while `:workspace_roots` is a
      // Codex-only special path; generation emits both as the same entry.
      expect(permission.read?.["."]).toBe("deny");
      expect(permission.edit?.["."]).toBe("deny");
      expect(permission.read?.[":workspace_roots"]).toBeUndefined();
      expect(permission.edit?.[":workspace_roots"]).toBeUndefined();
    });

    it("round-trips a '.' read deny without losing the default .git carve-out", async () => {
      const first = await generate({
        permission: { read: { ".": "deny" } },
        logger: createMockLogger(),
        gitWriteRules: true,
      });
      expect(parseWorkspaceRoots(first)).toEqual({ ".": "deny", ".git/**": "write" });

      const permission = importPermission(first);
      expect(permission.read?.["."]).toBe("deny");
      expect(permission.read?.[":workspace_roots"]).toBeUndefined();

      const second = await generate({
        permission,
        logger: createMockLogger(),
        gitWriteRules: true,
      });
      expect(parseWorkspaceRoots(second)).toEqual(parseWorkspaceRoots(first));
    });

    it("treats '.' and './' as the same :workspace_roots slot", async () => {
      const logger = createMockLogger();
      const workspaceRoots = parseWorkspaceRoots(
        await generate({
          permission: {
            read: { ":workspace_roots": "deny", "./": "allow" },
            edit: { "src/a.ts": "deny" },
          },
          logger,
        }),
      );
      // Both collapse onto `"."` with the more restrictive access.
      expect(workspaceRoots).toEqual({ ".": "deny", "src/a.ts": "deny" });

      const both = parseWorkspaceRoots(
        await generate({
          permission: { read: { ".": "allow", "./": "deny" } },
          logger,
        }),
      );
      expect(both).toEqual({ ".": "deny" });

      // A lone `"./"` is emitted as `"."`: Codex rejects a leading `.`
      // segment in `:workspace_roots` subpaths and only special-cases `"."`.
      expect(
        parseWorkspaceRoots(await generate({ permission: { read: { "./": "deny" } }, logger })),
      ).toEqual({ ".": "deny" });
    });

    it("strips leading './' segments from :workspace_roots keys", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "./src/**": "allow", "././docs": "deny", "./**": "deny" },
          edit: { "/abs/./x": "deny", "C:\\proj\\out": "deny" },
        },
        logger,
      });

      expect(parseWorkspaceRoots(fileContent)).toEqual({
        "src/**": "read",
        docs: "deny",
        "**": "deny",
      });
      // Absolute and drive keys are never rewritten.
      const filesystem = (smolToml.parse(fileContent) as ParsedToml).permissions.rulesync
        .filesystem;
      expect(filesystem["/abs/./x"]).toBe("read");
      expect(filesystem["C:\\proj\\out"]).toBe("read");
    });

    it("merges './'-prefixed and plain keys that collide, more restrictive wins", async () => {
      const logger = createMockLogger();
      expect(
        parseWorkspaceRoots(
          await generate({
            permission: {
              read: { "./src": "deny", src: "allow" },
              write: { "lib/**": "allow", "./lib/**": "deny" },
            },
            logger,
          }),
        ),
      ).toEqual({ src: "deny", "lib/**": "read" });
    });

    it("does not treat an empty read pattern as covering workspace-relative paths", async () => {
      const fileContent = await generate({
        permission: { read: { "": "deny" }, edit: { "src/a.ts": "deny" } },
        logger: createMockLogger(),
      });
      expect(parseWorkspaceRoots(fileContent)).toEqual({ "src/a.ts": "read" });
    });

    it("round-trips :root deny with a writable special path and absolute path", async () => {
      const json = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: `
[permissions.rulesync.filesystem]
":root" = "deny"
":tmpdir" = "write"
"/home/me/proj/**" = "write"
`,
      })
        .toRulesyncPermissions()
        .getJson();

      // Codex's `write` level includes read access, so it imports as both.
      expect(json.permission.read?.[":tmpdir"]).toBe("allow");
      expect(json.permission.edit?.[":tmpdir"]).toBe("allow");

      const logger = createMockLogger();
      const fileContent = await generate({
        permission: json.permission as Record<string, Record<string, string>>,
        logger,
      });
      expect(fileContent).toContain('":root" = "deny"');
      expect(fileContent).toContain('":tmpdir" = "write"');
      expect(fileContent).toContain('"/home/me/proj/**" = "write"');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("denies a write-side allow covered by a broader read deny/ask", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "~/.ssh/**": "deny", ":root": "ask" },
          edit: { "~/.ssh/known_hosts": "allow" },
          write: { "~/proj/**": "allow" },
        },
        logger,
      });

      expect(fileContent).toContain('"~/.ssh/known_hosts" = "deny"');
      expect(fileContent).toContain('"~/proj/**" = "deny"');
      expect(fileContent).not.toContain('= "write"');
      for (const pattern of ["~/.ssh/known_hosts", "~/proj/**"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            `cannot express "writable but not readable": pattern "${pattern}" has a write-side allow but is covered by a broader read deny/ask rule`,
          ),
        );
      }
    });

    it("keeps a write-side allow writable when the same pattern has an explicit read allow", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { ":root": "deny", "~/proj/**": "allow" },
          write: { "~/proj/**": "allow" },
        },
        logger,
      });

      expect(fileContent).toContain('"~/proj/**" = "write"');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("treats '.', './**' and :workspace_roots read denials as covering workspace-relative paths", async () => {
      for (const readPattern of [".", "./**", "./", ":workspace_roots"]) {
        const logger = createMockLogger();
        const fileContent = await generate({
          permission: {
            read: { [readPattern]: "deny" },
            edit: { "src/a.ts": "deny", "/abs/file": "deny" },
            write: { "docs/**": "allow" },
          },
          logger,
        });

        const workspaceRoots = parseWorkspaceRoots(fileContent);
        expect(workspaceRoots["src/a.ts"]).toBe("deny");
        expect(workspaceRoots["docs/**"]).toBe("deny");
        // Absolute paths are outside the workspace-relative scope.
        expect(fileContent).toContain('"/abs/file" = "read"');
      }
    });

    it("treats a backslash as a separator for Windows drive paths", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "C:\\secret": "deny", "D:\\data\\**": "ask" },
          edit: { "C:\\secret\\k": "deny", "D:\\data\\x\\y": "deny", "C:\\secretive": "deny" },
        },
        logger,
      });

      const parsed = smolToml.parse(fileContent) as ParsedToml;
      const filesystem = parsed.permissions.rulesync.filesystem;
      expect(filesystem["C:\\secret\\k"]).toBe("deny");
      expect(filesystem["D:\\data\\x\\y"]).toBe("deny");
      // A sibling that merely shares a prefix is not covered.
      expect(filesystem["C:\\secretive"]).toBe("read");
    });

    it("compares Windows drive letters case-insensitively without rewriting emitted keys", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "c:\\secret": "deny" },
          edit: { "C:\\secret\\k": "deny" },
        },
        logger,
      });

      const parsed = smolToml.parse(fileContent) as ParsedToml;
      const filesystem = parsed.permissions.rulesync.filesystem;
      expect(filesystem["C:\\secret\\k"]).toBe("deny");
      expect(filesystem["c:\\secret"]).toBe("deny");
      expect(filesystem["c:\\secret\\k"]).toBeUndefined();
    });

    it("does not let a workspace-relative read allow cover an absolute drive path", async () => {
      const denied = await generate({
        permission: {
          read: { ":root": "deny", "C:": "allow" },
          edit: { "C:\\secret\\k": "deny" },
        },
        logger: createMockLogger(),
      });
      const deniedFilesystem = (smolToml.parse(denied) as ParsedToml).permissions.rulesync
        .filesystem;
      // The relative `C:` does not cover the drive path, so `:root` deny is
      // the most specific covering rule.
      expect(deniedFilesystem["C:\\secret\\k"]).toBe("deny");

      const logger = createMockLogger();
      const allowed = await generate({
        permission: {
          read: { ":root": "deny", "C:": "allow" },
          edit: { "C:/secret/k": "allow" },
        },
        logger,
      });
      const allowedFilesystem = (smolToml.parse(allowed) as ParsedToml).permissions.rulesync
        .filesystem;
      expect(allowedFilesystem["C:/secret/k"]).toBe("deny");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'cannot express "writable but not readable": pattern "C:/secret/k" has a write-side allow',
        ),
      );
    });

    it("never lets a narrower read allow win for keys or patterns with '.'/'..' segments", async () => {
      const cases: Array<{
        read: Record<string, string>;
        edit: Record<string, string>;
        key: string;
      }> = [
        {
          read: { "/home/me/**": "deny", "/home/me/public": "allow" },
          edit: { "/home/me/public/../.ssh/id_rsa": "deny" },
          key: "/home/me/public/../.ssh/id_rsa",
        },
        {
          read: { ":root": "deny", "~/public": "allow" },
          edit: { "~/public/../.ssh/id_rsa": "deny" },
          key: "~/public/../.ssh/id_rsa",
        },
        {
          read: { "/home/me/**": "deny", "/home/me/pub": "allow" },
          edit: { "/home/me/./pub/../.ssh/k": "deny" },
          key: "/home/me/./pub/../.ssh/k",
        },
        {
          // A dot segment in the allow pattern itself is not trusted either.
          read: { "/home/me/**": "deny", "/home/me/x/../pub": "allow" },
          edit: { "/home/me/x/../pub/k": "deny" },
          key: "/home/me/x/../pub/k",
        },
      ];
      for (const { read, edit, key } of cases) {
        const fileContent = await generate({
          permission: { read, edit },
          logger: createMockLogger(),
        });
        const filesystem = (smolToml.parse(fileContent) as ParsedToml).permissions.rulesync
          .filesystem;
        expect(filesystem[key]).toBe("deny");
      }
    });

    it("still lets a narrower read allow win for workspace-relative './'-prefixed keys", async () => {
      const fileContent = await generate({
        permission: {
          read: { "**": "deny", "pub/**": "allow" },
          edit: { "./pub/k": "deny" },
        },
        logger: createMockLogger(),
      });
      expect(parseWorkspaceRoots(fileContent)["pub/k"]).toBe("read");
    });

    it("does not let a workspace-relative read deny cover an absolute drive path", async () => {
      const fileContent = await generate({
        permission: {
          read: { "C:": "deny" },
          edit: { "C:/secret/k": "deny" },
        },
        logger: createMockLogger(),
      });
      const filesystem = (smolToml.parse(fileContent) as ParsedToml).permissions.rulesync
        .filesystem;
      expect(filesystem["C:/secret/k"]).toBe("read");
      expect(parseWorkspaceRoots(fileContent)["C:"]).toBe("deny");
    });

    it("leaves ~ versus absolute paths and non-trailing globs unmatched", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "~/.aws/**": "deny", "**/*.pem": "deny" },
          edit: { "/home/u/.aws/credentials": "deny", "certs/a.pem": "deny" },
        },
        logger,
      });

      // Codex expands `~` on the machine it runs on, which rulesync cannot
      // know, so only the generic warning is logged.
      expect(fileContent).toContain('"/home/u/.aws/credentials" = "read"');
      expect(parseWorkspaceRoots(fileContent)["certs/a.pem"]).toBe("read");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'maps a write-side deny to read-only access: pattern "/home/u/.aws/credentials"',
        ),
      );
    });

    it("uses the most specific covering read rule", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "/x/**": "deny", "/x/y": "allow", "/p/**": "allow", "/p/q/**": "ask" },
          edit: { "/x/y/z": "deny", "/x/w": "deny", "/p/q/r": "deny", "/p/s": "deny" },
        },
        logger,
      });

      // `/x/y` allow is more specific than `/x/**` deny for `/x/y/z`.
      expect(fileContent).toContain('"/x/y/z" = "read"');
      expect(fileContent).toContain('"/x/w" = "deny"');
      expect(fileContent).toContain('"/p/q/r" = "deny"');
      expect(fileContent).toContain('"/p/s" = "read"');
    });

    it("ignores a more specific read allow that Codex never receives", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "/x/**": "deny", "/x/y/*.txt": "allow" },
          edit: { "/x/y/z.txt": "deny" },
        },
        logger,
      });

      // The glob allow is skipped as an unsupported grant, so it cannot
      // override the broader deny in Codex.
      expect(fileContent).not.toContain('"/x/y/*.txt"');
      expect(fileContent).toContain('"/x/y/z.txt" = "deny"');
    });

    it("resolves equally specific read rules to the restrictive action", async () => {
      const logger = createMockLogger();
      const fileContent = await generate({
        permission: {
          read: { "/x": "allow", "/x/**": "deny" },
          edit: { "/x/z": "deny" },
        },
        logger,
      });

      expect(fileContent).toContain('"/x/z" = "deny"');
    });
  });

  it("should treat exact, /** and ./-prefixed read denials as covering ancestors", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          // Codex applies an exact directory entry to its whole subtree.
          read: { "/home/me/.ssh": "deny", "./private/**": "deny", "config/": "ask" },
          write: {
            "/home/me/.ssh/id_rsa": "deny",
            "private/key.pem": "deny",
            "./config/app.json": "ask",
          },
        },
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/home/me/.ssh/id_rsa" = "deny"');
    const workspaceRoots = parseWorkspaceRoots(fileContent);
    expect(workspaceRoots["private/key.pem"]).toBe("deny");
    // Leading `./` is stripped from emitted `:workspace_roots` keys.
    expect(workspaceRoots["config/app.json"]).toBe("deny");
    expect(workspaceRoots["./config/app.json"]).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should treat a /** read denial as covering absolute and relative paths", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "/**": "deny" },
          edit: { "/etc/hosts": "deny", "src/main.ts": "ask" },
        },
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/etc/hosts" = "deny"');
    expect(parseWorkspaceRoots(fileContent)["src/main.ts"]).toBe("deny");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should skip ?, [...] and non-trailing glob grants like Codex", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "src/?.ts": "allow", "src/[ab].ts": "allow" },
          // Only a single trailing `/**` is supported; `src/*` before it is not.
          write: { "src/*/**": "allow" },
        },
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain('"src/?.ts"');
    expect(fileContent).not.toContain('"src/[ab].ts"');
    expect(fileContent).not.toContain('"src/*/**"');
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unsupported Codex CLI read filesystem glob "src/?.ts"'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unsupported Codex CLI read filesystem glob "src/[ab].ts"'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unsupported Codex CLI write filesystem glob "src/*/**"'),
    );
  });

  it("should select :danger-full-access via default_permissions and skip the managed profile", async () => {
    const logger = createMockLogger();
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    // A previous generate left a managed profile behind; a hand-written
    // sibling profile must survive while the managed one is pruned.
    await writeFileContent(
      join(codexDir, "config.toml"),
      [
        'default_permissions = "rulesync"',
        "",
        "[permissions.custom]",
        'description = "hand-written sibling profile"',
        "",
        "[permissions.rulesync]",
        'extends = ":workspace"',
        "",
      ].join("\n"),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "/workspace/project/**": "allow" },
        },
        codexcli: { base_permission_profile: ":danger-full-access" },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('default_permissions = ":danger-full-access"');
    expect(fileContent).not.toContain("[permissions.rulesync]");
    expect(fileContent).toContain("[permissions.custom]");
    // Canonical filesystem rules are not representable without a sandbox.
    expect(fileContent).not.toContain("/workspace/project/**");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('":danger-full-access" removes the sandbox'),
    );
    // The prune is never silent — hand-written keys may live in the profile.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('prunes the managed "[permissions.rulesync]" profile'),
    );
  });

  it("should not leave an empty [permissions] header when :danger-full-access starts from a clean config", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {},
        codexcli: { base_permission_profile: ":danger-full-access" },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('default_permissions = ":danger-full-access"');
    expect(fileContent).not.toContain("[permissions]");
    // No managed profile existed, so no prune warning fires.
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("prunes the managed"));
  });

  it("should round-trip a directly-selected :danger-full-access baseline on import", async () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: 'default_permissions = ":danger-full-access"\n',
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const parsed = JSON.parse(rulesyncPermissions.getFileContent());
    expect(parsed.codexcli.base_permission_profile).toBe(":danger-full-access");
  });

  it("should preserve unmanaged config.toml params on regeneration", async () => {
    const logger = createMockLogger();
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "high"',
        "",
        "[tools]",
        "web_search = true",
        "",
        "[permissions.custom]",
        'description = "hand-written sibling profile"',
        "",
        "[permissions.rulesync]",
        'extends = ":workspace"',
        "",
        "[permissions.rulesync.workspace_roots]",
        '"/workspace/extra" = "write"',
        "",
        "[permissions.rulesync.network]",
        'proxy_url = "http://proxy.local:8080"',
        "enable_socks5 = false",
        "",
      ].join("\n"),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "github.com": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    // Unmanaged top-level keys survive.
    expect(fileContent).toContain('model = "gpt-5.4"');
    expect(fileContent).toContain('model_reasoning_effort = "high"');
    expect(fileContent).toContain("web_search = true");
    // Sibling profiles survive.
    expect(fileContent).toContain('description = "hand-written sibling profile"');
    // Unmanaged keys inside the rulesync profile and its network table survive.
    expect(fileContent).toContain('"/workspace/extra" = "write"');
    expect(fileContent).toContain('proxy_url = "http://proxy.local:8080"');
    expect(fileContent).toContain("enable_socks5 = false");
    // Managed keys are still regenerated.
    expect(fileContent).toContain('"github.com" = "allow"');
    expect(fileContent).toContain('default_permissions = "rulesync"');
  });

  it("should place relative filesystem globs under the Codex workspace roots table", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "**/*.tf": "deny",
            "src/**": "allow",
            "/workspace/project/**": "allow",
          },
          write: {
            "docs/**": "allow",
          },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain("[permissions.rulesync.filesystem]");
    expect(fileContent).toContain("glob_scan_max_depth = 8");
    expect(fileContent).toContain('"/workspace/project/**" = "read"');
    expect(fileContent).toContain('[permissions.rulesync.filesystem.":workspace_roots"]');
    expect(fileContent).toContain('"**/*.tf" = "deny"');
    expect(fileContent).toContain('"src/**" = "read"');
    expect(fileContent).toContain('"docs/**" = "write"');
  });

  it("should convert Codex CLI permissions profile to rulesync format", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
"/workspace/project/**" = "read"
"/workspace/project/src/**" = "write"
"/workspace/project/.env" = "deny"

[permissions.rulesync.network]
enabled = true

[permissions.rulesync.network.domains]
"github.com" = "allow"
"example.com" = "deny"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.read?.["/workspace/project/**"]).toBe("allow");
    expect(json.permission.edit?.["/workspace/project/src/**"]).toBe("allow");
    expect(json.permission.read?.["/workspace/project/.env"]).toBe("deny");
    expect(json.permission.webfetch?.["github.com"]).toBe("allow");
    expect(json.permission.webfetch?.["example.com"]).toBe("deny");
  });

  it("should skip unsupported read/write grant globs without glob scan depth", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "**": "allow",
          },
          write: {
            "docs/*": "allow",
          },
        },
        // The default `.git/**` carve-out would otherwise trigger the depth
        // key on every generate; disable it to test the wildcard detection.
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain('[permissions.rulesync.filesystem.":workspace_roots"]');
    expect(fileContent).not.toContain('"**"');
    expect(fileContent).not.toContain('"docs/*"');
    expect(fileContent).not.toContain("glob_scan_max_depth");
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping unsupported Codex CLI read filesystem glob"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping unsupported Codex CLI write filesystem glob"),
    );
  });

  it("should emit workspace-root rules without glob scan depth when no pattern has **", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          // Deny globs are still emitted, so the workspace-roots table exists.
          read: { "src/*": "deny" },
        },
        // The default `.git/**` carve-out would otherwise trigger the depth key.
        codexcli: { git_write_rules: false },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('[permissions.rulesync.filesystem.":workspace_roots"]');
    expect(parseWorkspaceRoots(fileContent)["src/*"]).toBe("deny");
    expect(fileContent).not.toContain("glob_scan_max_depth");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should import a Codex read entry as read allow only (one-way merge)", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
"/x/**" = "read"
`,
    });

    const json = codexPermissions.toRulesyncPermissions().getJson();
    // A write-side-only `edit: deny` generated as "read" does not survive the
    // round-trip; this asymmetry is documented rather than changed.
    expect(json.permission.read?.["/x/**"]).toBe("allow");
    expect(json.permission.edit?.["/x/**"]).toBeUndefined();
  });

  it("should import nested Codex workspace root filesystem rules", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
glob_scan_max_depth = 8
"/workspace/project/**" = "read"

[permissions.rulesync.filesystem.":workspace_roots"]
"**/*.tf" = "deny"
"src/**" = "read"
"docs/**" = "write"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.read?.["/workspace/project/**"]).toBe("allow");
    expect(json.permission.read?.["**/*.tf"]).toBe("deny");
    expect(json.permission.edit?.["**/*.tf"]).toBe("deny");
    expect(json.permission.read?.["src/**"]).toBe("allow");
    expect(json.permission.edit?.["docs/**"]).toBe("allow");
  });

  it("should import legacy nested Codex project root filesystem rules", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem.":project_roots"]
"**/*.tf" = "none"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.read?.["**/*.tf"]).toBe("deny");
    expect(json.permission.edit?.["**/*.tf"]).toBe("deny");
  });

  it("should warn when :workspace_roots is set as a direct string access rule", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            ":workspace_roots": "deny",
            "src/**": "allow",
          },
        },
      }),
    });

    await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('":workspace_roots" is set as a direct filesystem access rule'),
    );
  });

  it("should skip empty string patterns with a warning", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "": "allow",
            "src/**": "allow",
          },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith("Skipping empty pattern in filesystem permissions.");

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain('""');
  });

  it("should load existing .codex/config.toml", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(join(codexDir, "config.toml"), 'default_permissions = "rulesync"');

    const loaded = await CodexcliPermissions.fromFile({ outputRoot: testDir });
    expect(loaded).toBeInstanceOf(CodexcliPermissions);
    expect(loaded.getFileContent()).toContain('default_permissions = "rulesync"');
  });

  it("should regenerate network.enabled from webfetch rules (not passthrough)", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync]
extends = ":workspace"

[permissions.rulesync.network]
enabled = true

[permissions.rulesync.network.domains]
"github.com" = "allow"
`,
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "api.example.com": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain("enabled = true");
    expect(fileContent).toContain('extends = ":workspace"');
    expect(fileContent).toContain('"api.example.com" = "allow"');
  });

  it("should emit extends = ':workspace' by default when base_permission_profile is unspecified", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "src/**": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('extends = ":workspace"');
    expect(fileContent).toContain('"src/**" = "write"');
  });

  it("should emit extends from codexcli.base_permission_profile when specified", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "src/**": "allow" },
        },
        codexcli: { base_permission_profile: ":read-only" },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('extends = ":read-only"');
    expect(fileContent).not.toContain('extends = ":workspace"');
    // Consumed by the profile, never written as a top-level config key.
    expect(fileContent).not.toContain("base_permission_profile");
    expect(fileContent).toContain('"src/**" = "write"');
  });

  it("should import extends into codexcli.base_permission_profile", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync]
extends = ":workspace"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.codexcli?.base_permission_profile).toBe(":workspace");
    expect(json.permission.edit?.["."]).toBeUndefined();
  });

  it("should not import a custom extends parent into codexcli.base_permission_profile", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync]
extends = "my-custom-profile"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.codexcli?.base_permission_profile).toBeUndefined();
  });

  it("should round-trip an extends-only profile back to the same extends shape", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync]
extends = ":workspace"
`,
    );

    const imported = await CodexcliPermissions.fromFile({ outputRoot: testDir });
    const rulesyncPermissions = imported.toRulesyncPermissions();

    const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: rulesyncPermissions.getFileContent(),
      }),
    });

    const fileContent = regenerated.getFileContent();
    expect(fileContent).toContain('extends = ":workspace"');
    // The baseline round-trips via codexcli.base_permission_profile, not a
    // synthesized workspace-wide write rule.
    expect(fileContent).not.toContain('"." = "write"');
  });

  it("should preserve description on round-trip through rulesync", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync]
description = "My project profile"
`,
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: {} }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('description = "My project profile"');
  });

  it("should preserve network.mode and unix_sockets on round-trip through rulesync", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.network]
mode = "full"

[permissions.rulesync.network.unix_sockets]
"/var/run/docker.sock" = "allow"
`,
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "api.example.com": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain("enabled = true");
    expect(fileContent).toContain('mode = "full"');
    expect(fileContent).toContain('"/var/run/docker.sock" = "allow"');
  });

  it("should emit the default extends baseline alongside deny edit rules", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "**/*.tf": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('extends = ":workspace"');
    expect(fileContent).toContain('"**/*.tf" = "deny"');
  });

  it("should emit wildcard allow as a regular domain entry with enabled = true", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain("enabled = true");
    expect(fileContent).toContain("[permissions.rulesync.network.domains]");
    expect(fileContent).toContain('"*" = "allow"');
  });

  it("should round-trip a wildcard allow mixed with deny domains", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "allow", "internal.example.com": "deny" },
        },
      }),
    });

    const generated = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = generated.getFileContent();
    expect(fileContent).toContain("enabled = true");
    expect(fileContent).toContain('"*" = "allow"');
    expect(fileContent).toContain('"internal.example.com" = "deny"');

    const reimported = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent,
    });
    const json = reimported.toRulesyncPermissions().getJson();
    expect(json.permission.webfetch?.["*"]).toBe("allow");
    expect(json.permission.webfetch?.["internal.example.com"]).toBe("deny");
  });

  it("should not import allow domains when network.enabled is absent", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network.domains]
"github.com" = "allow"
"example.com" = "deny"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch?.["github.com"]).toBeUndefined();
    expect(json.permission.webfetch?.["example.com"]).toBe("deny");
  });

  it("should skip wildcard deny webfetch rules with a warning", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('rejects the global wildcard "*"'),
    );
    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain("[permissions.rulesync.network]");
    expect(fileContent).not.toContain('"*"');
  });

  it("should emit deny-only domains without enabling the network", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "example.com": "deny" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain("enabled = true");
    expect(fileContent).toContain("[permissions.rulesync.network.domains]");
    expect(fileContent).toContain('"example.com" = "deny"');
  });

  it("should re-import deny-only domains emitted without enabled", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network.domains]
"example.com" = "deny"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch?.["example.com"]).toBe("deny");
  });

  it("should warn when preserving existing network.mode", async () => {
    const logger = createMockLogger();
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.network]
mode = "full"
`,
    );

    await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: {} }),
      }),
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Preserving existing "network.mode"'),
    );
  });

  it("should preserve unrecognized unix_sockets values verbatim", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.network.unix_sockets]
"/var/run/docker.sock" = "readwrite"
`,
    );

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: {} }),
      }),
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('"/var/run/docker.sock" = "readwrite"');
  });

  it("should not import domains when network.enabled is false", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network]
enabled = false

[permissions.rulesync.network.domains]
"github.com" = "allow"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch).toBeUndefined();
  });

  it("should not fall back to wildcard when domains table has only unrecognized values", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network]
enabled = true

[permissions.rulesync.network.domains]
"github.com" = "ask"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch?.["*"]).toBeUndefined();
  });

  it("should not emit network block when no webfetch rules are configured", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: {} }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain("enabled");
    expect(fileContent).not.toContain("[permissions.rulesync.network]");
  });

  it("should import network.enabled=true with domains to rulesync webfetch", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network]
enabled = true

[permissions.rulesync.network.domains]
"github.com" = "allow"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch?.["github.com"]).toBe("allow");
  });

  it("should import network.enabled=true without domains as webfetch wildcard allow", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.network]
enabled = true
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.webfetch?.["*"]).toBe("allow");
  });

  it("should place preserved fields in the correct TOML table structure", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync]
extends = ":workspace"
description = "Test profile"

[permissions.rulesync.network]
enabled = true
mode = "full"

[permissions.rulesync.network.unix_sockets]
"/var/run/docker.sock" = "allow"
`,
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { ".": "allow" },
          webfetch: { "api.example.com": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
    const permissions = parsed["permissions"] as Record<string, unknown>;
    const profile = permissions["rulesync"] as Record<string, unknown>;
    const network = profile["network"] as Record<string, unknown>;
    const unixSockets = network["unix_sockets"] as Record<string, unknown>;

    expect(profile["extends"]).toBe(":workspace");
    expect(profile["description"]).toBe("Test profile");
    expect(network["enabled"]).toBe(true);
    expect(network["mode"]).toBe("full");
    expect(unixSockets["/var/run/docker.sock"]).toBe("allow");
    const domains = network["domains"] as Record<string, unknown>;
    expect(domains["api.example.com"]).toBe("allow");
  });

  it("should always emit :minimal = 'read' as a filesystem baseline", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: {} }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain("[permissions.rulesync.filesystem]");
    expect(fileContent).toContain('":minimal" = "read"');
  });

  it("should emit :minimal = 'read' alongside user filesystem rules", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow" },
          edit: { "docs/**": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('":minimal" = "read"');
    expect(fileContent).toContain('"src/**" = "read"');
    expect(fileContent).toContain('"docs/**" = "write"');
  });

  it("should let a canonical :minimal write rule override the read baseline", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          write: { ":root": "allow", ":minimal": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('":root" = "write"');
    expect(fileContent).toContain('":minimal" = "write"');
    expect(fileContent).not.toContain('":minimal" = "read"');
  });

  it("should drop a customized :minimal on import and fall back to the read baseline on regenerate", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "write"
":root" = "write"
`,
    );

    const imported = await CodexcliPermissions.fromFile({ outputRoot: testDir });
    const rulesyncPermissions = imported.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    // `:minimal` is skipped on import regardless of its value, while `:root` imports normally.
    expect(json.permission.read?.[":minimal"]).toBeUndefined();
    expect(json.permission.edit?.[":minimal"]).toBeUndefined();
    expect(json.permission.edit?.[":root"]).toBe("allow");

    const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: rulesyncPermissions.getFileContent(),
      }),
    });

    const fileContent = regenerated.getFileContent();
    expect(fileContent).toContain('":root" = "write"');
    expect(fileContent).toContain('":minimal" = "read"');
  });

  it("should not import :minimal into rulesync permissions model", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "read"
"src/**" = "read"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.read?.[":minimal"]).toBeUndefined();
    expect(json.permission.edit?.[":minimal"]).toBeUndefined();
    expect(json.permission.read?.["src/**"]).toBe("allow");
  });

  it("should round-trip :minimal through rulesync without loss", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "read"
"src/**" = "read"
`,
    );

    const imported = await CodexcliPermissions.fromFile({ outputRoot: testDir });
    const rulesyncPermissions = imported.toRulesyncPermissions();

    const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: rulesyncPermissions.getFileContent(),
      }),
    });

    const fileContent = regenerated.getFileContent();
    expect(fileContent).toContain('":minimal" = "read"');
    expect(fileContent).toContain('"src/**" = "read"');
  });

  it("should preserve user-customized :root and :tmpdir through the rulesync model on a fresh generate", async () => {
    // Import a config whose special paths are user-managed, capture the resulting rulesync model,
    // then regenerate into a FRESH directory with NO pre-existing .codex/config.toml. The values
    // must survive because they round-trip through the model, not via an existing config overlay.
    const sourceCodexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "read"
":root" = "deny"
":tmpdir" = "write"
`,
    });

    const rulesyncPermissions = sourceCodexPermissions.toRulesyncPermissions();

    const { testDir: freshDir, cleanup: cleanupFresh } = await setupTestDirectory();
    try {
      const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: freshDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: freshDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: rulesyncPermissions.getFileContent(),
        }),
      });

      const fileContent = regenerated.getFileContent();
      expect(fileContent).toContain('":minimal" = "read"');
      expect(fileContent).toContain('":root" = "deny"');
      expect(fileContent).toContain('":tmpdir" = "write"');
    } finally {
      await cleanupFresh();
    }
  });

  it("should import :root and :tmpdir into the rulesync model but never :minimal", () => {
    const codexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "read"
":root" = "deny"
":tmpdir" = "write"
"src/**" = "read"
`,
    });

    const rulesyncPermissions = codexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    // `:minimal` is the always-emitted fixed baseline and must not pollute the model.
    expect(json.permission.read?.[":minimal"]).toBeUndefined();
    expect(json.permission.edit?.[":minimal"]).toBeUndefined();
    // `:root = "deny"` becomes a deny on both read and edit.
    expect(json.permission.read?.[":root"]).toBe("deny");
    expect(json.permission.edit?.[":root"]).toBe("deny");
    // `:tmpdir = "write"` becomes an edit allow.
    expect(json.permission.edit?.[":tmpdir"]).toBe("allow");
    expect(json.permission.read?.["src/**"]).toBe("allow");
  });

  it("should not lose a restrictive :root = 'deny' on a fresh-clone generate (regression for #1965)", async () => {
    // Regression: PR #1960 skipped :root/:tmpdir/:slash_tmp on import and relied on an existing
    // .codex/config.toml to re-emit them. In a fresh clone (no generated config) a user's
    // restrictive ":root" = "deny" was silently dropped. The values must now survive purely
    // through the rulesync model.
    const sourceCodexPermissions = new CodexcliPermissions({
      outputRoot: testDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
":minimal" = "read"
":root" = "deny"
":tmpdir" = "write"
`,
    });

    const rulesyncPermissions = sourceCodexPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();
    expect(json.permission.read?.[":root"]).toBe("deny");
    expect(json.permission.edit?.[":root"]).toBe("deny");
    expect(json.permission.edit?.[":tmpdir"]).toBe("allow");

    const { testDir: freshDir, cleanup: cleanupFresh } = await setupTestDirectory();
    try {
      const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: freshDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: freshDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: rulesyncPermissions.getFileContent(),
        }),
      });

      const fileContent = regenerated.getFileContent();
      // The restrictive deny is preserved, not lost.
      expect(fileContent).toContain('":root" = "deny"');
      expect(fileContent).toContain('":tmpdir" = "write"');
      // The fixed baseline is still always emitted.
      expect(fileContent).toContain('":minimal" = "read"');
    } finally {
      await cleanupFresh();
    }
  });

  it("should preserve granular tool-approval keys (default_tools_approval_mode, approval_policy, approvals_reviewer, apps.*, mcp_servers.*) on round-trip", async () => {
    const codexDir = join(testDir, ".codex");
    await ensureDir(codexDir);
    await writeFileContent(
      join(codexDir, "config.toml"),
      `
default_tools_approval_mode = "prompt"
approvals_reviewer = "auto_review"

[approval_policy]
sandbox_approval = true
rules = true
mcp_elicitations = false
request_permissions = true
skill_approval = false

[apps.myapp]
default_tools_approval_mode = "auto"

[mcp_servers.myserver]
default_tools_approval_mode = "approve"
command = "node"
`,
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "src/**": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    const parsed = smolToml.parse(fileContent) as Record<string, unknown>;

    expect(parsed.default_tools_approval_mode).toBe("prompt");
    expect(parsed.approvals_reviewer).toBe("auto_review");
    expect(parsed.approval_policy).toEqual({
      sandbox_approval: true,
      rules: true,
      mcp_elicitations: false,
      request_permissions: true,
      skill_approval: false,
    });
    expect((parsed.apps as Record<string, unknown>).myapp).toEqual({
      default_tools_approval_mode: "auto",
    });
    expect((parsed.mcp_servers as Record<string, unknown>).myserver).toEqual({
      default_tools_approval_mode: "approve",
      command: "node",
    });

    // The rulesync-managed profile is still written alongside the preserved keys.
    expect(fileContent).toContain('default_permissions = "rulesync"');
    expect(fileContent).toContain('"src/**" = "read"');
  });

  it("should convert rulesync bash permissions to Codex CLI .rules file", () => {
    const rulesFile = createCodexcliBashRulesFile({
      outputRoot: testDir,
      config: {
        permission: {
          bash: {
            "git status": "allow",
            "gh pr view": "ask",
            "rm -rf /": "deny",
          },
        },
      },
    });

    const content = rulesFile.getFileContent();
    expect(rulesFile.getRelativeDirPath()).toBe(join(".codex", "rules"));
    expect(rulesFile.getRelativeFilePath()).toBe("rulesync.rules");
    expect(content).toContain('pattern = ["git", "status"]');
    expect(content).toContain('decision = "allow"');
    expect(content).toContain('pattern = ["gh", "pr", "view"]');
    expect(content).toContain('decision = "prompt"');
    expect(content).toContain('pattern = ["rm", "-rf", "/"]');
    expect(content).toContain('decision = "forbidden"');
  });

  it("should not auto-approve a bash allow that an all-tools deny covers", () => {
    const rulesFile = createCodexcliBashRulesFile({
      outputRoot: testDir,
      config: {
        permission: {
          "*": { "rm *": "deny" },
          bash: { "rm *": "allow", "git status": "allow" },
        },
      },
    });

    const content = rulesFile.getFileContent();
    expect(content).toContain('pattern = ["git", "status"]');
    expect(content).toContain('decision = "allow"');
    expect(content).toContain('pattern = ["rm", "*"]');
    expect(content).toContain('decision = "forbidden"');
    expect(content).not.toMatch(/pattern = \["rm", "\*"\][\s\S]*decision = "allow"/);
  });

  describe("codexcli override (approval_policy / sandbox_mode / apps)", () => {
    it("authors override keys as top-level config.toml keys on generate", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: {
            approval_policy: "on-request",
            sandbox_mode: "workspace-write",
            sandbox_workspace_write: { network_access: true },
            apps: { web: { default_tools_approval_mode: "prompt" } },
          },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("on-request");
      expect(parsed.sandbox_mode).toBe("workspace-write");
      expect(parsed.sandbox_workspace_write).toEqual({ network_access: true });
      expect(parsed.apps).toEqual({ web: { default_tools_approval_mode: "prompt" } });
      // The canonical profile is still managed alongside the override.
      expect(parsed.default_permissions).toBe("rulesync");
    });

    it("shallow-merges override table values with existing sibling keys", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[apps.editor]",
          'default_tools_approval_mode = "auto"',
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: { apps: { web: { default_tools_approval_mode: "prompt" } } },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.apps).toEqual({
        editor: { default_tools_approval_mode: "auto" },
        web: { default_tools_approval_mode: "prompt" },
      });
    });

    it("authors and round-trips the [tui] table (vim_mode_default)", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: { tui: { vim_mode_default: true } },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.tui).toEqual({ vim_mode_default: true });
      expect(logger.warn.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
        '"tui" is not managed',
      );

      const reimported = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: codexPermissions.getFileContent(),
      });
      expect(reimported.toRulesyncPermissions().getJson().codexcli?.tui).toEqual({
        vim_mode_default: true,
      });
    });

    it("refuses non-whitelisted override keys (mcp_servers / permissions) with a warning", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: {
            sandbox_mode: "read-only",
            mcp_servers: { evil: { disabled_tools: ["*"] } },
            default_permissions: "attacker",
          },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.sandbox_mode).toBe("read-only");
      // mcp_servers must never be written by the permissions override.
      expect(parsed.mcp_servers).toBeUndefined();
      // default_permissions stays the canonical-managed value, not the injected one.
      expect(parsed.default_permissions).toBe("rulesync");
      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.some((line) => line.includes("mcp_servers"))).toBe(true);
      expect(warnMessages.some((line) => line.includes("default_permissions"))).toBe(true);
    });

    it("round-trips override keys back into the codexcli override on import", () => {
      const codexPermissions = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: [
          'default_permissions = "rulesync"',
          'approval_policy = "never"',
          'sandbox_mode = "danger-full-access"',
          "[sandbox_workspace_write]",
          "network_access = false",
          "[apps.web.tools.browse]",
          'approval_mode = "prompt"',
        ].join("\n"),
      });

      const json = codexPermissions.toRulesyncPermissions().getJson();
      expect(json.codexcli?.approval_policy).toBe("never");
      expect(json.codexcli?.sandbox_mode).toBe("danger-full-access");
      expect(json.codexcli?.sandbox_workspace_write).toEqual({ network_access: false });
      expect(json.codexcli?.apps).toEqual({
        web: { tools: { browse: { approval_mode: "prompt" } } },
      });
    });

    it("omits the codexcli override when no override keys are present", () => {
      const codexPermissions = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: 'default_permissions = "rulesync"',
      });

      const json = codexPermissions.toRulesyncPermissions().getJson();
      expect(json.codexcli).toBeUndefined();
    });

    it("accepts every documented enum value for approval_policy / sandbox_mode / approvals_reviewer / base_permission_profile", () => {
      const cases = [
        // `untrusted` was retired upstream but still parses so an existing
        // permissions file keeps loading; generate warns and skips it.
        { approval_policy: "untrusted" },
        { approval_policy: "on-request" },
        // `on-failure` is a deprecated alias Codex still reads as `on-request`.
        { approval_policy: "on-failure" },
        { approval_policy: "never" },
        // The granular table form still round-trips through the enum union.
        { approval_policy: { granular: { sandbox_approval: true } } },
        { sandbox_mode: "read-only" },
        { sandbox_mode: "workspace-write" },
        { sandbox_mode: "danger-full-access" },
        { approvals_reviewer: "user" },
        { approvals_reviewer: "auto_review" },
        { approvals_reviewer: "guardian_subagent" },
        { base_permission_profile: ":read-only" },
        { base_permission_profile: ":workspace" },
      ];

      for (const codexcli of cases) {
        expect(
          () =>
            new RulesyncPermissions({
              outputRoot: testDir,
              relativeDirPath: ".rulesync",
              relativeFilePath: "permissions.json",
              fileContent: JSON.stringify({ permission: {}, codexcli }),
              validate: true,
            }),
        ).not.toThrow();
      }
    });

    it("rejects out-of-range enum values for approval_policy / sandbox_mode / approvals_reviewer / base_permission_profile", () => {
      const cases = [
        { approval_policy: "on-success" },
        { sandbox_mode: "read-write" },
        { approvals_reviewer: "reviewer" },
        // `:danger-full-access` IS accepted (selected via default_permissions
        // rather than `extends`), so only unknown profiles are rejected here.
        { base_permission_profile: "my-custom-profile" },
      ];

      for (const codexcli of cases) {
        expect(
          () =>
            new RulesyncPermissions({
              outputRoot: testDir,
              relativeDirPath: ".rulesync",
              relativeFilePath: "permissions.json",
              fileContent: JSON.stringify({ permission: {}, codexcli }),
              validate: true,
            }),
        ).toThrow();
      }
    });

    it("emits default approval_policy / approvals_reviewer when unspecified", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "src/**": "allow" } } }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("on-request");
      expect(parsed.approvals_reviewer).toBe("auto_review");
    });

    it("does not clobber existing user-set approval_policy / approvals_reviewer with the defaults", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        ['approval_policy = "never"', 'approvals_reviewer = "user"'].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "src/**": "allow" } } }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("never");
      expect(parsed.approvals_reviewer).toBe("user");
    });

    it("lets override values win over the approval_policy / approvals_reviewer defaults", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: { approval_policy: "never", approvals_reviewer: "user" },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("never");
      expect(parsed.approvals_reviewer).toBe("user");
    });

    describe("retired approval_policy = untrusted (Codex 0.149.0)", () => {
      // Codex refuses to start on an explicit `approval_policy = "untrusted"`
      // (`is no longer supported; remove this setting`), so writing it is
      // never right: the key falls back to the existing value or the default.
      it("does not write the retired value and falls back to the default with a warning", async () => {
        const logger = createMockLogger();
        const rulesyncPermissions = new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { read: { "src/**": "allow" } },
            codexcli: { approval_policy: "untrusted" },
          }),
        });

        const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions,
          logger,
        });

        const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
        expect(parsed.approval_policy).toBe("on-request");
        const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
        expect(
          warnMessages.some(
            (line) =>
              line.includes('"approval_policy": "untrusted"') &&
              line.includes("retired in Codex 0.149.0") &&
              line.includes('trust_level = "untrusted"'),
          ),
        ).toBe(true);
      });

      it("keeps an existing user-set approval_policy when the retired override is skipped", async () => {
        const logger = createMockLogger();
        const codexDir = join(testDir, ".codex");
        await ensureDir(codexDir);
        await writeFileContent(join(codexDir, "config.toml"), 'approval_policy = "never"\n');
        const rulesyncPermissions = new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { read: { "src/**": "allow" } },
            codexcli: { approval_policy: "untrusted" },
          }),
        });

        const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions,
          logger,
        });

        const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
        expect(parsed.approval_policy).toBe("never");
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("retired in Codex 0.149.0"),
        );
      });

      it("replaces a leftover approval_policy = untrusted in config.toml with the default", async () => {
        // An earlier rulesync still wrote `untrusted`; keeping it would leave a
        // config.toml Codex refuses to start with on every regeneration.
        const logger = createMockLogger();
        const codexDir = join(testDir, ".codex");
        await ensureDir(codexDir);
        await writeFileContent(
          join(codexDir, "config.toml"),
          ['approval_policy = "untrusted"', 'approvals_reviewer = "user"'].join("\n"),
        );
        const rulesyncPermissions = new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { read: { "src/**": "allow" } },
          }),
        });

        const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions,
          logger,
        });

        const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
        expect(parsed.approval_policy).toBe("on-request");
        expect(parsed.approvals_reviewer).toBe("user");
        const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
        expect(
          warnMessages.some(
            (line) =>
              line.includes('existing Codex CLI config.toml sets approval_policy = "untrusted"') &&
              line.includes('replaced with "on-request"'),
          ),
        ).toBe(true);
      });

      it("lets an authored approval_policy override a leftover untrusted value", async () => {
        const logger = createMockLogger();
        const codexDir = join(testDir, ".codex");
        await ensureDir(codexDir);
        await writeFileContent(join(codexDir, "config.toml"), 'approval_policy = "untrusted"\n');
        const rulesyncPermissions = new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { read: { "src/**": "allow" } },
            codexcli: { approval_policy: "never" },
          }),
        });

        const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions,
          logger,
        });

        const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
        expect(parsed.approval_policy).toBe("never");
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("does not import the retired value and warns with the migration path", () => {
        const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
        const codexPermissions = new CodexcliPermissions({
          outputRoot: testDir,
          relativeDirPath: ".codex",
          relativeFilePath: "config.toml",
          fileContent: [
            'approval_policy = "untrusted"',
            'approvals_reviewer = "user"',
            'default_permissions = "rulesync"',
            "[permissions.rulesync.filesystem]",
            '"src/**" = "read"',
          ].join("\n"),
        });

        const json = codexPermissions.toRulesyncPermissions().getJson();
        expect(json.codexcli?.approval_policy).toBeUndefined();
        expect(json.codexcli?.approvals_reviewer).toBe("user");
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]?.[0]);
        expect(message).toContain(join(".codex", "config.toml"));
        expect(message).toContain('approval_policy = "untrusted"');
        expect(message).toContain("retired in Codex 0.149.0");
        expect(message).toContain('trust_level = "untrusted"');
      });

      it("still imports the other approval_policy values without a warning", () => {
        const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
        for (const value of ["on-request", "on-failure", "never"]) {
          const codexPermissions = new CodexcliPermissions({
            outputRoot: testDir,
            relativeDirPath: ".codex",
            relativeFilePath: "config.toml",
            fileContent: `approval_policy = "${value}"\n`,
          });
          expect(codexPermissions.toRulesyncPermissions().getJson().codexcli?.approval_policy).toBe(
            value,
          );
        }
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it("warns that approval_policy = on-failure is deprecated but still writes it", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: { approval_policy: "on-failure" },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // Codex still reads the alias, so the authored value round-trips.
      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("on-failure");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('"approval_policy": "on-failure" is deprecated'),
      );
    });

    it("does not warn about approval_policy for the supported values", async () => {
      for (const value of ["on-request", "never"]) {
        const logger = createMockLogger();
        const rulesyncPermissions = new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { read: { "src/**": "allow" } },
            codexcli: { approval_policy: value },
          }),
        });

        await CodexcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions,
          logger,
        });

        const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
        expect(warnMessages.some((line) => line.includes("approval_policy"))).toBe(false);
      }
    });

    it("warns that sandbox_mode / sandbox_workspace_write are deprecated", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: {
            sandbox_mode: "workspace-write",
            sandbox_workspace_write: { network_access: true },
          },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // Deprecated keys still emit so existing configs keep working.
      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.sandbox_mode).toBe("workspace-write");
      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(
        warnMessages.some(
          (line) =>
            line.includes('"sandbox_mode" is deprecated') &&
            line.includes("base_permission_profile"),
        ),
      ).toBe(true);
      expect(
        warnMessages.some((line) => line.includes('"sandbox_workspace_write" is deprecated')),
      ).toBe(true);
    });

    it("warns when regeneration introduces the extends baseline into an existing profile without extends", async () => {
      const logger = createMockLogger();
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      // Older rulesync versions (and hand-written profiles) emitted no
      // `extends`; introducing the `:workspace` baseline broadens the
      // profile's grants and must not happen silently.
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync.filesystem]",
          '"src/**" = "read"',
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "src/**": "allow" } } }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      expect(codexPermissions.getFileContent()).toContain('extends = ":workspace"');
      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(
        warnMessages.some(
          (line) =>
            line.includes('Existing "extends" value "(none)"') && line.includes(":workspace"),
        ),
      ).toBe(true);
    });

    it("does not warn about unmanaged keys when only base_permission_profile is set", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "src/**": "allow" } },
          codexcli: { base_permission_profile: ":read-only" },
        }),
      });

      await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.some((line) => line.includes("not managed"))).toBe(false);
    });

    it("round-trips base_permission_profile = ':read-only' through import and regeneration", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":read-only"',
          "[permissions.rulesync.filesystem]",
          '"/workspace/project/**" = "read"',
        ].join("\n"),
      );

      const imported = await CodexcliPermissions.fromFile({ outputRoot: testDir });
      const rulesyncPermissions = imported.toRulesyncPermissions();
      expect(rulesyncPermissions.getJson().codexcli?.base_permission_profile).toBe(":read-only");

      const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: rulesyncPermissions.getFileContent(),
        }),
      });

      const fileContent = regenerated.getFileContent();
      expect(fileContent).toContain('extends = ":read-only"');
      expect(fileContent).toContain('"/workspace/project/**" = "read"');
    });
  });

  describe("default .git write carve-out (git_write_rules)", () => {
    it("emits '.git/**' = 'write' by default", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: {} }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const workspaceRoots = parseWorkspaceRoots(codexPermissions.getFileContent());
      expect(workspaceRoots[".git/**"]).toBe("write");
      // No `.git/config` read guard: everyday git commands (git remote add,
      // git push -u, local-scope git config) must write to it (#2279).
      expect(workspaceRoots[".git/config"]).toBeUndefined();
      // `.git/**` contains a multi-level glob, so the depth bound is emitted.
      expect(codexPermissions.getFileContent()).toContain("glob_scan_max_depth = 8");
    });

    it("lets a user-specified rule win over the default for the same key", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            read: { ".git/**": "deny", ".git/config": "allow" },
            write: { ".git/config": "allow" },
          },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const workspaceRoots = parseWorkspaceRoots(codexPermissions.getFileContent());
      expect(workspaceRoots[".git/**"]).toBe("deny");
      expect(workspaceRoots[".git/config"]).toBe("write");
    });

    it("suppresses the carve-out when codexcli.git_write_rules is false", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          codexcli: { git_write_rules: false },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const fileContent = codexPermissions.getFileContent();
      expect(fileContent).not.toContain(".git/**");
      expect(fileContent).not.toContain(".git/config");
      expect(fileContent).not.toContain(":workspace_roots");
    });

    it("skips the carve-out when base_permission_profile is ':read-only'", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          codexcli: { base_permission_profile: ":read-only" },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const fileContent = codexPermissions.getFileContent();
      expect(fileContent).toContain('extends = ":read-only"');
      expect(fileContent).not.toContain(".git/**");
      expect(fileContent).not.toContain(":workspace_roots");
    });

    it("does not override a direct ':workspace_roots' string rule with the carve-out", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            read: { ":workspace_roots": "deny" },
          },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as ParsedToml;
      expect(parsed.permissions?.rulesync?.filesystem?.[":workspace_roots"]).toBe("deny");
      expect(codexPermissions.getFileContent()).not.toContain(".git/**");
    });

    it("does not write git_write_rules as a top-level config.toml key", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          codexcli: { git_write_rules: true },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      expect(codexPermissions.getFileContent()).not.toContain("git_write_rules");
    });

    it("does not import the default-valued carve-out into the rulesync model", () => {
      const codexPermissions = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem.":workspace_roots"]
".git/**" = "write"
".git/config" = "read"
"src/**" = "read"
`,
      });

      const json = codexPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.read?.[".git/**"]).toBeUndefined();
      expect(json.permission.edit?.[".git/**"]).toBeUndefined();
      // `".git/config" = "read"` is no longer a default (#2279), so a config
      // that still carries it (e.g. generated by an older rulesync) imports
      // it as a user-authored rule.
      expect(json.permission.read?.[".git/config"]).toBe("allow");
      expect(json.permission.read?.["src/**"]).toBe("allow");
    });

    it("imports customized .git values that differ from the defaults", () => {
      const codexPermissions = new CodexcliPermissions({
        outputRoot: testDir,
        relativeDirPath: ".codex",
        relativeFilePath: "config.toml",
        fileContent: `
default_permissions = "rulesync"

[permissions.rulesync.filesystem.":workspace_roots"]
".git/**" = "deny"
".git/config" = "write"
`,
      });

      const json = codexPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.read?.[".git/**"]).toBe("deny");
      expect(json.permission.edit?.[".git/**"]).toBe("deny");
      expect(json.permission.edit?.[".git/config"]).toBe("allow");
    });

    it("round-trips through import and regeneration without duplicating the carve-out", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":workspace"',
          '[permissions.rulesync.filesystem.":workspace_roots"]',
          '".git/**" = "write"',
        ].join("\n"),
      );

      const imported = await CodexcliPermissions.fromFile({ outputRoot: testDir });
      const rulesyncPermissions = imported.toRulesyncPermissions();

      const regenerated = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: rulesyncPermissions.getFileContent(),
        }),
      });

      const workspaceRoots = parseWorkspaceRoots(regenerated.getFileContent());
      expect(workspaceRoots).toEqual({ ".git/**": "write" });
    });
  });

  describe("user-authored network keys survive regeneration", () => {
    it("preserves dangerously_allow_all_unix_sockets and enabled when rulesync emits no network", async () => {
      const logger = createMockLogger();
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":workspace"',
          "[permissions.rulesync.network]",
          "enabled = true",
          "dangerously_allow_all_unix_sockets = true",
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: {} }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, any>;
      const network = parsed.permissions?.rulesync?.network ?? {};
      expect(network.enabled).toBe(true);
      expect(network.dangerously_allow_all_unix_sockets).toBe(true);
      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.some((line) => line.includes('"network.enabled"'))).toBe(true);
      expect(warnMessages.some((line) => line.includes("dangerously_allow_all_unix_sockets"))).toBe(
        true,
      );
    });

    it("does not preserve a stale rulesync-managed enabled when allow domains are removed", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      // The existing profile is rulesync's own prior output: `enabled = true`
      // was derived from a webfetch allow rule the user has since removed.
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":workspace"',
          "[permissions.rulesync.network]",
          "enabled = true",
          "[permissions.rulesync.network.domains]",
          '"github.com" = "allow"',
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: {} }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      // Keeping `enabled = true` without the domains would broaden the scoped
      // grant into unrestricted network access; it must fall back to Codex's
      // restricted default instead.
      const parsed = smolToml.parse(codexPermissions.getFileContent()) as ParsedToml;
      expect(parsed.permissions?.rulesync?.network).toBeUndefined();
    });

    it("warns when a user-authored enabled = false is replaced by a managed enabled = true", async () => {
      const logger = createMockLogger();
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":workspace"',
          "[permissions.rulesync.network]",
          "enabled = false",
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { webfetch: { "github.com": "allow" } },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as ParsedToml;
      expect(parsed.permissions?.rulesync?.network?.enabled).toBe(true);
      const warnMessages = logger.warn.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.some((line) => line.includes('"network.enabled = false"'))).toBe(true);
    });

    it("preserves a user-authored enabled = true alongside deny-only managed domains", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        [
          'default_permissions = "rulesync"',
          "[permissions.rulesync]",
          'extends = ":workspace"',
          "[permissions.rulesync.network]",
          "enabled = true",
        ].join("\n"),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { webfetch: { "example.com": "deny" } },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, any>;
      const network = parsed.permissions?.rulesync?.network ?? {};
      expect(network.enabled).toBe(true);
      expect(network.domains?.["example.com"]).toBe("deny");
    });
  });
});
