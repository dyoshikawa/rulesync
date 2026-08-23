import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
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
            // read allow + write ask → "read" (ask maps to the deny side).
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
    expect(fileContent).toContain('"/data/mixed/**" = "deny"');
    expect(fileContent).toContain('"/data/open/**" = "write"');
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

  it("should not set glob_scan_max_depth when workspace-root globs contain only single-level wildcards", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: {
            "src/*": "allow",
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
    expect(fileContent).toContain('[permissions.rulesync.filesystem.":workspace_roots"]');
    expect(fileContent).toContain('"src/*" = "read"');
    expect(fileContent).toContain('"docs/*" = "write"');
    expect(fileContent).not.toContain("glob_scan_max_depth");
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
        { approval_policy: "untrusted" },
        { approval_policy: "on-request" },
        // `on-failure` is a legacy alias Codex still accepts for `on-request`.
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
          codexcli: { approval_policy: "untrusted", approvals_reviewer: "user" },
        }),
      });

      const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const parsed = smolToml.parse(codexPermissions.getFileContent()) as Record<string, unknown>;
      expect(parsed.approval_policy).toBe("untrusted");
      expect(parsed.approvals_reviewer).toBe("user");
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
            read: { ".git/**": "deny" },
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
