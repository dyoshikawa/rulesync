import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

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

  it("keeps other tools' override blocks, and the credentials they carry, out of the round-trip blob", async () => {
    // `rulesync import --targets claudecode` passes `.claude/settings.json`
    // through under `claudecode`, `env` credentials included.
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
        claudecode: { env: { DEMO_API_KEY: "sk-test-not-a-real-key" } },
        codexcli: { approval_policy: "on-request" },
        hermes: { approvals: { mode: "manual" } },
      }),
    });

    const permissions = await HermesagentPermissions.fromRulesyncPermissions({
      outputRoot: ".",
      rulesyncPermissions,
    });

    expect(permissions.getFileContent()).not.toContain("sk-test-not-a-real-key");
    const config = parseSharedConfig({ format: "yaml", fileContent: permissions.getFileContent() });
    expect(config.permissions).toEqual({
      rulesync: {
        permission: { bash: { "git *": "allow" } },
        hermes: { approvals: { mode: "manual" } },
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

  it.each([
    {
      label: "a catch-all ask",
      canonical: { permission: { "*": { "*": "ask" }, bash: { "git *": "allow" } } },
      allowlist: undefined,
    },
    {
      label: "an all-tools deny",
      canonical: {
        permission: {
          "*": { "npm *": "deny" },
          bash: { "npm publish": "allow", "git *": "allow" },
        },
      },
      allowlist: ["git *"],
    },
    {
      label: "a narrower bash ask",
      canonical: { permission: { bash: { "git *": "allow", "git push *": "ask" } } },
      allowlist: undefined,
    },
  ])(
    "keeps a bash allow withheld by $label through a round-trip",
    async ({ canonical, allowlist }) => {
      const generated = await HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify(canonical),
        }),
        logger: createMockLogger(),
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(allowlist);
      // The allowlist never carried the withheld allow, so its absence there is
      // not a retraction: import must keep the rule as provenance wrote it.
      expect(generated.toRulesyncPermissions().getJson()).toEqual(canonical);
    },
  );

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

  describe("MCP trust-gate grants (mcp:<server>/<tool>)", () => {
    const toRulesync = (permission: Record<string, unknown>) =>
      new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission }),
      });

    it("writes a '*' allow on mcp__<server>__<tool> as an mcp:<server>/<tool> grant", () => {
      const logger = createMockLogger();
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          bash: { "git status": "allow" },
          mcp__notes__write_note: { "*": "allow" },
          mcp__github__create_pull_request: { "*": "allow" },
        }),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual([
        "git status",
        "mcp:notes/write_note",
        "mcp:github/create_pull_request",
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips with a warning the MCP allows Hermes cannot grant tool by tool", () => {
      const logger = createMockLogger();
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          mcp: { "*": "allow" },
          mcp__notes: { "*": "allow" },
          "mcp__notes__*": { "*": "allow" },
          mcp__github__get_issue: { "owner:me": "allow" },
        }),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "the MCP allow rule(s) mcp: *, mcp__notes: *, mcp__notes__*: *, mcp__github__get_issue: owner:me were skipped",
        ),
      );
    });

    it.each([
      { label: "an all-tools catch-all ask", restriction: { "*": { "*": "ask" } } },
      { label: "an every-MCP deny", restriction: { mcp: { "*": "deny" } } },
      { label: "a whole-server deny", restriction: { mcp__notes: { "*": "deny" } } },
    ])("withholds an MCP grant that $label covers", ({ restriction }) => {
      const logger = createMockLogger();
      const canonical = { ...restriction, mcp__notes__write_note: { "*": "allow" } };
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync(canonical),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the MCP allow rule(s) for mcp__notes__write_note"),
      );
      // The grant was never written, so import must not read its absence as a retraction.
      expect(generated.toRulesyncPermissions().getJson()).toEqual({ permission: canonical });
    });

    it("imports mcp: grants as canonical MCP allows, never as bash commands", () => {
      const imported = new HermesagentPermissions({
        outputRoot: ".",
        fileContent: JSON.stringify({
          command_allowlist: [
            "git status",
            "mcp:notes/write_note",
            "mcp:github/create_pull_request",
            // No canonical spelling: a `__` server name and a literal `*` tool name.
            "mcp:my__server/tool",
            "mcp:notes/*",
          ],
        }),
      })
        .toRulesyncPermissions()
        .getJson();

      expect(imported.permission).toEqual({
        bash: { "git status": "allow" },
        mcp__notes__write_note: { "*": "allow" },
        mcp__github__create_pull_request: { "*": "allow" },
      });
    });

    it("lets the native grants retract a stale single-tool MCP allow, keeping the rest", () => {
      const imported = new HermesagentPermissions({
        outputRoot: ".",
        fileContent: JSON.stringify({
          command_allowlist: ["mcp:notes/write_note"],
          permissions: {
            rulesync: {
              permission: {
                mcp__notes__write_note: { "*": "allow" },
                mcp__notes__delete_note: { "*": "allow" },
                mcp__github: { "*": "allow" },
                mcp__docs__search: { "*": "deny" },
              },
            },
          },
        }),
      })
        .toRulesyncPermissions()
        .getJson();

      expect(imported.permission).toEqual({
        mcp__notes__write_note: { "*": "allow" },
        mcp__github: { "*": "allow" },
        mcp__docs__search: { "*": "deny" },
      });
    });

    it("keeps the grants Hermes persisted when generation rewrites command_allowlist", () => {
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          bash: { "git status": "allow", "npm test": "allow" },
          mcp__github__create_pull_request: { "*": "allow" },
        }),
      });

      generated.setFileContent(`command_allowlist:
  - git status
  - old-command
  - mcp:notes/write_note
  - mcp:github/create_pull_request
  - mcp:my__server/tool
  - mcp:stale/tool
permissions:
  rulesync:
    permission:
      bash:
        old-command: allow
      mcp__stale__tool:
        "*": allow
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      // A user's "Always" grants rulesync never managed survive; the shell
      // entries and the grant rulesync wrote from a now-removed rule do not.
      expect(config.command_allowlist).toEqual([
        "git status",
        "npm test",
        "mcp:github/create_pull_request",
        "mcp:notes/write_note",
        "mcp:my__server/tool",
      ]);
    });

    it("drops a persisted grant the canonical block now restricts", () => {
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          bash: { "git status": "allow" },
          mcp__notes__write_note: { "*": "deny" },
        }),
        logger: createMockLogger(),
      });

      generated.setFileContent(`command_allowlist:
  - mcp:notes/write_note
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(["git status"]);
    });

    it("skips a bash allow spelled as an MCP grant, so no MCP deny is bypassed", () => {
      const logger = createMockLogger();
      const canonical = {
        bash: { "git status": "allow", "mcp:notes/delete": "allow" },
        mcp__notes: { "*": "deny" },
      };
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync(canonical),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(["git status"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("the bash allow rule(s) mcp:notes/delete were skipped"),
      );
      // Never written, so a re-import keeps it where it was instead of turning
      // it into an MCP grant.
      expect(generated.toRulesyncPermissions().getJson()).toEqual({ permission: canonical });
    });

    it.each([
      { label: "an every-MCP glob deny", restriction: { "mcp__*": { "*": "deny" } } },
      { label: "a server-tools glob deny", restriction: { "mcp__notes__*": { "*": "deny" } } },
      { label: "a tool-name glob ask", restriction: { "mcp__*__write_note": { "*": "ask" } } },
      { label: "a bare-mcp pattern deny", restriction: { mcp: { "notes__*": "deny" } } },
      { label: "a pattern-scoped server ask", restriction: { mcp__notes: { "rm*": "ask" } } },
    ])("withholds an MCP grant that $label covers", ({ restriction }) => {
      const logger = createMockLogger();
      const canonical = { ...restriction, mcp__notes__write_note: { "*": "allow" } };
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync(canonical),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the MCP allow rule(s) for mcp__notes__write_note"),
      );
      expect(generated.toRulesyncPermissions().getJson()).toEqual({ permission: canonical });
    });

    it("withholds an MCP grant whose own category has a scoped deny or ask", () => {
      const logger = createMockLogger();
      const canonical = { mcp__notes__write_note: { "*": "allow", "path:/etc/*": "ask" } };
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync(canonical),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      // Hermes's grant would approve every call, including the ones the ask covers.
      expect(config.command_allowlist).toBeUndefined();
      expect(generated.toRulesyncPermissions().getJson()).toEqual({ permission: canonical });
    });

    it("does not withhold an MCP grant for a restriction on another server or tool", () => {
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          mcp__github: { "*": "deny" },
          mcp__notes__delete_note: { "*": "deny" },
          "mcp__*__delete_repo": { "*": "deny" },
          mcp__notes__write_note: { "*": "allow" },
        }),
        logger: createMockLogger(),
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(["mcp:notes/write_note"]);
    });

    it.each(["deny", "ask"] as const)(
      "keeps a canonical %s over a native grant for the same tool on import",
      (action) => {
        const logger = createMockLogger();
        const imported = new HermesagentPermissions({
          outputRoot: ".",
          fileContent: JSON.stringify({
            command_allowlist: ["mcp:notes/write_note"],
            permissions: {
              rulesync: { permission: { mcp__notes__write_note: { "*": action } } },
            },
          }),
        })
          .toRulesyncPermissions({ logger })
          .getJson();

        expect(imported.permission).toEqual({ mcp__notes__write_note: { "*": action } });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            "grants mcp:notes/write_note, but the permissions.rulesync block",
          ),
        );
      },
    );

    it("drops a persisted grant a broader canonical rule now restricts", () => {
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          bash: { "git status": "allow" },
          mcp__notes: { "*": "deny" },
          "mcp__*__delete_repo": { "*": "ask" },
        }),
        logger: createMockLogger(),
      });

      generated.setFileContent(`command_allowlist:
  - mcp:notes/write_note
  - mcp:github/delete_repo
  - mcp:github/get_issue
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(["git status", "mcp:github/get_issue"]);
    });

    it("does not write a server name containing '/', which would read back as another server", () => {
      const logger = createMockLogger();
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({ "mcp__a/b__tool": { "*": "allow" } }),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("the MCP allow rule(s) mcp__a/b__tool: * were skipped"),
      );
    });
    it("withholds an MCP grant beside a narrower all-tools deny, naming the rule", () => {
      const logger = createMockLogger();
      const canonical = {
        "*": { "secret*": "deny" },
        bash: { "git status": "allow" },
        mcp__fs__read_file: { "*": "allow" },
      };
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync(canonical),
        logger,
      });

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      // A rule under `*` applies to every tool, and the grant would approve
      // every call of read_file, the denied ones included. The bash allow is
      // not covered by `secret*` and stays.
      expect(config.command_allowlist).toEqual(["git status"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "the MCP allow rule(s) for mcp__fs__read_file (covered by *: secret* (deny))",
        ),
      );
      expect(generated.toRulesyncPermissions().getJson()).toEqual({ permission: canonical });
    });

    it("drops a persisted grant beside a narrower all-tools ask", () => {
      const generated = HermesagentPermissions.fromRulesyncPermissions({
        outputRoot: ".",
        rulesyncPermissions: toRulesync({
          "*": { "rm *": "ask" },
          bash: { "git status": "allow" },
        }),
        logger: createMockLogger(),
      });

      generated.setFileContent(`command_allowlist:
  - mcp:notes/write_note
`);

      const config = parseSharedConfig({ format: "yaml", fileContent: generated.getFileContent() });
      expect(config.command_allowlist).toEqual(["git status"]);
    });
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
