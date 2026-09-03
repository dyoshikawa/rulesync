import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { parseSharedConfig } from "../shared/shared-config-gateway.js";
import { HermesagentPermissions } from "./hermesagent-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("HermesagentPermissions", () => {
  it("keeps allowed command patterns in command_allowlist", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "git *": "allow",
            "pnpm *": "allow",
            "rm *": "deny",
            "npm publish": "ask",
          },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.command_allowlist).toEqual(["git *", "pnpm *"]);
  });

  it("feeds command_allowlist from the bash category only", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          "*": { "*": "allow" },
          bash: { "git *": "allow" },
          read: { "secrets/**": "allow" },
          edit: { "src/**": "allow" },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
      logger,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    // A `read` or `edit` allow names a path, and an all-tools `*` allow need not
    // name a command either, so none of them may auto-approve a command.
    expect(config.command_allowlist).toEqual(["git *"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("reads the all-tools '*' category for its deny and ask rules only"),
    );
  });

  it("withholds a bash allow that an all-tools deny covers, without writing the deny", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          "*": { "npm *": "deny" },
          bash: { "npm publish": "allow", "git *": "allow", "rm -rf *": "deny" },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
      logger,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    // The stricter rule wins whatever its width: the file denies `npm *` for
    // every tool, so `npm publish` must not be auto-approved. The `*` deny
    // itself stays out of approvals.deny, which carries `bash` denies only.
    expect(config.command_allowlist).toEqual(["git *"]);
    expect(config.approvals).toEqual({ deny: ["rm -rf *"] });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("was not given the allow rule(s) for npm publish"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("did not write the all-tools '*' deny rule(s) for npm *"),
    );
  });

  it("withholds every allow a catch-all ask covers, since Hermes has no ask tier", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          "*": { "*": "ask" },
          bash: { "git *": "allow", "pnpm *": "allow" },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
      logger,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.command_allowlist).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("was not given the allow rule(s) for git *, pnpm *"),
    );
  });

  it("reports the restrictions Hermes cannot express, and only those", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          read: { "secrets/**": "deny" },
          webfetch: { "evil.example.com": "deny", "confirm.example.com": "ask" },
          websearch: { "*": "allow" },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
      logger,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.command_allowlist).toEqual(["git *"]);
    expect(config.security).toEqual({
      website_blocklist: { enabled: true, domains: ["evil.example.com"] },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("no per-pattern primitive for 'read' deny and ask rules"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("security.website_blocklist has no ask tier"),
    );
    // A `webfetch` deny is enforced through the blocklist, and an allow in a
    // category Hermes cannot express restricts nothing, so neither is reported.
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("'webfetch' deny"));
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("'websearch'"));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("preserves existing Hermes config when writing permissions", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "git *": "allow",
          },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    permissions.setFileContent(`model: hermes-3
mcp_servers:
  docs:
    url: https://example.com/mcp
`);

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.model).toBe("hermes-3");
    expect(config.mcp_servers).toEqual({
      docs: { url: "https://example.com/mcp" },
    });
    expect(config.command_allowlist).toEqual(["git *"]);
    expect(config.permissions).toEqual({
      rulesync: {
        permission: {
          bash: {
            "git *": "allow",
          },
        },
      },
    });
  });

  it("preserves hand-edited sibling keys under approvals/security on merge", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "rm -rf *": "deny" },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    // Existing file carries a hand-edited approvals.mode and security setting.
    permissions.setFileContent(`approvals:
  mode: smart
security:
  allow_private_urls: false
`);

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    // The generated approvals.deny and the hand-edited approvals.mode coexist.
    expect(config.approvals).toEqual({ mode: "smart", deny: ["rm -rf *"] });
    expect(config.security).toEqual({ allow_private_urls: false });
  });

  it("replaces the round-trip blob wholesale so deleted rules do not resurrect", async () => {
    // Canonical no longer contains "old-cmd"; only "git *" remains.
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    // Existing config.yaml still carries a stale "old-cmd" entry in the blob.
    permissions.setFileContent(`permissions:
  rulesync:
    permission:
      bash:
        "git *": allow
        "old-cmd": deny
`);

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.permissions).toEqual({
      rulesync: { permission: { bash: { "git *": "allow" } } },
    });
  });

  it("maps bash deny rules to approvals.deny (hard denylist)", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "git *": "allow",
            "rm -rf *": "deny",
            "curl *": "deny",
          },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.approvals).toEqual({ deny: ["rm -rf *", "curl *"] });
    expect(config.command_allowlist).toEqual(["git *"]);
  });

  it("maps webfetch deny rules to security.website_blocklist.domains", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: {
            "evil.example.com": "deny",
            "tracker.example.net": "deny",
          },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.security).toEqual({
      website_blocklist: { enabled: true, domains: ["evil.example.com", "tracker.example.net"] },
    });
  });

  it("deep-merges the hermes override with natively emitted structures", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "rm -rf *": "deny" },
        },
        hermes: {
          approvals: { mode: "smart" },
          security: { allow_private_urls: false },
          skills: { write_approval: true },
        },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    // The override's `approvals.mode` coexists with the deny-derived `approvals.deny`.
    expect(config.approvals).toEqual({ deny: ["rm -rf *"], mode: "smart" });
    expect(config.security).toEqual({ allow_private_urls: false });
    expect(config.skills).toEqual({ write_approval: true });
  });

  it("imports native Hermes permissions without a private round-trip blob", () => {
    const imported = new HermesagentPermissions({
      outputRoot: ".",
      fileContent: JSON.stringify({
        model: "unrelated",
        command_allowlist: ["git *", "pnpm *"],
        approvals: { deny: ["rm -rf *"], mode: "smart", timeout: 30 },
        security: {
          allow_private_urls: false,
          website_blocklist: { enabled: true, domains: ["evil.example.com"] },
        },
        skills: { write_approval: true },
        memory: { write_approval: false },
      }),
    })
      .toRulesyncPermissions()
      .getJson();

    expect(imported).toEqual({
      permission: {
        bash: {
          "git *": "allow",
          "pnpm *": "allow",
          "rm -rf *": "deny",
        },
        webfetch: { "evil.example.com": "deny" },
      },
      hermes: {
        approvals: { mode: "smart", timeout: 30 },
        security: { allow_private_urls: false },
        skills: { write_approval: true },
        memory: { write_approval: false },
      },
    });
  });

  it("keeps the rest of a hand-edited provenance block when one of its keys is blank", () => {
    // A blank category or pattern would fail the schema, and a failed parse
    // falls back to an empty permission block — every recorded rule gone
    // without a word. Filtering first keeps the loss to the blank key itself.
    const imported = new HermesagentPermissions({
      outputRoot: ".",
      fileContent: JSON.stringify({
        command_allowlist: [],
        permissions: {
          rulesync: {
            permission: {
              "  ": { "git *": "ask" },
              read: { "  ": "ask", "shared/*": "ask" },
            },
          },
        },
      }),
    })
      .toRulesyncPermissions()
      .getJson();

    expect(imported.permission).toEqual({ read: { "shared/*": "ask" } });
  });

  it("reconciles hand-edited native state over private provenance", () => {
    const imported = new HermesagentPermissions({
      outputRoot: ".",
      fileContent: JSON.stringify({
        command_allowlist: ["git *", "shared/*", "new-command *"],
        approvals: { deny: ["curl *"], mode: "manual" },
        security: {
          allow_private_urls: true,
          website_blocklist: {
            enabled: false,
            domains: ["informational.example.com"],
          },
        },
        skills: { write_approval: false },
        memory: { write_approval: true },
        permissions: {
          rulesync: {
            permission: {
              bash: {
                "git *": "allow",
                "old-command *": "allow",
                "rm -rf *": "deny",
                "confirm *": "ask",
              },
              read: { "shared/*": "allow" },
              webfetch: {
                "stale.example.com": "deny",
                "confirm.example.com": "ask",
              },
            },
            hermes: {
              approvals: { mode: "smart" },
              security: { allow_private_urls: false },
              skills: { write_approval: true },
              custom_policy: { keep: true },
            },
          },
        },
      }),
    })
      .toRulesyncPermissions()
      .getJson();

    // The allowlist is authoritative for the `bash` allow rules only: every
    // entry in it is a shell-command pattern, so a hand-added `shared/*` lands
    // under `bash`, while the `read` allow that shares its spelling is neither
    // confirmed nor retracted by a list that cannot carry it.
    expect(imported.permission).toEqual({
      bash: {
        "git *": "allow",
        "confirm *": "ask",
        "shared/*": "allow",
        "new-command *": "allow",
        "curl *": "deny",
      },
      read: { "shared/*": "allow" },
      webfetch: { "confirm.example.com": "ask" },
    });
    expect(imported.hermes).toEqual({
      approvals: { mode: "manual" },
      security: {
        allow_private_urls: true,
        website_blocklist: {
          enabled: false,
          domains: ["informational.example.com"],
        },
      },
      skills: { write_approval: false },
      memory: { write_approval: true },
      custom_policy: { keep: true },
    });
  });

  it("keeps a non-command allow through a round-trip even though the allowlist omits it", async () => {
    const canonical = {
      permission: {
        bash: { "git *": "allow" },
        read: { "docs/**": "allow" },
        edit: { "src/**": "allow", "secrets/**": "deny" },
      },
    };
    const generated = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions: new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(canonical),
      }),
    });

    const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
    expect(config.command_allowlist).toEqual(["git *"]);
    // Generation left the path allows out of the allowlist on purpose, so
    // import must not read their absence there as a retraction.
    expect(generated.toRulesyncPermissions().getJson()).toEqual(canonical);
  });

  it("round-trips deny, webfetch, and the hermes override back to canonical", () => {
    const canonical = {
      permission: {
        bash: { "git *": "allow", "rm -rf *": "deny" },
        webfetch: { "evil.example.com": "deny" },
      },
      hermes: {
        approvals: { mode: "smart" },
      },
    };

    const generated = HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions: new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(canonical),
      }),
    });

    const reimported = new HermesagentPermissions({
      outputRoot: ".",
      fileContent: generated.getFileContent(),
    });

    const roundTripped = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
    expect(roundTripped).toEqual(canonical);
  });
});

describe("HermesagentPermissions global settable paths", () => {
  // Pinned as literals rather than re-calling getHermesagentGlobalDir(), so the
  // platform branch itself is asserted and not merely restated.
  const expectedGlobalDir =
    process.platform === "win32" ? join("AppData", "Local", "hermes") : ".hermes";

  const originalHermesHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  it("anchors global paths on the platform profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    expect(HermesagentPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: expectedGlobalDir,
      relativeFilePath: "config.yaml",
    });
  });

  it("drops the .hermes prefix when HERMES_HOME names the profile root itself", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(HermesagentPermissions.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: ".",
      relativeFilePath: "config.yaml",
    });
  });
});
