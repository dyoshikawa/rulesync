import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CodexcliPermissions, createCodexcliBashRulesFile } from "./codexcli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

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
    expect(fileContent).not.toContain('extends = ":workspace"');
    expect(fileContent).toContain('"api.example.com" = "allow"');
  });

  it("should emit extends = ':workspace' when a workspace-wide edit rule is present", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { ".": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).toContain('extends = ":workspace"');
    expect(fileContent).toContain('"." = "write"');
  });

  it("should not emit extends for narrowly scoped edit rules", async () => {
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
    expect(fileContent).not.toContain('extends = ":workspace"');
    expect(fileContent).toContain('"src/**" = "write"');
  });

  it("should not emit extends for workspace-external write rules", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "~/notes/**": "allow" },
        },
      }),
    });

    const codexPermissions = await CodexcliPermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const fileContent = codexPermissions.getFileContent();
    expect(fileContent).not.toContain('extends = ":workspace"');
    expect(fileContent).toContain('"~/notes/**" = "write"');
  });

  it("should import extends = ':workspace' as a workspace-wide edit rule", () => {
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
    expect(json.permission.edit?.["."]).toBe("allow");
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
    expect(fileContent).toContain('"." = "write"');
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

  it("should not emit extends when only deny edit rules are present", async () => {
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
    expect(fileContent).not.toContain('extends = ":workspace"');
  });

  it("should emit network.enabled only via wildcard allow without a domains entry", async () => {
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
    expect(fileContent).not.toContain('"*"');
    expect(fileContent).not.toContain("[permissions.rulesync.network.domains]");
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
});
