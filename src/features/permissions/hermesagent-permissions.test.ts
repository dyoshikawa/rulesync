import { describe, expect, it } from "vitest";

import { parseHermesConfig } from "../hermes-config.js";
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

    const config = parseHermesConfig(permissions.getFileContent());
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

    const config = parseHermesConfig(permissions.getFileContent());
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

    const config = parseHermesConfig(permissions.getFileContent());
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

    const config = parseHermesConfig(permissions.getFileContent());
    expect(config.security).toEqual({
      website_blocklist: { domains: ["evil.example.com", "tracker.example.net"] },
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

    const config = parseHermesConfig(permissions.getFileContent());
    // The override's `approvals.mode` coexists with the deny-derived `approvals.deny`.
    expect(config.approvals).toEqual({ deny: ["rm -rf *"], mode: "smart" });
    expect(config.security).toEqual({ allow_private_urls: false });
    expect(config.skills).toEqual({ write_approval: true });
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
