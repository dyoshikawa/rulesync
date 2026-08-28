import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { fallbackLogger } from "../../utils/logger.js";
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
        String(message).includes("no tool table for the 'glob' category"),
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
        String(message).includes("no tool table for the '*' category"),
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

  it("should translate a canonical mcp__<server>__<tool> category to Vibe's published name", async () => {
    // Vibe publishes an MCP tool as `<server>_<tool>`, so the canonical
    // spelling written verbatim would be a table Vibe never looks up.
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { mcp__github__create_issue: { "*": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.github_create_issue.permission).toBe("never");
    expect(parsed.tools?.mcp__github__create_issue).toBeUndefined();
    expect(parsed.disabled_tools).toEqual(["github_create_issue"]);
  });

  it("should split only the first mcp separator so a tool name may contain one", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { mcp__github__create__issue: { "*": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.github_create__issue.permission).toBe("never");
  });

  it("should skip a server-scoped mcp category, which has no Vibe tool table", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { mcp__github: { "*": "deny" } } }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools?.mcp__github).toBeUndefined();
    expect(parsed.tools?.github).toBeUndefined();
    expect(parsed.disabled_tools).toBeUndefined();
    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("no tool table for the 'mcp__github' category"),
      ),
    ).toBe(true);
  });

  it("should keep a hand-authored shell table out of the bash fan-out", async () => {
    // A [tools.powershell] table that already differs from [tools.bash] is the
    // author's own decision; broadening its deny into bash's allow silently
    // would be the dangerous direction.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "never"', ""].join("\n"),
    );

    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.git_bash.permission).toBe("always");
    expect(parsed.tools.powershell.permission).toBe("never");
    expect(logger.warn.mock.calls.some(([message]) => String(message).includes("powershell"))).toBe(
      true,
    );
  });

  it("should keep a hand-authored disabled_tools entry out of the bash fan-out", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["powershell"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["powershell"]);
    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools?.powershell).toBeUndefined();
  });

  it("should not fan sensitive_patterns out to a shell named in the shared permission block", async () => {
    // The suppression set spans both blocks: naming `powershell` in the shared
    // block must also take it out of the override's fan-out.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.powershell]",
        'sensitive_patterns = ["Remove-Item -Recurse"]',
        "[tools.bash]",
        'sensitive_patterns = ["Remove-Item -Recurse"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" }, powershell: { "*": "allow" } },
          vibe: { permission: { bash: { sensitive_patterns: ["rm -rf *"] } } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.sensitive_patterns).toEqual(["rm -rf *"]);
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["rm -rf *"]);
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["Remove-Item -Recurse"]);
  });

  it("should not emit empty tables for a category with no expressible rule", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: {} } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools?.bash).toBeUndefined();
    expect(parsed.tools?.git_bash).toBeUndefined();
    expect(parsed.tools?.powershell).toBeUndefined();
  });

  it("should warn about a category that only differs from a Vibe tool name by case", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { Bash: { "*": "deny" } } }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.Bash.permission).toBe("never");
    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("Vibe's tool names are lowercase"),
      ),
    ).toBe(true);
  });

  it("should not let a prototype-shaped category name corrupt the generated config", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            toString: { "*": "deny" },
            __proto__: { "*": "deny" },
          },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    // `toString` must be taken at face value as a (useless but harmless) tool
    // name rather than resolving to Object.prototype.toString.
    expect(parsed.tools.toString.permission).toBe("never");
    expect(parsed.disabled_tools).toEqual(["toString"]);
    expect(Object.hasOwn(Object.prototype, "*")).toBe(false);
  });

  it("should keep fanning bash out when [tools.bash] carries unmanaged keys", async () => {
    // rulesync copies unmanaged keys over for `bash` but never for the aliases,
    // so its own previous output must not read as a hand-authored divergence.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        "timeout = 120",
        'permission = "always"',
        "[tools.git_bash]",
        'permission = "always"',
        "[tools.powershell]",
        'permission = "always"',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.permission).toBe("never");
    expect(parsed.tools.bash.timeout).toBe(120);
    expect(parsed.tools.git_bash.permission).toBe("never");
    expect(parsed.tools.powershell.permission).toBe("never");
  });

  it("should still fan bash out to a shell that only has a sensitive_patterns override", async () => {
    // `vibe.permission` can carry `sensitive_patterns` and nothing else, so it
    // must not take a shell out of the fan-out and leave it with no permission.
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "deny" } },
          vibe: { permission: { powershell: { sensitive_patterns: ["rm -rf"] } } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["rm -rf"]);
    expect(parsed.tools.git_bash.permission).toBe("never");
  });

  it("should fan bash out over an existing empty shell table", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
  });

  it("should skip wildcard MCP categories instead of writing an inert table", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            "mcp__github__*": { "*": "deny" },
            "mcp__*__create_issue": { "*": "deny" },
          },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools?.["github_*"]).toBeUndefined();
    expect(vibePermissions.getFileContent()).not.toContain("github_");
    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("mcp__github__*")),
    ).toBe(true);
  });

  it("should let a translated MCP name claim a shell alias ahead of the fan-out", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            bash: { "*": "allow" },
            mcp__git__bash: { "*": "deny" },
          },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.powershell.permission).toBe("always");
    expect(parsed.tools.git_bash.permission).toBe("never");
  });

  it("should not emit a bare table for an override that only clears sensitive_patterns", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          vibe: { permission: { web_fetch: { sensitive_patterns: [] } } },
        }),
      }),
    });

    expect(vibePermissions.getFileContent()).not.toContain("web_fetch");
  });

  it("should not let the bash sensitive_patterns fan-out overwrite a sibling shell override", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "deny" } },
          vibe: {
            permission: {
              powershell: { sensitive_patterns: ["Remove-Item -Recurse"] },
              bash: { sensitive_patterns: ["rm -rf /"] },
            },
          },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["Remove-Item -Recurse"]);
    expect(parsed.tools.bash.sensitive_patterns).toEqual(["rm -rf /"]);
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["rm -rf /"]);
    expect(parsed.tools.powershell.permission).toBe("never");
  });

  it("should still fan bash out to a shell whose own category expresses nothing", async () => {
    // Vibe has no pattern-level `ask`, so this `powershell` category writes no
    // table; letting it claim the shell would drop the bash deny for it.
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {
            bash: { "*": "deny" },
            powershell: { "Remove-Item *": "ask" },
          },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
    expect(parsed.disabled_tools).toContain("powershell");
  });

  it("should not treat enabled_tools membership as a per-shell permission decision", async () => {
    // `enabled_tools` is an exclusive registry filter, not a permission; letting
    // it stand the fan-out down left the denied shell as the only active tool.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['enabled_tools = ["powershell"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
    expect(parsed.disabled_tools).toContain("powershell");
    expect(parsed.enabled_tools ?? []).not.toContain("powershell");
  });

  it("should treat the legacy allow spelling as equal to allowlist in the fan-out check", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'allow = ["x"]', "[tools.git_bash]", 'allowlist = ["x"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.permission).toBe("never");
    expect(parsed.tools.git_bash.allow).toBeUndefined();
  });

  it("should translate a capitalized MCP server name without warning about the prefix", async () => {
    const logger = createMockLogger();
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { mcp__GitHub__create_issue: { "*": "deny" } },
        }),
      }),
      logger,
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.GitHub_create_issue.permission).toBe("never");
    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("canonical prefix")),
    ).toBe(false);
  });

  it("should warn about a mis-cased MCP prefix", async () => {
    const logger = createMockLogger();
    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { MCP__github__create_issue: { "*": "deny" } },
        }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("canonical prefix")),
    ).toBe(true);
  });

  it("should warn about a glob in a verbatim tool name", async () => {
    const logger = createMockLogger();
    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { "github_*": { "npm run *": "deny" } } }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("exact tool name")),
    ).toBe(true);
  });

  it("should warn when two categories resolve to the same tool table", async () => {
    const logger = createMockLogger();
    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { read: { "*": "allow" }, read_file: { "*": "deny" } },
        }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) => String(message).includes("both resolve")),
    ).toBe(true);
  });

  it("should keep fanning bash out after an existing bash-only denylist is merged in", async () => {
    // Merging each alias with its own previous contents diverged them from
    // [tools.bash] on the first generate and froze the fan-out on the second,
    // stranding every later bash deny on POSIX.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'denylist = ["curl *"]', ""].join("\n"),
    );

    const generate = async (patterns: Record<string, string>) => {
      const vibePermissions = await VibePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({ permission: { bash: patterns } }),
        }),
      });
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        vibePermissions.getFileContent(),
      );
      return smolToml.parse(vibePermissions.getFileContent()) as any;
    };

    const first = await generate({ "wget *": "deny" });
    expect(first.tools.git_bash.denylist).toEqual(["curl *", "wget *"]);
    expect(first.tools.powershell.denylist).toEqual(["curl *", "wget *"]);

    const second = await generate({ "wget *": "deny", "nc *": "deny" });
    expect(second.tools.bash.denylist).toEqual(["curl *", "nc *", "wget *"]);
    expect(second.tools.git_bash.denylist).toEqual(["curl *", "nc *", "wget *"]);
    expect(second.tools.powershell.denylist).toEqual(["curl *", "nc *", "wget *"]);
  });

  it("should keep fanning bash out after a per-shell sensitive_patterns entry is written", async () => {
    // The `vibe.permission` pass addresses each shell by name, so its output must
    // not read back as a hand-authored decision that stands the fan-out down.
    await ensureDir(join(testDir, ".vibe"));

    const generate = async (rules: Record<string, string>) => {
      const vibePermissions = await VibePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: rules },
            vibe: { permission: { git_bash: { sensitive_patterns: ["curl"] } } },
          }),
        }),
      });
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        vibePermissions.getFileContent(),
      );
      return smolToml.parse(vibePermissions.getFileContent()) as any;
    };

    const first = await generate({ "*": "allow" });
    expect(first.tools.git_bash.permission).toBe("always");
    expect(first.tools.git_bash.sensitive_patterns).toEqual(["curl"]);
    expect(first.tools.bash.sensitive_patterns).toBeUndefined();

    // Tightening the base permission must still reach every shell.
    const second = await generate({ "*": "deny" });
    expect(second.tools.git_bash.permission).toBe("never");
    expect(second.tools.powershell.permission).toBe("never");
    expect(second.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
    expect(second.tools.git_bash.sensitive_patterns).toEqual(["curl"]);
  });

  it("should not fan an existing bash permission out to shells the file never configures when the category expresses nothing", async () => {
    // A pattern-level `ask` states no permission Vibe can read, so it must not
    // broaden the Windows shells to whatever [tools.bash] already allows.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'permission = "always"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "rm *": "ask" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.permission).toBe("always");
    expect(parsed.tools.git_bash).toBeUndefined();
    expect(parsed.tools.powershell).toBeUndefined();
  });

  it("should still fan bash out to a shell whose table states no permission", async () => {
    // `sensitive_patterns` is a masking setting and an empty list is the absent
    // key spelled out; neither states a permission decision, so neither may take
    // a Windows shell out of a `bash` deny.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.powershell]",
        'sensitive_patterns = ["cred"]',
        "[tools.git_bash]",
        "allowlist = []",
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
    expect(parsed.tools.powershell.permission).toBe("never");
    expect(parsed.tools.git_bash.permission).toBe("never");
    // The masking patterns the file already had are kept.
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["cred"]);
  });

  it("should not warn about standing the fan-out down when there is no bash category", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "never"', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "*": "deny" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) => String(call[0]).includes("instead of fanning")),
    ).toHaveLength(0);
  });

  it("should warn about a vibe override key it cannot express", async () => {
    const logger = createMockLogger();

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { powershell: { permission: "never" } } },
        }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("only expresses 'sensitive_patterns'"),
      ),
    ).toHaveLength(1);
  });

  it("should merge the bash override patterns into a shell's own sensitive_patterns", async () => {
    // Those patterns are the author's only defense once the base permission
    // becomes ALWAYS, so the fan-out must not overwrite them. Dropping the
    // override's patterns instead would strand a newly added guard on one shell,
    // so the two lists are merged: `sensitive_patterns` only escalates to ASK.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'permission = "always"',
        "[tools.powershell]",
        'sensitive_patterns = ["sudo *"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { bash: { sensitive_patterns: ["curl *"] } } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.sensitive_patterns).toEqual(["curl *"]);
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["curl *"]);
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["curl *", "sudo *"]);
    // The base permission still reaches it; only the patterns are merged.
    expect(parsed.tools.powershell.permission).toBe("always");
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("sensitive_patterns of powershell"),
      ),
    ).toHaveLength(1);
  });

  it("should merge the bash deny patterns into a shell the fan-out stood down from", async () => {
    // Standing down keeps the shell from being broadened, but a deny must still
    // reach it: Vibe resolves a denylist match before the allowlist and before
    // the configured permission, so the extra entries can only restrict it.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "always"', 'allowlist = ["git *"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "rm -rf *": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.denylist).toEqual(["rm -rf *"]);
    expect(parsed.tools.git_bash.denylist).toEqual(["rm -rf *"]);
    // The stood-down shell keeps its own base permission and allowlist, and
    // gains the deny.
    expect(parsed.tools.powershell.denylist).toEqual(["rm -rf *"]);
    expect(parsed.tools.powershell.permission).toBe("always");
    expect(parsed.tools.powershell.allowlist).toEqual(["git *"]);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Only the 'bash' deny patterns are merged into it"),
      ),
    ).toHaveLength(1);
  });

  it("should keep merging the same bash deny into a stood-down shell on regeneration", async () => {
    // The merged deny changes the shell's state, so the stand-down comparison
    // must still reach the same verdict on the next generate.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "always"', 'deny = ["curl *"]', ""].join("\n"),
    );
    const rulesyncPermissions = new RulesyncPermissions({
      outputRoot: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({ permission: { bash: { "rm -rf *": "deny" } } }),
    });

    const first = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });
    await writeFileContent(join(testDir, ".vibe", "config.toml"), first.getFileContent());
    const second = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    expect(second.getFileContent()).toBe(first.getFileContent());
    const parsed = smolToml.parse(second.getFileContent()) as any;
    // The legacy `deny` spelling Vibe never consults is folded into the key it
    // does consult, so both patterns are actually enforced.
    expect(parsed.tools.powershell.denylist).toEqual(["curl *", "rm -rf *"]);
    expect(parsed.tools.powershell.deny).toBeUndefined();
    expect(parsed.tools.powershell.permission).toBe("always");
  });

  it("should treat an empty shell sensitive_patterns as no patterns of its own", async () => {
    // `sensitive_patterns = []` is the absent key spelled out — Vibe's own
    // config dump writes it that way — so it must not leave the shell holding an
    // ALWAYS permission with no escalation at all.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'sensitive_patterns = ["rm *"]',
        "[tools.git_bash]",
        "sensitive_patterns = []",
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { bash: { sensitive_patterns: ["curl *"] } } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.permission).toBe("always");
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["curl *"]);
  });

  it("should not report a stand-down for a shell that has its own category", async () => {
    // The claim resolver gives that category the table, so the 'bash' category
    // never touches it — reporting an overwrite would describe a deny reaching a
    // shell it never reaches.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "never"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "deny" }, powershell: { "*": "allow" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("always");
    expect(parsed.disabled_tools).toEqual(["bash", "git_bash"]);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Overwriting the existing Vibe permission for powershell"),
      ),
    ).toHaveLength(0);
  });

  it("should keep both the legacy and the canonical deny list of an existing table", async () => {
    // Vibe reads `denylist` and ignores `deny`, so preferring the legacy key
    // dropped the list it was actually enforcing — and the fan-out then spread
    // that loss to all three shells.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'deny = ["legacy *"]', 'denylist = ["enforced *"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "new *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    for (const shell of ["bash", "git_bash", "powershell"]) {
      expect(parsed.tools[shell].denylist).toEqual(["enforced *", "legacy *", "new *"]);
      expect(parsed.tools[shell].deny).toBeUndefined();
    }
  });

  it("should import both the legacy and the canonical allow list of a table", async () => {
    const vibePermissions = new VibePermissions({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
      fileContent: ["[tools.bash]", 'allow = ["legacy *"]', 'allowlist = ["enforced *"]', ""].join(
        "\n",
      ),
    });

    const rulesyncPermissions = vibePermissions.toRulesyncPermissions();

    expect(rulesyncPermissions.getJson().permission.bash).toEqual({
      "legacy *": "allow",
      "enforced *": "allow",
    });
  });

  it("should fan out to a shell whose list is spelled with the legacy key", async () => {
    // `[tools.bash] allow` and `[tools.git_bash] allowlist` are the same decision,
    // so the shell must not be read as configured differently and stood down from.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'allowlist = ["ls"]', "[tools.git_bash]", 'allow = ["ls"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "rm -rf *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.denylist).toEqual(["rm -rf *"]);
    expect(parsed.tools.git_bash.allow).toBeUndefined();
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Keeping the existing Vibe permission"),
      ),
    ).toHaveLength(0);
  });

  it("should report a shell left holding sensitive_patterns the bash table lacks", async () => {
    // The fan-out fills a shell's patterns but never clears them, so deleting the
    // [tools.bash] guard strands the copies — and an import would then invent a
    // per-shell override entry that claims the shell out of the fan-out for good.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'sensitive_patterns = ["rm *"]', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("git_bash carries sensitive_patterns"),
      ),
    ).toHaveLength(1);
  });

  it("should stay quiet when the shell's own patterns are declared in the override", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'sensitive_patterns = ["rm *"]', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "allow" } },
          vibe: { permission: { git_bash: { sensitive_patterns: ["rm *"] } } },
        }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("carries sensitive_patterns"),
      ),
    ).toHaveLength(0);
  });

  it("should report an unreachable tool name once across both passes", async () => {
    const logger = createMockLogger();

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { Bash: { "*": "allow" } },
          vibe: { permission: { Bash: { sensitive_patterns: ["rm *"] } } },
        }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) => String(call[0]).includes("Did you mean 'bash'?")),
    ).toHaveLength(1);
  });

  it("should not emit an empty tools table when no category is expressible", async () => {
    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "npm *": "ask" } } }),
      }),
    });

    expect(vibePermissions.getFileContent()).not.toContain("[tools]");
  });

  it("should keep the enforced denylist of a stood-down shell that also spells a legacy deny", async () => {
    // Vibe reads `denylist` and never `deny`, so preferring the legacy key here
    // would drop the restriction the file actually enforces.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.powershell]",
        'permission = "always"',
        'deny = ["legacy"]',
        'denylist = ["REAL-SECRET *"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "ask", "rm -rf /": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("always");
    expect(parsed.tools.powershell.deny).toBeUndefined();
    expect(parsed.tools.powershell.denylist).toEqual(["REAL-SECRET *", "legacy", "rm -rf /"]);
  });

  it("should not invent a table for a shell that only exists as a disabled_tools entry", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["powershell"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "ask", "rm -rf /": "deny" } },
        }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell).toBeUndefined();
    expect(parsed.disabled_tools).toEqual(["powershell"]);
  });

  it("should keep a disabled tool disabled when its own table permits it", async () => {
    // Vibe applies `disabled_tools` last and unconditionally, so the table's
    // permission must not import as the tool's real state.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'disabled_tools = ["read_file"]',
        "[tools.read_file]",
        'permission = "always"',
        'allowlist = ["src/*"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    // The allowlist goes with the permission: it is just as inert upstream, and
    // importing it would carry a hole through a switched-off tool into every
    // other tool's generated config.
    expect(imported.permission.read).toEqual({ "*": "deny" });

    const regenerated = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(imported),
      }),
    });
    const parsed = smolToml.parse(regenerated.getFileContent()) as any;

    expect(parsed.disabled_tools).toContain("read_file");
    expect(parsed.tools.read_file.permission).toBe("never");
  });

  it("should say nothing is merged when an empty override meets a shell's own patterns", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'sensitive_patterns = ["own *"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
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

    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["own *"]);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Keeping the existing Vibe sensitive_patterns of git_bash"),
      ),
    ).toHaveLength(1);
    expect(
      logger.warn.mock.calls.filter((call) => String(call[0]).includes("rather than replacing")),
    ).toHaveLength(0);
  });

  it("should preserve a shell whose denylist is not spelled as a list", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'denylist = "rm -rf *"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.denylist).toBe("rm -rf *");
    expect(parsed.tools.git_bash.permission).toBeUndefined();
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Keeping the existing Vibe permission for git_bash"),
      ),
    ).toHaveLength(1);
  });

  it("should warn before promoting a legacy allow list into the enforced allowlist", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.read_file]",
        'permission = "never"',
        'allow = ["curl *"]',
        'allowlist = ["ls"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "cat *": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.read_file.allowlist).toEqual(["cat *", "curl *", "ls"]);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Promoting curl * from the legacy 'allow' key"),
      ),
    ).toHaveLength(1);
  });

  it("should not read a disabled_tools entry that Vibe itself never matches", async () => {
    // `name_matches` globs the raw tool name, so a bare "read" matches nothing —
    // silencing [tools.read_file] with it would disable a tool Vibe leaves running.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'disabled_tools = ["read"]',
        "[tools.read_file]",
        'permission = "always"',
        'allowlist = ["src/*"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(imported.permission.read).toEqual({ "*": "allow", "src/*": "allow" });
  });

  it("should say nothing is written for a shell that disabled_tools takes off the registry", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["powershell"]', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "ask", "rm -rf /": "deny" } },
        }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Not fanning the 'bash' category out to powershell"),
      ),
    ).toHaveLength(1);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Keeping the existing Vibe permission"),
      ),
    ).toHaveLength(0);
  });

  it("should not replace a denylist that is not spelled as a list when merging a bash deny", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'denylist = "rm -rf *"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "sudo *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.denylist).toBe("rm -rf *");
    expect(parsed.tools.bash.denylist).toEqual(["sudo *"]);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Not merging the 'bash' deny patterns into [tools.git_bash]"),
      ),
    ).toHaveLength(1);
  });

  it("should overwrite a loosely configured shell when the bash category denies everything", async () => {
    // Standing down protects a shell from being broadened. A wildcard deny can
    // only restrict, so letting the stand-down win there would strand the deny.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "always"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
    expect(parsed.tools.powershell.permission).toBe("never");
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Overwriting the existing Vibe permission for powershell"),
      ),
    ).toHaveLength(1);
  });

  it("should still keep a loosely configured shell when the bash category only allows", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "never"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
    expect(
      logger.warn.mock.calls.filter((call) => String(call[0]).includes("instead of fanning")),
    ).toHaveLength(1);
  });

  it("should drop an empty allowlist carried over from the existing file", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", "denylist = []", ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.denylist).toBeUndefined();
    expect(parsed.tools.git_bash.denylist).toBeUndefined();
    expect(parsed.tools.powershell.denylist).toBeUndefined();
  });

  it("should fan an existing bash sensitive_patterns guard out to the shells", async () => {
    // Spreading `permission = "always"` while leaving the ASK escalation behind
    // would broaden the shells past what [tools.bash] itself allows.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'permission = "always"',
        'sensitive_patterns = ["curl *"]',
        "[tools.powershell]",
        'sensitive_patterns = ["sudo *"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["curl *"]);
    // A shell that authored its own guard keeps it; the fill never overwrites.
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["sudo *"]);
  });

  it("should keep fanning bash out to a shell whose lists differ only in order", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        "[tools.bash]",
        'denylist = ["b", "a"]',
        "[tools.git_bash]",
        'denylist = ["a", "b"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
    expect(parsed.tools.git_bash.permission).toBe("never");
  });

  it("should say only the patterns are held back when bash has no shared-block category", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.powershell]", 'permission = "never"', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: {},
          vibe: { permission: { bash: { sensitive_patterns: ["x"] } } },
        }),
      }),
    });

    const warnings = logger.warn.mock.calls.map((call) => String(call[0]));
    // The shared block has no `bash` category, so no `bash` permission is held back.
    expect(
      warnings.filter((warning) => warning.includes("The 'bash' permission does NOT apply")),
    ).toHaveLength(0);
    expect(
      warnings.filter((warning) =>
        warning.includes("vibe.permission.bash.sensitive_patterns is not fanned out to powershell"),
      ),
    ).toHaveLength(1);
  });

  it("should mirror an existing bash disabled_tools entry onto the shells", async () => {
    // The three shells are one decision, so the filter travels with the table;
    // `clearStaleToolFilters` never removes an entry without a `*` rule.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["bash"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "rm *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["bash", "git_bash", "powershell"]);
  });

  it("should converge across generate, import and generate again", async () => {
    await ensureDir(join(testDir, ".vibe"));
    const generate = async (json: unknown) => {
      const vibePermissions = await VibePermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          outputRoot: testDir,
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify(json),
        }),
      });
      await writeFileContent(
        join(testDir, ".vibe", "config.toml"),
        vibePermissions.getFileContent(),
      );
      return vibePermissions;
    };

    const first = await generate({
      permission: { bash: { "*": "allow", "rm *": "deny" }, edit: { "*": "deny" } },
      vibe: {
        permission: {
          bash: { sensitive_patterns: ["sudo *"] },
          git_bash: { sensitive_patterns: ["reg *"] },
        },
      },
    });
    const imported = JSON.parse(first.toRulesyncPermissions().getFileContent());
    const second = await generate(imported);
    const reimported = JSON.parse(second.toRulesyncPermissions().getFileContent());
    const third = await generate(reimported);

    expect(second.getFileContent()).toBe(third.getFileContent());
    expect(reimported).toEqual(JSON.parse(second.toRulesyncPermissions().getFileContent()));
    // The round trip must not lose the per-shell escalation patterns.
    const parsed = smolToml.parse(third.getFileContent()) as any;
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["reg *"]);
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["sudo *"]);
  });

  it("should fan an existing bash base permission out to the shells", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'permission = "never"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "curl *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.git_bash.permission).toBe("never");
    expect(parsed.tools.powershell.permission).toBe("never");
  });

  it("should not clear disabled_tools for a category that states no base permission", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["bash", "powershell"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "curl *": "deny" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toContain("bash");
    expect(parsed.disabled_tools).toContain("powershell");
    expect(parsed.disabled_tools).toContain("git_bash");
  });

  it("should still clear disabled_tools for a wildcard allow", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["bash"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools ?? []).not.toContain("bash");
    expect(parsed.tools.bash.permission).toBe("always");
  });

  it("should warn when another category takes a Windows shell out of the bash fan-out", async () => {
    const logger = createMockLogger();
    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "*": "deny" }, mcp__git__bash: { "*": "allow" } },
        }),
      }),
      logger,
    });

    expect(
      logger.warn.mock.calls.some(([message]) =>
        String(message).includes("no longer fanned out to it"),
      ),
    ).toBe(true);
  });

  it("should import a __proto__ denylist entry without polluting the prototype", async () => {
    // `ensurePermission` builds a null-prototype record so the entry lands as a
    // real own key; the shared-config gateway then strips it on the way out.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'denylist = ["__proto__", "sudo"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const rules = vibePermissions.toRulesyncPermissions().getJson().permission.bash ?? {};

    expect(rules.sudo).toBe("deny");
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).sudo).toBeUndefined();
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

  it.each([
    ["a trailing wildcard", 'disabled_tools = ["read_*"]'],
    ["a wildcard on both sides", 'disabled_tools = ["*ead_fil*"]'],
    ["a different case", 'disabled_tools = ["READ_*"]'],
    ["a single-character wildcard", 'disabled_tools = ["read_fil?"]'],
    ["a character class", 'disabled_tools = ["read_fil[ef]"]'],
  ])("should keep a tool disabled by %s out of the import", async (_label, disabledTools) => {
    // Vibe's `name_matches` globs the RAW tool name case-insensitively, so every
    // spelling here switches read_file off upstream. Reading the table as live
    // carried a hole through a disabled tool into every other tool's config.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        disabledTools,
        "[tools.read_file]",
        'permission = "always"',
        'allowlist = ["src/*"]',
        "",
      ].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(imported.permission.read).toEqual({ "*": "deny" });
  });

  it("should carry a disabling glob out under its own name as well as the table's", async () => {
    // The glob also reaches tools rulesync cannot enumerate (an MCP tool
    // registered at run time), so it round-trips verbatim beside the deny for the
    // one table the file does state.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["read_*"]', "[tools.read_file]", 'permission = "always"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(imported.permission["read_*"]).toEqual({ "*": "deny" });

    const regenerated = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(imported),
      }),
    });
    const parsed = smolToml.parse(regenerated.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["read_*", "read_file"]);
    expect(parsed.tools.read_file.permission).toBe("never");
  });

  it("should not import a shell as allowed when a glob disables it", async () => {
    // `*bash*` disables bash and git_bash upstream. Reading [tools.bash] as live
    // imported an allow that the fan-out then spread to powershell, the one shell
    // the glob does not reach.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["*bash*"]', "[tools.bash]", 'permission = "always"', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(imported.permission.bash).toEqual({ "*": "deny" });

    const regenerated = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(imported),
      }),
    });
    const parsed = smolToml.parse(regenerated.getFileContent()) as any;

    expect(parsed.tools.powershell.permission).toBe("never");
  });

  it("should import a table as authored when disabled_tools spells a regex", async () => {
    // Vibe reads a `re:` entry as a Python regular expression. Rulesync does not
    // evaluate it — a wrong verdict either way costs something real — so the
    // table is imported as it stands and the fallback logger says so.
    const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["re:read_.*"]', "[tools.read_file]", 'permission = "always"', ""].join(
        "\n",
      ),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    const imported = JSON.parse(vibePermissions.toRulesyncPermissions().getFileContent());

    expect(imported.permission.read).toEqual({ "*": "allow" });
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("re:read_.*"))).toHaveLength(
      1,
    );
  });

  it("should say nothing about a regex disabled_tools entry when the file has no tables", async () => {
    const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["re:read_.*"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromFile({ outputRoot: testDir });
    vibePermissions.toRulesyncPermissions();

    expect(warn).not.toHaveBeenCalled();
  });

  it("should report a surviving glob that silences a tool rulesync just allowed", async () => {
    // The glob is left in place because it reaches tools rulesync cannot
    // enumerate; upstream applies disabled_tools last, so the allow is inert.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["read_*"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.disabled_tools).toEqual(["read_*"]);
    expect(parsed.tools.read_file.permission).toBe("always");
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("which also matches read_file"),
      ),
    ).toHaveLength(1);
  });

  it("should not report a surviving glob when the tool it matches is denied anyway", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ['disabled_tools = ["read_*"]', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { read: { "*": "deny" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) => String(call[0]).includes("which also matches")),
    ).toHaveLength(0);
  });

  it("should copy hand-authored bash sensitive_patterns onto the shells in authored order", async () => {
    // Rulesync leaves [tools.bash]'s own list in authored order because it does
    // not own that key. Sorting only the copy made one guard read as two
    // different lists across the three managed shells.
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.bash]", 'sensitive_patterns = ["sudo *", "curl *"]', ""].join("\n"),
    );

    const vibePermissions = await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "allow" } } }),
      }),
    });
    const parsed = smolToml.parse(vibePermissions.getFileContent()) as any;

    expect(parsed.tools.bash.sensitive_patterns).toEqual(["sudo *", "curl *"]);
    expect(parsed.tools.git_bash.sensitive_patterns).toEqual(["sudo *", "curl *"]);
    expect(parsed.tools.powershell.sensitive_patterns).toEqual(["sudo *", "curl *"]);
  });

  it("should not promise a deny merge into a shell whose denylist is not a list", async () => {
    // The stand-down warning used to announce a merge that the malformed-key
    // warning then denied, leaving the two contradicting each other.
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'denylist = "rm -rf *"', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "ask", "sudo *": "deny" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Only the 'bash' deny patterns are merged into it"),
      ),
    ).toHaveLength(0);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Nothing from the category reaches it"),
      ),
    ).toHaveLength(1);
  });

  it("should still promise the deny merge into a well-formed stood-down shell", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'permission = "never"', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "ask", "sudo *": "deny" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Only the 'bash' deny patterns are merged into it"),
      ),
    ).toHaveLength(1);
  });

  it("should not promise a deny merge when the bash category has no deny patterns", async () => {
    const logger = createMockLogger();
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[tools.git_bash]", 'permission = "never"', ""].join("\n"),
    );

    await VibePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      logger,
      rulesyncPermissions: new RulesyncPermissions({
        outputRoot: testDir,
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({ permission: { bash: { "*": "ask" } } }),
      }),
    });

    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes("Nothing from the category reaches it"),
      ),
    ).toHaveLength(1);
  });
});
