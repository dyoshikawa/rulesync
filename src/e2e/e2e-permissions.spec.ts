import { join } from "node:path";

import { load } from "js-yaml";
import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: permissions", () => {
  const { getTestDir } = useTestDirectory();

  it("should generate opencode permissions from .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "opencode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, "opencode.jsonc")));
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });

  it("should generate zed permissions into .zed/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow", "rm *": "deny" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "zed", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".zed", "settings.json")));
    const tools = content.agent.tool_permissions.tools;
    // `bash` → `terminal`, `*` → per-tool default, `ask` → `confirm`.
    expect(tools.terminal.default).toBe("confirm");
    expect(tools.terminal.always_allow).toEqual([{ pattern: "git *", case_sensitive: false }]);
    expect(tools.terminal.always_deny).toEqual([{ pattern: "rm *", case_sensitive: false }]);
    // `read` → `read_file`.
    expect(tools.read_file.always_deny).toEqual([{ pattern: ".env", case_sensitive: false }]);
  });

  it("should generate amp permissions into .amp/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            edit_file: { "*": "deny" },
            "builtin:Bash": { "*": "deny" },
            read_file: { "*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "amp", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".amp", "settings.json")));
    // deny rules map to disabled tool names verbatim (including `builtin:` prefix);
    // allow rules are skipped because Amp can only disable tools.
    expect(content["amp.tools.disable"]).toEqual(["builtin:Bash", "edit_file"]);
  });

  it("should generate codexcli permissions into .codex/config.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status": "allow", "npm publish": "ask", "rm -rf": "deny" },
            read: {
              "**/*.tf": "deny",
              "src/**": "allow",
              "/workspace/project/**": "allow",
              "/workspace/project/.env": "deny",
            },
            write: { "docs/**": "allow", "/workspace/project/src/**": "allow" },
            webfetch: { "github.com": "allow", "example.com": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "codexcli", features: "permissions" });

    const parsed = smolToml.parse(await readFileContent(join(testDir, ".codex", "config.toml")));
    const table = toTable(parsed);
    expect(table.default_permissions).toBe("rulesync");
    const permissions = toTable(table.permissions);
    const rulesyncProfile = toTable(permissions.rulesync);
    const filesystem = toTable(rulesyncProfile.filesystem);
    const network = toTable(rulesyncProfile.network);
    const domains = toTable(network.domains);
    const workspaceRoots = toTable(filesystem[":workspace_roots"]);
    expect(filesystem[":minimal"]).toBe("read");
    expect(filesystem["/workspace/project/**"]).toBe("read");
    expect(filesystem["/workspace/project/src/**"]).toBe("write");
    expect(filesystem.glob_scan_max_depth).toBe(8);
    expect(workspaceRoots["**/*.tf"]).toBe("deny");
    expect(workspaceRoots["src/**"]).toBe("read");
    expect(workspaceRoots["docs/**"]).toBe("write");
    expect(domains["github.com"]).toBe("allow");

    const rulesContent = await readFileContent(join(testDir, ".codex", "rules", "rulesync.rules"));
    expect(rulesContent).toContain('pattern = ["git", "status"]');
    expect(rulesContent).toContain('decision = "allow"');
    expect(rulesContent).toContain('pattern = ["npm", "publish"]');
    expect(rulesContent).toContain('decision = "prompt"');
    expect(rulesContent).toContain('pattern = ["rm", "-rf"]');
    expect(rulesContent).toContain('decision = "forbidden"');
  });

  it("should generate cursor permissions into .cursor/cli.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm -rf *": "deny" },
            read: { "src/**": "allow" },
            webfetch: { "github.com": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "cursor", features: "permissions" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".cursor", "cli.json")));
    expect(generated.permissions.allow).toEqual(
      expect.arrayContaining(["Shell(git *)", "Read(src/**)", "WebFetch(github.com)"]),
    );
    expect(generated.permissions.deny).toEqual(expect.arrayContaining(["Shell(rm -rf *)"]));
  });

  it("should generate kiro permissions into .kiro/agents/default.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { "src/**": "allow" },
            write: { "docs/**": "allow" },
            webfetch: { "*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "kiro", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, ".kiro", "agents", "default.json")),
    );
    expect(content.toolsSettings.shell.allowedCommands).toContain("git *");
    expect(content.toolsSettings.shell.deniedCommands).toContain("rm *");
    expect(content.toolsSettings.read.allowedPaths).toContain("src/**");
    expect(content.toolsSettings.write.allowedPaths).toContain("docs/**");
    expect(content.allowedTools).toContain("web_fetch");
  });

  it("should generate kilo permissions into kilo.jsonc", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "kilo", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, "kilo.jsonc")));
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });

  it("should generate antigravity-ide permissions into .antigravity/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { "src/**": "allow" },
            write: { "src/**": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "antigravity-ide", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, ".antigravity", "settings.json")),
    );
    expect(content.permissions.allow).toEqual(
      expect.arrayContaining(["command(git *)", "read_file(src/**)", "write_file(src/**)"]),
    );
    expect(content.permissions.deny).toContain("command(rm *)");
  });

  it("should import antigravity-ide permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".antigravity", "settings.json"),
      JSON.stringify(
        {
          permissions: {
            allow: ["command(git *)", "read_file(src/**)"],
            deny: ["command(rm *)"],
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "antigravity-ide", features: "permissions" });

    const config = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(config.permission.bash["git *"]).toBe("allow");
    expect(config.permission.bash["rm *"]).toBe("deny");
    expect(config.permission.read["src/**"]).toBe("allow");
  });

  it("should generate augmentcode permissions into .augment/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { "*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "augmentcode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".augment", "settings.json")));
    const entries = augmentToolPermissionsOf(content);
    expect(
      entries.some(
        (e) =>
          e.toolName === "launch-process" &&
          e.shellInputRegex === "^git .*$" &&
          e.permission.type === "allow",
      ),
    ).toBe(true);
    expect(
      entries.some(
        (e) =>
          e.toolName === "launch-process" &&
          e.shellInputRegex === "^rm .*$" &&
          e.permission.type === "deny",
      ),
    ).toBe(true);
    expect(entries.some((e) => e.toolName === "view" && e.permission.type === "allow")).toBe(true);
  });

  it("should generate cline permissions into .cline/command-permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "cline", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, ".cline", "command-permissions.json")),
    );
    expect(content.allow).toContain("git *");
    expect(content.deny).toContain("rm *");
    expect(content.allowRedirects).toBe(false);
  });

  it("should generate factorydroid permissions into .factory/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "factorydroid", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".factory", "settings.json")));
    expect(content.commandAllowlist).toContain("git *");
    expect(content.commandDenylist).toContain("rm *");
  });

  it("should generate qwencode permissions into .qwen/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { ".env": "deny" },
            webfetch: { "github.com": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "qwencode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".qwen", "settings.json")));
    expect(content.permissions.allow).toContain("Bash(git *)");
    expect(content.permissions.allow).toContain("WebFetch(github.com)");
    expect(content.permissions.deny).toContain("Bash(rm *)");
    expect(content.permissions.deny).toContain("Read(.env)");
  });

  it("should generate vibe permissions into .vibe/config.toml and preserve MCP config", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      ["[[mcp_servers]]", 'name = "existing"', 'transport = "stdio"', 'command = "node"'].join(
        "\n",
      ),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow", "rm *": "deny" },
            read: { "*": "allow" },
            edit: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "vibe", features: "permissions" });

    const parsed = toTable(
      smolToml.parse(await readFileContent(join(testDir, ".vibe", "config.toml"))),
    );
    const tools = toTable(parsed.tools);
    const bash = toTable(tools.bash);
    const readFile = toTable(tools.read_file);
    expect(toTableArray(parsed.mcp_servers)).toMatchObject([{ name: "existing", command: "node" }]);
    expect(bash.permission).toBe("ask");
    expect(bash.allowlist).toEqual(["git *"]);
    expect(bash.denylist).toEqual(["rm *"]);
    expect(readFile.permission).toBe("always");
    expect(parsed.disabled_tools).toContain("write_file");
  });

  it("should generate takt permissions into .takt/config.yaml", async () => {
    const testDir = getTestDir();

    // Pre-seed config.yaml with an active provider and unrelated keys to verify
    // the non-destructive merge and that the mode is written under the active
    // provider profile.
    await writeFileContent(
      join(testDir, ".takt", "config.yaml"),
      ["provider: codex", "model: gpt-5", "provider_profiles:", "  codex: {}"].join("\n"),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "takt", features: "permissions" });

    const parsed = toTable(load(await readFileContent(join(testDir, ".takt", "config.yaml"))));
    // Active provider preserved; only-bash allow collapses to the `full` mode.
    expect(parsed.provider).toBe("codex");
    expect(parsed.model).toBe("gpt-5");
    const profiles = toTable(parsed.provider_profiles);
    expect(toTable(profiles.codex).default_permission_mode).toBe("full");
  });

  it("should import takt permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".takt", "config.yaml"),
      [
        "provider: claude",
        "provider_profiles:",
        "  claude:",
        "    default_permission_mode: edit",
      ].join("\n"),
    );

    await runImport({ target: "takt", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    // `edit` mode imports back to an `edit` allow catch-all.
    expect(content.permission.edit["*"]).toBe("allow");
  });

  it("should remove denied Kiro web tools from existing allowedTools", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            webfetch: { "*": "deny" },
            websearch: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );
    await writeFileContent(
      join(testDir, ".kiro", "agents", "default.json"),
      JSON.stringify(
        {
          allowedTools: ["web_fetch", "web_search", "read"],
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "kiro", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, ".kiro", "agents", "default.json")),
    );
    expect(content.allowedTools).toEqual(["read"]);
  });
});

describe("E2E: permissions (import)", () => {
  const { getTestDir } = useTestDirectory();

  it("should import opencode permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "npm *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "opencode", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["npm *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });

  it("should import zed permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".zed", "settings.json"),
      JSON.stringify(
        {
          agent: {
            tool_permissions: {
              tools: {
                terminal: {
                  default: "confirm",
                  always_allow: [{ pattern: "npm *", case_sensitive: false }],
                },
                read_file: {
                  always_deny: [{ pattern: ".env", case_sensitive: false }],
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "zed", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    // `terminal` → `bash`, `confirm` → `ask`.
    expect(content.permission.bash["*"]).toBe("ask");
    expect(content.permission.bash["npm *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });

  it("should import amp permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".amp", "settings.json"),
      JSON.stringify(
        {
          "amp.tools.disable": ["edit_file", "builtin:Bash", "*"],
        },
        null,
        2,
      ),
    );

    await runImport({ target: "amp", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    // Each disabled tool name becomes a category with `{ "*": "deny" }`,
    // preserving `builtin:` prefixes and the `*` glob verbatim.
    expect(content.permission.edit_file["*"]).toBe("deny");
    expect(content.permission["builtin:Bash"]["*"]).toBe("deny");
    expect(content.permission["*"]["*"]).toBe("deny");
  });

  it("should import codexcli permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      `
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
    );

    await runImport({ target: "codexcli", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.read["/workspace/project/**"]).toBe("allow");
    expect(content.permission.edit["/workspace/project/src/**"]).toBe("allow");
    expect(content.permission.read["/workspace/project/.env"]).toBe("deny");
    expect(content.permission.webfetch["github.com"]).toBe("allow");
    expect(content.permission.webfetch["example.com"]).toBe("deny");
  });

  it("should import kilo permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "kilo.jsonc"),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "kilo", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });

  it("should import augmentcode permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".augment", "settings.json"),
      JSON.stringify(
        {
          toolPermissions: [
            {
              toolName: "launch-process",
              shellInputRegex: "^git .*$",
              permission: { type: "allow" },
            },
            {
              toolName: "view",
              permission: { type: "deny" },
            },
            {
              toolName: "save-file",
              permission: { type: "ask-user" },
            },
          ],
        },
        null,
        2,
      ),
    );

    await runImport({ target: "augmentcode", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read["*"]).toBe("deny");
    expect(content.permission.write["*"]).toBe("ask");
  });

  it("should import cline permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".cline", "command-permissions.json"),
      JSON.stringify(
        {
          allow: ["git *", "npm *"],
          deny: ["rm -rf *"],
        },
        null,
        2,
      ),
    );

    await runImport({ target: "cline", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["npm *"]).toBe("allow");
    expect(content.permission.bash["rm -rf *"]).toBe("deny");
  });

  it("should import qwencode permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".qwen", "settings.json"),
      JSON.stringify(
        {
          permissions: {
            allow: ["Bash(git *)", "Read(src/**)"],
            ask: ["Bash(git push *)"],
            deny: ["Bash(rm -rf *)"],
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "qwencode", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["git push *"]).toBe("ask");
    expect(content.permission.bash["rm -rf *"]).toBe("deny");
    expect(content.permission.read["src/**"]).toBe("allow");
  });

  it("should import kiro permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".kiro", "agents", "default.json"),
      JSON.stringify(
        {
          allowedTools: ["web_fetch"],
          toolsSettings: {
            shell: {
              allowedCommands: ["git *"],
              deniedCommands: ["rm *"],
            },
            read: {
              allowedPaths: ["src/**"],
              deniedPaths: [".env"],
            },
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "kiro", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["rm *"]).toBe("deny");
    expect(content.permission.read["src/**"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
    expect(content.permission.webfetch["*"]).toBe("allow");
  });

  it("should import vibe permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'enabled_tools = ["read_file"]',
        'disabled_tools = ["write_file"]',
        "",
        "[tools.bash]",
        'permission = "ask"',
        'allow = ["git *"]',
        'deny = ["rm *"]',
      ].join("\n"),
    );

    await runImport({ target: "vibe", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.read["*"]).toBe("allow");
    expect(content.permission.edit["*"]).toBe("deny");
    expect(content.permission.bash["*"]).toBe("ask");
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["rm *"]).toBe("deny");
  });
});

describe("E2E: permissions (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should generate claudecode permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await writeFileContent(
      join(homeDir, ".claude", "settings.json"),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] }],
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "claudecode",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(await readFileContent(join(homeDir, ".claude", "settings.json")));
    expect(generated.permissions.allow).toContain("Bash(git status *)");
    expect(generated.permissions.deny).toContain("Read(.env)");
    expect(generated.hooks).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] }],
    });
  });

  it("should generate opencode permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          root: true,
          permission: {
            bash: { "*": "ask", "git status *": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "opencode",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".config", "opencode", "opencode.jsonc")),
    );
    expect(generated.permission.bash["git status *"]).toBe("allow");
  });

  it("should generate codexcli permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "pnpm lint": "allow" },
            read: { "/workspace/project/**": "allow" },
            webfetch: { "github.com": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "codexcli",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = smolToml.parse(await readFileContent(join(homeDir, ".codex", "config.toml")));
    const table = toTable(parsed);
    expect(table.default_permissions).toBe("rulesync");
    const permissions = toTable(table.permissions);
    const rulesyncProfile = toTable(permissions.rulesync);
    const filesystem = toTable(rulesyncProfile.filesystem);
    const network = toTable(rulesyncProfile.network);
    const domains = toTable(network.domains);
    expect(filesystem["/workspace/project/**"]).toBe("read");
    expect(domains["github.com"]).toBe("allow");

    const rulesContent = await readFileContent(join(homeDir, ".codex", "rules", "rulesync.rules"));
    expect(rulesContent).toContain('pattern = ["pnpm", "lint"]');
    expect(rulesContent).toContain('decision = "allow"');
  });

  it("should generate cursor permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow", "rm -rf *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "cursor",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".cursor", "cli-config.json")),
    );
    expect(generated.permissions.allow).toContain("Shell(git status *)");
    expect(generated.permissions.deny).toContain("Shell(rm -rf *)");
  });

  it("should generate kilo permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git status *": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "kilo",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".config", "kilo", "kilo.jsonc")),
    );
    expect(generated.permission.bash["git status *"]).toBe("allow");
  });

  it("should generate augmentcode permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "augmentcode",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(await readFileContent(join(homeDir, ".augment", "settings.json")));
    const entries = augmentToolPermissionsOf(generated);
    expect(
      entries.some(
        (e) =>
          e.toolName === "launch-process" &&
          e.shellInputRegex === "^git status .*$" &&
          e.permission.type === "allow",
      ),
    ).toBe(true);
  });

  it("should generate qwencode permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "qwencode",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(await readFileContent(join(homeDir, ".qwen", "settings.json")));
    expect(generated.permissions.allow).toContain("Bash(git status *)");
    expect(generated.permissions.deny).toContain("Read(.env)");
  });

  it("should generate antigravity-cli permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow", "rm -rf *": "deny" },
            read: { "src/**": "allow" },
            webfetch: { "https://example.com/*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "antigravity-cli",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // The Antigravity CLI uses Claude-Code-style `permissions.allow/deny`
    // arrays over the Fine-Grained Permissions Engine action vocabulary
    // (`command`/`read_file`/`write_file`/`read_url`/...). Permissions are
    // global-scope only, so there is no project-mode equivalent.
    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".gemini", "antigravity-cli", "settings.json")),
    );
    expect(generated.permissions.allow).toContain("command(git status *)");
    expect(generated.permissions.deny).toContain("command(rm -rf *)");
    expect(generated.permissions.allow).toContain("read_file(src/**)");
    expect(generated.permissions.allow).toContain("read_url(https://example.com/*)");
  });

  it("should generate warp permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status .*": "allow", "rm -rf .*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "warp",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Warp's settings.toml lives in a platform-specific directory and exposes
    // command permissions as regex allow/deny lists under [agents.profiles].
    // Permissions are global-scope only, so there is no project-mode equivalent.
    const warpDir =
      process.platform === "darwin"
        ? ".warp"
        : process.platform === "win32"
          ? join("AppData", "Local", "warp", "Warp", "config")
          : join(".config", "warp-terminal");
    const generated = await readFileContent(join(homeDir, warpDir, "settings.toml"));
    expect(generated).toContain("agent_mode_command_execution_allowlist");
    expect(generated).toContain("git status .*");
    expect(generated).toContain("rm -rf .*");
  });

  it("should generate zed permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git status *": "allow", "rm -rf *": "deny" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed the shared global settings with unrelated user config to verify
    // the non-destructive merge into `~/.config/zed/settings.json`.
    await writeFileContent(
      join(homeDir, ".config", "zed", "settings.json"),
      JSON.stringify(
        {
          theme: "One Dark",
          context_servers: { my_server: { command: "x" } },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "zed",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".config", "zed", "settings.json")),
    );
    const tools = generated.agent.tool_permissions.tools;
    // `bash` → `terminal`, `*` → per-tool default, `ask` → `confirm`.
    expect(tools.terminal.default).toBe("confirm");
    expect(tools.terminal.always_allow).toEqual([
      { pattern: "git status *", case_sensitive: false },
    ]);
    expect(tools.terminal.always_deny).toEqual([{ pattern: "rm -rf *", case_sensitive: false }]);
    expect(tools.read_file.always_deny).toEqual([{ pattern: ".env", case_sensitive: false }]);
    // Unrelated user settings preserved by the non-destructive merge.
    expect(generated.theme).toBe("One Dark");
    expect(generated.context_servers.my_server.command).toBe("x");
  });

  it("should generate amp permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            edit_file: { "*": "deny" },
            "builtin:Bash": { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed the shared global settings with unrelated config (e.g. MCP) to
    // verify the non-destructive merge into `~/.config/amp/settings.json`.
    await writeFileContent(
      join(homeDir, ".config", "amp", "settings.json"),
      JSON.stringify(
        {
          "amp.mcpServers": { my_server: { command: "x" } },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "amp",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".config", "amp", "settings.json")),
    );
    expect(generated["amp.tools.disable"]).toEqual(["builtin:Bash", "edit_file"]);
    // Unrelated user settings preserved by the non-destructive merge.
    expect(generated["amp.mcpServers"].my_server.command).toBe("x");
  });

  it("should generate vibe permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          root: true,
          permission: {
            bash: { "*": "ask", "git status": "allow" },
            edit: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "vibe",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = toTable(
      smolToml.parse(await readFileContent(join(homeDir, ".vibe", "config.toml"))),
    );
    const tools = toTable(parsed.tools);
    const bash = toTable(tools.bash);
    expect(bash.permission).toBe("ask");
    expect(bash.allowlist).toEqual(["git status"]);
    expect(parsed.disabled_tools).toContain("write_file");
  });

  it("should generate rovodev permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git status": "allow", "rm -rf .*": "deny" },
            read: { "*": "allow" },
            edit: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed config.yml with unrelated user settings to verify the
    // non-destructive merge into ~/.rovodev/config.yml.
    await writeFileContent(
      join(homeDir, ".rovodev", "config.yml"),
      "agent:\n  model: claude\nsessions:\n  retention: 30\n",
    );

    await runGenerate({
      target: "rovodev",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = load(await readFileContent(join(homeDir, ".rovodev", "config.yml")));
    const root = toTable(parsed);
    const toolPermissions = toTable(root.toolPermissions);
    const bash = toTable(toolPermissions.bash);
    // `bash` catch-all -> bash.default; other patterns -> bash.commands.
    expect(bash.default).toBe("ask");
    expect(bash.commands).toEqual([
      { command: "git status", permission: "allow" },
      { command: "rm -rf .*", permission: "deny" },
    ]);
    // `read` -> inspection tools, `edit` -> mutation tools.
    expect(toolPermissions.open_files).toBe("allow");
    expect(toolPermissions.create_file).toBe("deny");
    // Unrelated user settings preserved by the non-destructive merge.
    expect(toTable(root.agent).model).toBe("claude");
    expect(toTable(root.sessions).retention).toBe(30);
  });

  it("should generate goose permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "allow" },
            edit: { "*": "ask" },
            webfetch: { "*": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed permission.yaml with a smart_approve LLM cache to verify the
    // non-destructive merge into ~/.config/goose/permission.yaml.
    await writeFileContent(
      join(homeDir, ".config", "goose", "permission.yaml"),
      [
        "smart_approve:",
        "  always_allow:",
        "    - developer__shell",
        "  ask_before: []",
        "  never_allow: []",
      ].join("\n"),
    );

    await runGenerate({
      target: "goose",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Goose persists per-tool permission overrides under the `user` key of the
    // global ~/.config/goose/permission.yaml, with allow/ask/deny mapped onto
    // always_allow/ask_before/never_allow lists of tool names. Permissions are
    // global-scope only, so there is no project-mode equivalent.
    const parsed = load(
      await readFileContent(join(homeDir, ".config", "goose", "permission.yaml")),
    );
    const root = toTable(parsed);
    const user = toTable(root.user);
    expect(user.always_allow).toEqual(["developer__shell"]);
    expect(user.ask_before).toEqual(["developer__text_editor"]);
    expect(user.never_allow).toEqual(["webfetch"]);
    // The smart_approve LLM cache is preserved by the non-destructive merge.
    const smartApprove = toTable(root.smart_approve);
    expect(smartApprove.always_allow).toEqual(["developer__shell"]);
  });

  it("should generate grokcli permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "allow", "rm *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed config.toml with an existing [mcp_servers] table to verify the
    // non-destructive merge into ~/.grok/config.toml.
    await writeFileContent(
      join(homeDir, ".grok", "config.toml"),
      ["[mcp_servers.example]", 'command = "echo"', "", "[ui]", 'theme = "dark"'].join("\n"),
    );

    await runGenerate({
      target: "grokcli",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Grok gates tools with the coarse `[ui] permission_mode` toggle in the
    // global ~/.grok/config.toml. A `deny` rule collapses the lossy mapping to
    // `ask`. Permissions are global-scope only, so there is no project-mode
    // equivalent.
    const content = await readFileContent(join(homeDir, ".grok", "config.toml"));
    expect(content).toContain('permission_mode = "ask"');
    // The existing MCP server config and other [ui] keys are preserved.
    expect(content).toContain("[mcp_servers.example]");
    expect(content).toContain('theme = "dark"');
  });

  it("should generate takt permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "allow", "rm *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed config.yaml with unrelated user settings to verify the
    // non-destructive merge into ~/.takt/config.yaml.
    await writeFileContent(
      join(homeDir, ".takt", "config.yaml"),
      ["provider: claude", "model: claude-sonnet"].join("\n"),
    );

    await runGenerate({
      target: "takt",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Takt gates tools with the coarse `default_permission_mode` under
    // `provider_profiles.<provider>` in the global ~/.takt/config.yaml. A `deny`
    // rule collapses the lossy mapping to `readonly`.
    const parsed = toTable(load(await readFileContent(join(homeDir, ".takt", "config.yaml"))));
    const profiles = toTable(parsed.provider_profiles);
    expect(toTable(profiles.claude).default_permission_mode).toBe("readonly");
    // Unrelated user settings preserved by the non-destructive merge.
    expect(parsed.model).toBe("claude-sonnet");
  });

  it("should generate hermesagent permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow", "rm -rf *": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed config.yaml with unrelated user settings to verify the
    // non-destructive merge into ~/.hermes/config.yaml.
    await writeFileContent(
      join(homeDir, ".hermes", "config.yaml"),
      ["model: hermes-large", "terminal: tmux"].join("\n"),
    );

    await runGenerate({
      target: "hermesagent",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // Hermes Agent has no project-scoped permissions location; permissions are
    // merged into the shared global ~/.hermes/config.yaml. Allow rules are also
    // surfaced as a flat `command_allowlist`, and the canonical map is preserved
    // under `permissions.rulesync` for round-tripping.
    const parsed = toTable(load(await readFileContent(join(homeDir, ".hermes", "config.yaml"))));
    expect(parsed.command_allowlist).toEqual(["git status *"]);
    const permissions = toTable(parsed.permissions);
    const rulesyncProfile = toTable(permissions.rulesync);
    const permissionMap = toTable(rulesyncProfile.permission);
    const bash = toTable(permissionMap.bash);
    expect(bash["git status *"]).toBe("allow");
    expect(bash["rm -rf *"]).toBe("deny");
    // Unrelated user settings preserved by the non-destructive merge.
    expect(parsed.model).toBe("hermes-large");
    expect(parsed.terminal).toBe("tmux");
  });
});

type AugmentEntry = {
  toolName: string;
  shellInputRegex?: string;
  permission: { type: string };
};

function augmentToolPermissionsOf(value: unknown): AugmentEntry[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record: Record<string, unknown> = { ...value };
  const entries = record.toolPermissions;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const e: Record<string, unknown> = { ...entry };
    const toolName = typeof e.toolName === "string" ? e.toolName : null;
    const rawPermission = e.permission;
    if (!rawPermission || typeof rawPermission !== "object") {
      return [];
    }
    const permission: Record<string, unknown> = { ...rawPermission };
    if (!toolName || typeof permission.type !== "string") {
      return [];
    }
    const shellInputRegex = typeof e.shellInputRegex === "string" ? e.shellInputRegex : undefined;
    return [{ toolName, shellInputRegex, permission: { type: permission.type } }];
  });
}

function toTable(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function toTableArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(toTable);
}
