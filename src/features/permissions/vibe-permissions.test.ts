import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { VibePermissions } from "./vibe-permissions.js";

describe("VibePermissions", () => {
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

  it("should export rulesync permissions to Vibe tools and preserve MCP config", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[[mcp_servers]]",
        'name = "fetch"',
        'transport = "http"',
        'url = "https://example.com/mcp"',
      ].join("\n"),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: {
            "*": "ask",
            "git status": "allow",
            "rm -rf *": "deny",
            "npm *": "ask",
          },
          read: { "*": "allow" },
          edit: { "*": "deny" },
        },
      }),
    });
    const logger = createMockLogger();

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.mcp_servers).toMatchObject([
      { name: "fetch", transport: "http", url: "https://example.com/mcp" },
    ]);
    expect(parsed.tools.bash.permission).toBe("ask");
    expect(parsed.tools.bash.allowlist).toEqual(["git status"]);
    expect(parsed.tools.bash.denylist).toEqual(["rm -rf *"]);
    expect(parsed.tools.read_file.permission).toBe("always");
    // The canonical `edit` category targets Vibe's `edit` tool, not `write_file`
    // (create-only since v2.14.0).
    expect(parsed.disabled_tools).toEqual(["edit"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pattern-level "ask" rules'));
  });

  it("should import Vibe tool filters and per-tool permissions", () => {
    const fileContent = [
      'enabled_tools = ["read_file"]',
      'disabled_tools = ["edit"]',
      "",
      "[tools.bash]",
      'permission = "ask"',
      'allow = ["git status"]',
      'deny = ["rm -rf *"]',
    ].join("\n");

    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent,
    });

    const parsed = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(parsed.permission).toEqual({
      edit: { "*": "deny" },
      bash: {
        "*": "ask",
        "git status": "allow",
        "rm -rf *": "deny",
      },
    });
    // `enabled_tools` is an exclusive allowlist, not a set of allow grants, so
    // it round-trips through the vibe override instead of `"*": "allow"`.
    expect(parsed.vibe.enabled_tools).toEqual(["read_file"]);
  });

  it("should author per-tool sensitive_patterns from the vibe override", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "*": "allow" } },
        vibe: { permission: { bash: { sensitive_patterns: ["sudo *", "rm *"] } } },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    // Base permission still ALWAYS, with an escalation list layered on top.
    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.bash.sensitive_patterns).toEqual(["rm *", "sudo *"]);
  });

  it("should route Vibe sensitive_patterns back into the vibe override on import", () => {
    const fileContent = [
      "[tools.bash]",
      'permission = "always"',
      'sensitive_patterns = ["sudo *", "rm *"]',
    ].join("\n");

    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent,
    });

    const json = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    expect(json.permission.bash).toEqual({ "*": "allow" });
    expect(json.vibe).toEqual({
      permission: { bash: { sensitive_patterns: ["sudo *", "rm *"] } },
    });
  });

  it("does not add an empty shared category for a sensitive_patterns-only tool", () => {
    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      // No permission/allow/deny — only sensitive_patterns.
      fileContent: '[tools.bash]\nsensitive_patterns = ["rm *"]\n',
    });

    const json = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    // The shared block must not carry an empty `bash: {}`.
    expect(json.permission.bash).toBeUndefined();
    expect(json.vibe).toEqual({ permission: { bash: { sensitive_patterns: ["rm *"] } } });
  });

  it("should not emit a vibe override when no sensitive_patterns are present", () => {
    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent: '[tools.bash]\npermission = "always"\n',
    });

    expect(
      JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent()).vibe,
    ).toBeUndefined();
  });

  it("clears an existing sensitive_patterns when the override lists an empty array", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      '[tools.bash]\npermission = "always"\nsensitive_patterns = ["rm *"]\n',
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { bash: { sensitive_patterns: [] } } },
        }),
      }),
    });

    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    expect(parsed.tools.bash.sensitive_patterns).toBeUndefined();
  });

  it("preserves an existing sensitive_patterns for a category not named in the override", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      '[tools.bash]\npermission = "always"\nsensitive_patterns = ["rm *"]\n',
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        // Only `read` is configured; `bash` is not named anywhere.
        fileContent: JSON.stringify({ permission: { read: { "*": "allow" } } }),
      }),
    });

    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    expect(parsed.tools.bash.sensitive_patterns).toEqual(["rm *"]);
  });

  it("should not be deletable because config.toml is shared", () => {
    const vibePermissions = VibePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    });

    expect(vibePermissions.isDeletable()).toBe(false);
  });

  it("should keep the edit and write categories on their own Vibe tools", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: {
            "*.md": "allow",
          },
          write: {
            "*.txt": "allow",
          },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // Vibe's `edit` and `write_file` are distinct tools, so the two canonical
    // categories must not collapse onto one allowlist.
    expect(parsed.tools.edit.allowlist).toEqual(["*.md"]);
    expect(parsed.tools.write_file.allowlist).toEqual(["*.txt"]);
  });

  it("should clear a stale disabled_tools entry when rulesync now allows the tool", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'disabled_tools = ["edit"]');

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "*": "allow" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // The stale deny filter must not survive the new "allow" source of truth,
    // and the allow must NOT be expressed through the exclusive `enabled_tools`
    // allowlist — `[tools.edit] permission = "always"` carries it completely.
    expect(parsed.disabled_tools).toBeUndefined();
    expect(parsed.enabled_tools).toBeUndefined();
    expect(parsed.tools.edit.permission).toBe("always");
  });

  it("should clear a stale enabled_tools entry when rulesync now denies the tool", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'enabled_tools = ["read_file"]');

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          read: { "*": "deny" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.enabled_tools).toBeUndefined();
    expect(parsed.disabled_tools).toEqual(["read_file"]);
  });

  it("should migrate legacy allow/deny keys to allowlist/denylist", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'permission = "ask"', 'allow = ["git status"]', 'deny = ["rm -rf *"]'].join(
        "\n",
      ),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git push": "allow" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // Legacy keys are dropped; the merged patterns land on the canonical keys.
    expect(parsed.tools.bash.allow).toBeUndefined();
    expect(parsed.tools.bash.deny).toBeUndefined();
    expect(parsed.tools.bash.allowlist).toEqual(["git push", "git status"]);
    expect(parsed.tools.bash.denylist).toEqual(["rm -rf *"]);
  });

  it("should import legacy allow/deny keys as a fallback", () => {
    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent: [
        "[tools.bash]",
        'allow = ["git status"]',
        "[tools.read_file]",
        'allowlist = ["src/**"]',
      ].join("\n"),
    });

    const parsed = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(parsed.permission.bash["git status"]).toBe("allow");
    expect(parsed.permission.read["src/**"]).toBe("allow");
  });

  it("should preserve enabled/disabled filters for tools rulesync does not configure", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['enabled_tools = ["custom_tool"]', 'disabled_tools = ["other_tool"]'].join("\n"),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          edit: { "*": "deny" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.enabled_tools).toEqual(["custom_tool"]);
    expect(parsed.disabled_tools).toEqual(["edit", "other_tool"]);
  });

  it("should map the agent category to Vibe's task tool in both directions", async () => {
    // Vibe's subagent tool is `task`; emitting `agent` left the deny inert,
    // so subagent spawning stayed enabled. Same rename OpenCode needed.
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { agent: { "*": "deny" } } }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["task"]);
    expect(parsed.tools.agent).toBeUndefined();

    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    expect(imported.permission.agent["*"]).toBe("deny");
  });

  it("should skip categories without a Vibe tool instead of emitting inert tables", async () => {
    const logger = createMockLogger();
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
          glob: { "*": "deny" },
          notebookedit: { "*.ipynb": "deny" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // A deny on a tool Vibe does not have would look applied while being
    // silently inert — skip it loudly instead.
    expect(parsed.tools.glob).toBeUndefined();
    expect(parsed.tools.notebookedit).toBeUndefined();
    expect(parsed.disabled_tools).toBeUndefined();
    expect(parsed.tools.bash.allowlist).toEqual(["git *"]);
    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("no builtin tool for the 'glob' category"),
      ),
    ).toBe(true);
    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("'notebookedit'")),
    ).toBe(true);
  });

  it("should emit [tools.grep] for the grep category (a real Vibe builtin)", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { grep: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.grep.permission).toBe("never");
    expect(parsed.disabled_tools).toEqual(["grep"]);
  });

  it("should fan the bash category out to the Windows managed shells", async () => {
    // The POSIX managed shell publishes `bash`, but on Windows the managed
    // shell is `git_bash` or `powershell` — a deny landing only on
    // [tools.bash] leaves the shell fully allowed there.
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "deny", "rm -rf *": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    for (const toolName of ["bash", "git_bash", "powershell"]) {
      expect(parsed.tools[toolName].permission).toBe("never");
      expect(parsed.tools[toolName].denylist).toEqual(["rm -rf *"]);
    }
    expect(parsed.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
  });

  it("should let an explicitly authored shell name win over the bash fan-out", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" }, powershell: { "*": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.git_bash.permission).toBe("always");
    expect(parsed.tools.powershell.permission).toBe("never");
    expect(parsed.disabled_tools).toEqual(["powershell"]);
  });

  it("should fan the bash sensitive_patterns override out to the Windows managed shells", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { bash: { sensitive_patterns: ["git push *"] } } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    for (const toolName of ["bash", "git_bash", "powershell"]) {
      expect(parsed.tools[toolName].sensitive_patterns).toEqual(["git push *"]);
    }
  });

  it("should emit a [tools.<name>] table for an MCP tool name", async () => {
    // MCP tools publish as `<server>_<tool>` and Vibe resolves their config by
    // tool name, so a non-canonical category is a reachable table, not a typo.
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { github_create_issue: { "*": "ask", "owner/repo*": "allow" } },
          vibe: { permission: { github_create_issue: { sensitive_patterns: ["delete*"] } } },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.github_create_issue.permission).toBe("ask");
    expect(parsed.tools.github_create_issue.allowlist).toEqual(["owner/repo*"]);
    expect(parsed.tools.github_create_issue.sensitive_patterns).toEqual(["delete*"]);
    expect(logger.warn).not.toHaveBeenCalled();

    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    expect(imported.permission.github_create_issue["*"]).toBe("ask");
    expect(imported.vibe.permission.github_create_issue.sensitive_patterns).toEqual(["delete*"]);
  });

  it("should skip the all-tools '*' category, which Vibe's per-tool config cannot express", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { "*": { "*": "deny" } } }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools?.["*"]).toBeUndefined();
    expect(parsed.disabled_tools).toBeUndefined();
    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("no builtin tool for the '*' category"),
      ),
    ).toBe(true);
  });

  it("should collapse fanned-out shell tables back into bash on import", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'permission = "never"',
        "[tools.git_bash]",
        'permission = "never"',
        "[tools.powershell]",
        'permission = "never"',
      ].join("\n"),
    );

    const imported = JSON.parse(
      (await VibePermissions.fromFile({ outputRoot: testDir }))
        .toRulesyncPermissions()
        .getFileContent(),
    );

    expect(imported.permission.bash["*"]).toBe("deny");
    expect(imported.permission.git_bash).toBeUndefined();
    expect(imported.permission.powershell).toBeUndefined();
  });

  it("should keep a shell table that differs from bash on import", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'permission = "always"',
        "[tools.git_bash]",
        'permission = "always"',
        "[tools.powershell]",
        'permission = "never"',
      ].join("\n"),
    );

    const imported = JSON.parse(
      (await VibePermissions.fromFile({ outputRoot: testDir }))
        .toRulesyncPermissions()
        .getFileContent(),
    );

    expect(imported.permission.bash["*"]).toBe("allow");
    expect(imported.permission.git_bash).toBeUndefined();
    expect(imported.permission.powershell["*"]).toBe("deny");
  });

  it("should not touch phantom tool names for unmapped categories in the override or cleanup", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'disabled_tools = ["glob"]');

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { glob: { "*": "allow" } },
          vibe: { permission: { glob: { sensitive_patterns: ["x"] } } },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // No [tools.glob] from the sensitive_patterns override, and the existing
    // disabled_tools entry for the unmapped name is left alone (skipped, not
    // cleaned up as if rulesync managed a tool by that name).
    expect(parsed.tools?.glob).toBeUndefined();
    expect(parsed.disabled_tools).toEqual(["glob"]);
  });

  it("should round-trip an unknown on-disk [tools.*] table untouched", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.custom_tool]", 'permission = "ask"'].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "git *": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    expect(parsed.tools.custom_tool.permission).toBe("ask");
  });

  it("should not write the exclusive enabled_tools allowlist for wildcard allows", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "*": "allow", "rm -rf *": "deny" },
          read: { "*": "allow" },
        },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // `enabled_tools` is exclusive upstream ("if set, only these tools will be
    // active") — writing ["bash", "read_file"] here would switch off every
    // other builtin and MCP tool from a config meant to *grant* permissions.
    expect(parsed.enabled_tools).toBeUndefined();
    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.read_file.permission).toBe("always");
  });

  it("should emit permission = never for a wildcard deny", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { websearch: { "*": "deny" } } }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.web_search.permission).toBe("never");
    expect(parsed.disabled_tools).toEqual(["web_search"]);

    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    expect(imported.permission.websearch["*"]).toBe("deny");
  });

  it("should let the vibe override own the exclusive enabled_tools list", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'enabled_tools = ["grep"]');

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: { bash: { "*": "allow" } },
        vibe: { enabled_tools: ["bash", "read_file"] },
      }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.enabled_tools).toEqual(["bash", "read_file"]);
  });

  it("should clear the on-disk enabled_tools key when the override declares an empty list", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      'enabled_tools = ["bash", "custom_tool"]',
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { enabled_tools: [] },
        }),
      }),
    });

    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    expect(parsed.enabled_tools).toBeUndefined();
  });

  it("should warn when cleanup strips enabled_tools entries the override does not own", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'enabled_tools = ["bash"]');

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "rm -rf *": "deny" } } }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("exclusive enabled_tools"),
      ),
    ).toBe(true);
  });

  it("should not warn about enabled_tools when the override owns the key", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), 'enabled_tools = ["bash"]');

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { enabled_tools: ["bash", "read_file"] },
        }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("exclusive enabled_tools"),
      ),
    ).toBe(false);
  });

  it("should round-trip enabled_tools through the vibe override on import", () => {
    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent: 'enabled_tools = ["bash", "grep"]',
    });

    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());
    expect(imported.permission.bash).toBeUndefined();
    expect(imported.vibe.enabled_tools).toEqual(["bash", "grep"]);
  });

  it("should not warn about shadowing when --global writes alongside a project config.toml", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(join(testDir, ".vibe", "config.toml"), "");

    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
    });

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: join(testDir, "home"),
      rulesyncPermissions,
      logger,
      global: true,
    });

    // Since v2.24.0 Vibe stacks the user and project layers instead of picking
    // one, so the global write is inherited by the project layer rather than
    // being shadowed by it: it carries a real rule and warns about nothing.
    expect(vibePermissions.getRelativeDirPath()).toBe(".vibe");
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;
    expect(parsed.tools.bash.permission).toBe("always");
    expect(logger.warn.mock.calls.some(([message]) => String(message).includes("ignored"))).toBe(
      false,
    );
  });
});
