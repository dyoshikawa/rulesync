import { describe, expect, it } from "vitest";

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
            "*": "ask",
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

    expect(imported.permission).toEqual({
      bash: {
        "git *": "allow",
        "confirm *": "ask",
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
