import { join } from "node:path";

import { load } from "js-yaml";
import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_SCHEMA_URL,
} from "../constants/rulesync-paths.js";
import { getZedGlobalDir } from "../constants/zed-paths.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

// Permissions targets exercised by the project-scope generate `it`s below. Each
// tool has a bespoke serialization, so tests stay hand-written rather than
// table-driven; this explicit list feeds the completeness check. Note the check
// only enforces that this enumeration matches the processor's declared target
// set — it does NOT verify that a dedicated `it` body exists for each name, so a
// tool's `it` could be deleted while its name lingers here and the check stays
// green. Keep this list in sync with the actual `it`s by hand.
const permissionsGenerateTargets = [
  "opencode",
  "zed",
  "amp",
  "devin",
  "codexcli",
  "cursor",
  "copilot",
  "kiro",
  "kiro-cli",
  "kiro-ide",
  "kilo",
  "antigravity-ide",
  "augmentcode",
  "cline",
  "factorydroid",
  "qwencode",
  "vibe",
  "reasonix",
  "grokcli",
  "takt",
  "claudecode",
  "rovodev",
] as const;

// Permissions targets exercised by the global-scope generate `it`s below.
const permissionsGlobalTargets = [
  "claudecode",
  "opencode",
  "codexcli",
  "cursor",
  "kilo",
  "augmentcode",
  "qwencode",
  "antigravity-cli",
  "warp",
  "zed",
  "amp",
  "vibe",
  "rovodev",
  "goose",
  "grokcli",
  "takt",
  "hermesagent",
  "kimi-code",
  "reasonix",
  "devin",
  "factorydroid",
  "junie",
] as const;

describe("E2E: permissions", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native permissions tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: PermissionsProcessor,
      testedTargets: permissionsGenerateTargets,
    });
  });

  it.each([
    { target: "antigravity-ide", relativePaths: [[".antigravity", "settings.json"]] },
    { target: "factorydroid", relativePaths: [[".factory", "settings.json"]] },
    { target: "copilot", relativePaths: [[".vscode", "settings.json"]] },
    // opencode writes the `.jsonc` twin when neither file exists yet, so both
    // spellings must stay absent.
    { target: "opencode", relativePaths: [["opencode.json"], ["opencode.jsonc"]] },
  ])(
    "should not create the shared $target config file when the permissions payload is empty",
    async ({ target, relativePaths }) => {
      const testDir = getTestDir();

      // A permissions file whose categories map to nothing this tool models, so
      // the merge payload for the shared config file comes out empty. These
      // paths are deliberately not gitignored, so creating them would leave
      // untracked files with no content behind after every generate.
      await writeFileContent(
        join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
        JSON.stringify({ permission: {} }, null, 2),
      );

      await runGenerate({ target, features: "permissions" });

      for (const relativePath of relativePaths) {
        expect(await fileExists(join(testDir, ...relativePath))).toBe(false);
      }
    },
  );

  it("should generate rovodev permissions into the repo-committed .rovodev/config.yml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({ permission: { bash: { "*": "ask", "git status": "allow" } } }, null, 2),
    );

    await runGenerate({ target: "rovodev", features: "permissions" });

    const content = await readFileContent(join(testDir, ".rovodev", "config.yml"));
    expect(content).toContain("toolPermissions");
    expect(content).toContain("default: ask");
  });

  it("should generate claudecode permissions into .claude/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow", "rm *": "deny" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "claudecode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".claude", "settings.json")));
    expect(content.permissions.allow).toContain("Bash(git status *)");
    expect(content.permissions.deny).toContain("Bash(rm *)");
    expect(content.permissions.deny).toContain("Read(.env)");
  });

  it.each([{ target: "kiro-cli" }, { target: "kiro-ide" }])(
    "should generate $target permissions into .kiro/agents/default.json",
    async ({ target }) => {
      const testDir = getTestDir();

      await writeFileContent(
        join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
        JSON.stringify(
          {
            permission: {
              bash: { "git *": "allow", "rm *": "deny" },
              read: { "src/**": "allow" },
            },
          },
          null,
          2,
        ),
      );

      // kiro-cli and kiro-ide reuse the same .kiro/agents/default.json format as
      // the kiro alias.
      await runGenerate({ target, features: "permissions" });

      const content = JSON.parse(
        await readFileContent(join(testDir, ".kiro", "agents", "default.json")),
      );
      expect(content.toolsSettings.shell.allowedCommands).toContain("git *");
      expect(content.toolsSettings.shell.deniedCommands).toContain("rm *");
      expect(content.toolsSettings.read.allowedPaths).toContain("src/**");
    },
  );

  it("should generate opencode permissions from .rulesync/permissions.jsonc", async () => {
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

  it("should apply a tool-scoped {toolname}.permission block only to that tool", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow" },
            read: { ".env": "deny" },
          },
          claudecode: {
            // Replaces the shared `bash` category for Claude Code only.
            permission: { bash: { "rm *": "deny" } },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "claudecode", features: "permissions" });
    await runGenerate({ target: "zed", features: "permissions" });

    // Claude Code sees the tool-scoped bash category (replaced wholesale)
    // plus the untouched shared read category.
    const claude = JSON.parse(await readFileContent(join(testDir, ".claude", "settings.json")));
    expect(claude.permissions.deny).toContain("Bash(rm *)");
    expect(claude.permissions.deny).toContain("Read(.env)");
    expect(claude.permissions.allow ?? []).not.toContain("Bash(git *)");

    // Zed still sees the shared bash category.
    const zed = JSON.parse(await readFileContent(join(testDir, ".zed", "settings.json")));
    expect(zed.agent.tool_permissions.tools.terminal.always_allow).toEqual([
      { pattern: "git *", case_sensitive: false },
    ]);
  });

  it("should generate permissions from permissions.jsonc (preferred over permissions.json)", async () => {
    const testDir = getTestDir();

    // The stale .json variant must lose to the .jsonc variant.
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH),
      JSON.stringify({ permission: { bash: { "npm *": "allow" } } }),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      `{
        // JSONC source with comments and trailing commas
        "permission": {
          "bash": { "git *": "allow", },
        },
      }`,
    );

    await runGenerate({ target: "claudecode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".claude", "settings.json")));
    expect(content.permissions.allow).toContain("Bash(git *)");
    expect(content.permissions.allow).not.toContain("Bash(npm *)");
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

  it("should generate devin permissions into .devin/config.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            read: { "src/**": "allow" },
            write: { "*.lock": "deny" },
            bash: { git: "allow", "rm *": "deny", "*": "ask" },
            webfetch: { "https://api.github.com/*": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "devin", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, ".devin", "config.json")));
    // Canonical categories map to Devin scope matchers; `*` collapses to the bare scope.
    expect(content.permissions.allow).toContain("Read(src/**)");
    expect(content.permissions.allow).toContain("Exec(git)");
    expect(content.permissions.allow).toContain("Fetch(https://api.github.com/*)");
    expect(content.permissions.deny).toContain("Write(*.lock)");
    expect(content.permissions.deny).toContain("Exec(rm *)");
    expect(content.permissions.ask).toContain("Exec");
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
    expect(table.approval_policy).toBe("on-request");
    expect(table.approvals_reviewer).toBe("auto_review");
    const permissions = toTable(table.permissions);
    const rulesyncProfile = toTable(permissions.rulesync);
    expect(rulesyncProfile.extends).toBe(":workspace");
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
    // Default `.git` carve-out (suppressed only by codexcli.git_write_rules: false).
    expect(workspaceRoots[".git/**"]).toBe("write");
    expect(workspaceRoots[".git/config"]).toBeUndefined();
    expect(domains["github.com"]).toBe("allow");

    const rulesContent = await readFileContent(join(testDir, ".codex", "rules", "rulesync.rules"));
    expect(rulesContent).toContain('pattern = ["git", "status"]');
    expect(rulesContent).toContain('decision = "allow"');
    expect(rulesContent).toContain('pattern = ["npm", "publish"]');
    expect(rulesContent).toContain('decision = "prompt"');
    expect(rulesContent).toContain('pattern = ["rm", "-rf"]');
    expect(rulesContent).toContain('decision = "forbidden"');
  });

  it("should generate Codex-only settings from JSONC when shared permissions are empty", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      `model = "gpt-5"

[features]
web_search_request = true
`,
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      `{
  "$schema": "${RULESYNC_PERMISSIONS_SCHEMA_URL}",
  "permission": {},
  "codexcli": {
    "base_permission_profile": ":danger-full-access",
    "approvals_reviewer": "auto_review",
    "approval_policy": "on-request",
  }
}
`,
    );

    await runGenerate({ target: "codexcli", features: "permissions" });

    const parsed = smolToml.parse(await readFileContent(join(testDir, ".codex", "config.toml")));
    const table = toTable(parsed);
    expect(table.default_permissions).toBe(":danger-full-access");
    expect(table.approval_policy).toBe("on-request");
    expect(table.approvals_reviewer).toBe("auto_review");
    expect(table.model).toBe("gpt-5");
    expect(toTable(table.features).web_search_request).toBe(true);
    expect(table.permissions).toBeUndefined();
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

  it("should generate copilot permissions into .vscode/settings.json", async () => {
    const testDir = getTestDir();

    // Pre-existing unrelated VS Code settings must survive the merge.
    await writeFileContent(
      join(testDir, ".vscode", "settings.json"),
      JSON.stringify({ "editor.tabSize": 2 }, null, 2),
    );

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm -rf *": "deny", "npm *": "ask" },
            // Non-terminal categories have no autoApprove representation.
            read: { "src/**": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "copilot", features: "permissions" });

    const generated = JSON.parse(await readFileContent(join(testDir, ".vscode", "settings.json")));
    expect(generated["chat.tools.terminal.autoApprove"]).toEqual({
      "git *": true,
      "rm -rf *": false,
    });
    expect(generated["editor.tabSize"]).toBe(2);
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

  it("should import antigravity-ide permissions into .rulesync/permissions.jsonc", async () => {
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
    // The canonical `edit` category targets Vibe's `edit` tool; `write_file` is
    // a separate, create-only tool.
    expect(parsed.disabled_tools).toContain("edit");
  });

  it("should generate reasonix permissions into reasonix.toml and preserve MCP plugins", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "reasonix.toml"),
      [
        'default_model = "deepseek"',
        "",
        "[[plugins]]",
        'name = "filesystem"',
        'command = "npx"',
      ].join("\n"),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow", "rm -rf *": "deny" },
            edit: { "docs/**": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "reasonix", features: "permissions" });

    const parsed = toTable(smolToml.parse(await readFileContent(join(testDir, "reasonix.toml"))));
    const permissions = toTable(parsed.permissions);
    expect(permissions.allow).toContain("Bash(git *)");
    expect(permissions.allow).toContain("Edit(docs/**)");
    expect(permissions.ask).toContain("Bash");
    expect(permissions.deny).toContain("Bash(rm -rf *)");
    // The MCP [[plugins]] table (written by the MCP adapter) must survive.
    expect(toTableArray(parsed.plugins)).toMatchObject([{ name: "filesystem", command: "npx" }]);
    expect(parsed.default_model).toBe("deepseek");
  });

  it("should generate grokcli permissions into .grok/config.toml and preserve MCP config", async () => {
    const testDir = getTestDir();

    // Pre-seed the project config.toml with an [mcp_servers] table (written by
    // the MCP adapter) to verify the fine-grained [permission] arrays coexist
    // with it in the same shared file without clobbering.
    await writeFileContent(
      join(testDir, ".grok", "config.toml"),
      ["[mcp_servers.example]", 'command = "echo"'].join("\n"),
    );
    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { "src/**": "ask" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "grokcli", features: "permissions" });

    const parsed = toTable(
      smolToml.parse(await readFileContent(join(testDir, ".grok", "config.toml"))),
    );
    const permission = toTable(parsed.permission);
    expect(permission.allow).toContain("Bash(git *)");
    expect(permission.deny).toContain("Bash(rm *)");
    expect(permission.ask).toContain("Read(src/**)");
    // The coarse [ui] permission_mode is a user-level UI toggle, so it is not
    // written in project scope (Grok limits project configs to MCP servers,
    // plugins, and permission rules).
    expect(parsed.ui).toBeUndefined();
    // The MCP [mcp_servers] table (written by the MCP adapter) must survive.
    expect(toTable(toTable(parsed.mcp_servers).example).command).toBe("echo");
  });

  it("should import reasonix permissions from reasonix.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "reasonix.toml"),
      [
        "[permissions]",
        'allow = ["Bash(git *)", "Edit(docs/**)"]',
        'deny = ["Bash(rm -rf *)"]',
      ].join("\n"),
    );

    await runImport({ target: "reasonix", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["rm -rf *"]).toBe("deny");
    expect(content.permission.edit["docs/**"]).toBe("allow");
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

  it("should import takt permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import opencode permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import zed permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import amp permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import codexcli permissions into .rulesync/permissions.jsonc", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync]
extends = ":read-only"

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
    expect(content.codexcli.base_permission_profile).toBe(":read-only");
  });

  it("should narrow the kilo sandbox block to tighten-only keys at project scope", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {},
        kilo: {
          sandbox: { enabled: true, network: "deny", allowed_hosts: ["example.com"] },
        },
      }),
    );

    await runGenerate({ target: "kilo", features: "permissions" });

    // `allowed_hosts` is honored from the global config only, so a project
    // config that states it would be config Kilo ignores.
    const content = JSON.parse(await readFileContent(join(testDir, "kilo.jsonc")));
    expect(content.sandbox).toEqual({ enabled: true, network: "deny" });
  });

  it("should import kilo permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import augmentcode permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import cline permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import qwencode permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import kiro permissions into .rulesync/permissions.jsonc", async () => {
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

  it("should import vibe permissions into .rulesync/permissions.jsonc", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      [
        'enabled_tools = ["read_file"]',
        'disabled_tools = ["edit"]',
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
    // `enabled_tools` is Vibe's exclusive allowlist, so it round-trips through
    // the vibe override instead of importing as `"*": "allow"` grants.
    expect(content.permission.read).toBeUndefined();
    expect(content.vibe.enabled_tools).toEqual(["read_file"]);
    expect(content.permission.edit["*"]).toBe("deny");
    expect(content.permission.bash["*"]).toBe("ask");
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["rm *"]).toBe("deny");
  });

  it("should import copilot permissions into .rulesync/permissions.jsonc", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vscode", "settings.json"),
      JSON.stringify(
        {
          "editor.tabSize": 2,
          "chat.tools.terminal.autoApprove": { "git *": true, "rm -rf *": false },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "copilot", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.bash["rm -rf *"]).toBe("deny");
  });
});

describe("E2E: permissions (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("global matrix must cover every native global permissions tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: PermissionsProcessor,
      testedTargets: permissionsGlobalTargets,
      global: true,
    });
  });

  it.each([
    { target: "devin", outputPath: join(".config", "devin", "config.json") },
    { target: "factorydroid", outputPath: join(".factory", "settings.json") },
    { target: "junie", outputPath: join(".junie", "allowlist.json") },
  ])(
    "should generate $target permissions in home directory with --global",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

      await writeFileContent(
        join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
        JSON.stringify(
          {
            root: true,
            permission: {
              bash: { "git status *": "allow", "rm *": "deny" },
            },
          },
          null,
          2,
        ),
      );

      await runGenerate({
        target,
        features: "permissions",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      // Event mapping/serialization differs per tool, so assert the canonical
      // command patterns survive somewhere in the generated file.
      const generated = await readFileContent(join(homeDir, outputPath));
      expect(generated).toContain("git status *");
      expect(generated).toContain("rm *");
    },
  );

  it("should generate junie permissions as AllowListRuleSet objects (global-only)", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git ": "allow", "rm *": "deny" },
            edit: { "src/**": "allow" },
          },
          junie: {
            ruleDefaults: { executables: "ask" },
            readSecretFile: { rules: [{ pattern: "**/.env", action: "ask" }] },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "junie",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const content = JSON.parse(await readFileContent(join(homeDir, ".junie", "allowlist.json")));
    // Every rule group is Junie's AllowListRuleSet object ({ default?, rules }),
    // never a bare array — Junie rejects the array form for the whole file.
    // Canonical deny downgrades to ask (Junie has no deny).
    expect(content.rules.executables).toEqual({
      default: "ask",
      rules: [
        { prefix: "git ", action: "allow" },
        { pattern: "rm *", action: "ask" },
      ],
    });
    expect(content.rules.fileEditing).toEqual({ rules: [{ pattern: "src/**", action: "allow" }] });
    expect(content.rules.readSecretFile).toEqual({
      rules: [{ pattern: "**/.env", action: "ask" }],
    });
  });

  it("should generate Kimi Code permissions in the shared user config", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {
          bash: { "git status *": "allow", "rm *": "deny" },
          read: { "*": "allow" },
        },
        "kimi-code": {
          defaultPermissionMode: "manual",
        },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(generated.default_permission_mode).toBe("manual");
    expect(generated.permission).toEqual({
      rules: [
        { decision: "deny", pattern: "Bash(rm *)", scope: "user" },
        { decision: "allow", pattern: "Bash(git status *)", scope: "user" },
        { decision: "allow", pattern: "Read", scope: "user" },
      ],
    });
  });

  it("should generate and import the Kimi Code global tool switch", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // `[tools]` is a second enforcement layer beside `[[permission.rules]]`: a
    // rule prompts, this removes the tool from every agent in every session.
    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: { bash: { "git status *": "allow" } },
        "kimi-code": {
          tools: { enabled: ["Bash", "Read"], disabled: ["mcp__github__*"] },
        },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(generated.tools).toEqual({ enabled: ["Bash", "Read"], disabled: ["mcp__github__*"] });

    await runImport({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(imported["kimi-code"].tools).toEqual({
      enabled: ["Bash", "Read"],
      disabled: ["mcp__github__*"],
    });
  });

  it("should keep Kimi Code permission rules fail-closed and avoid broadening MCP grants", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {
          bash: { "*": "allow", "rm -rf *": "deny" },
          mcp: { "*": "allow" },
          mcp__github__create_issue: {
            "safe-input-*": "allow",
            "dangerous-input-*": "deny",
            "*": "ask",
          },
        },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(generated.permission).toEqual({
      rules: [
        { decision: "deny", pattern: "Bash(rm -rf *)", scope: "user" },
        { decision: "deny", pattern: "mcp__github__create_issue", scope: "user" },
        { decision: "ask", pattern: "mcp__github__create_issue", scope: "user" },
        { decision: "allow", pattern: "Bash", scope: "user" },
        { decision: "allow", pattern: "mcp__*", scope: "user" },
      ],
    });
  });

  it("should import Kimi Code permissions from the shared user config", async () => {
    const homeDir = getHomeDir();

    await writeFileContent(
      join(homeDir, ".kimi-code", "config.toml"),
      [
        'default_permission_mode = "auto"',
        "",
        "[[permission.rules]]",
        'decision = "allow"',
        'pattern = "Bash(git *)"',
        "",
        "[[permission.rules]]",
        'decision = "deny"',
        'pattern = "CustomTool"',
        'scope = "project"',
        'reason = "Project policy"',
      ].join("\n"),
    );

    await runImport({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(imported.permission).toEqual({});
    expect(imported["kimi-code"]).toEqual({
      defaultPermissionMode: "auto",
      rules: [
        {
          decision: "allow",
          pattern: "Bash(git *)",
        },
        {
          decision: "deny",
          pattern: "CustomTool",
          scope: "project",
          reason: "Project policy",
        },
      ],
    });

    await runGenerate({
      target: "kimi-code",
      features: "permissions",
      global: true,
      inputRoot: homeDir,
      env: { HOME_DIR: homeDir },
    });
    const regenerated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(regenerated.permission).toEqual({
      rules: [
        { decision: "allow", pattern: "Bash(git *)" },
        {
          decision: "deny",
          pattern: "CustomTool",
          scope: "project",
          reason: "Project policy",
        },
      ],
    });
  });

  it("should preserve fully canonical Kimi Code permission order on import", async () => {
    const homeDir = getHomeDir();

    await writeFileContent(
      join(homeDir, ".kimi-code", "config.toml"),
      [
        "[[permission.rules]]",
        'decision = "deny"',
        'pattern = "Bash(git *)"',
        "",
        "[[permission.rules]]",
        'decision = "allow"',
        'pattern = "Bash(git status *)"',
      ].join("\n"),
    );

    await runImport({
      target: "kimi-code",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(imported.permission).toEqual({});
    expect(imported["kimi-code"]).toEqual({
      rules: [
        { decision: "deny", pattern: "Bash(git *)" },
        { decision: "allow", pattern: "Bash(git status *)" },
      ],
    });

    await runGenerate({
      target: "kimi-code",
      features: "permissions",
      global: true,
      inputRoot: homeDir,
      env: { HOME_DIR: homeDir },
    });

    const regenerated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(regenerated.permission).toEqual({
      rules: [
        { decision: "deny", pattern: "Bash(git *)" },
        { decision: "allow", pattern: "Bash(git status *)" },
      ],
    });
  });

  it("should merge Kimi Code hooks and permissions without clobbering user config", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(join(homeDir, ".kimi-code", "config.toml"), "telemetry = false\n");
    await writeFileContent(
      join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "Bash", command: "security-check" }],
        },
      }),
    );
    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {
          bash: { "git *": "allow" },
        },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "hooks,permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    );
    expect(generated.telemetry).toBe(false);
    expect(generated.hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash",
        command: expect.stringContaining("security-check"),
      },
    ]);
    expect((generated.hooks as Array<{ command: string }>)[0]?.command).toContain(projectDir);
    expect(generated.permission).toEqual({
      rules: [{ decision: "allow", pattern: "Bash(git *)", scope: "user" }],
    });
  });

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

  it("should write every kilo sandbox key with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify({
        permission: {},
        kilo: {
          sandbox: {
            enabled: true,
            network: "deny",
            allowed_hosts: ["example.com:443"],
            writable_paths: ["/tmp"],
          },
        },
      }),
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
    expect(generated.sandbox).toEqual({
      enabled: true,
      network: "deny",
      allowed_hosts: ["example.com:443"],
      writable_paths: ["/tmp"],
    });
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
      join(homeDir, getZedGlobalDir(), "settings.json"),
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
      await readFileContent(join(homeDir, getZedGlobalDir(), "settings.json")),
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
    expect(parsed.disabled_tools).toContain("edit");
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
    // `read` -> inspection tools, `edit` -> mutation tools, nested under
    // `toolPermissions.tools` where Rovo Dev reads them.
    const tools = toTable(toolPermissions.tools);
    expect(tools.open_files).toBe("allow");
    expect(tools.create_file).toBe("deny");
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
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
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
    const parsed = toTable(
      load(await readFileContent(join(homeDir, getHermesagentGlobalDir(), "config.yaml"))),
    );
    expect(parsed.command_allowlist).toEqual(["git status *"]);
    // The bash deny reaches Hermes's hard denylist (previously silently dropped).
    expect(toTable(parsed.approvals).deny).toEqual(["rm -rf *"]);
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

  it("should import native Hermes permission settings without private provenance", async () => {
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
      [
        "model: hermes-large",
        'command_allowlist: ["git *", "pnpm *"]',
        "approvals:",
        '  deny: ["rm -rf *"]',
        "  mode: smart",
        "security:",
        "  allow_private_urls: false",
        "  website_blocklist:",
        "    enabled: true",
        "    domains: [evil.example.com]",
        "skills:",
        "  write_approval: true",
        "memory:",
        "  write_approval: false",
      ].join("\n"),
    );

    await runImport({
      target: "hermesagent",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(imported.permission).toEqual({
      bash: {
        "git *": "allow",
        "pnpm *": "allow",
        "rm -rf *": "deny",
      },
      webfetch: { "evil.example.com": "deny" },
    });
    expect(imported.hermes).toEqual({
      approvals: { mode: "smart" },
      security: { allow_private_urls: false },
      skills: { write_approval: true },
      memory: { write_approval: false },
    });
    expect(imported.model).toBeUndefined();
  });

  it("should generate reasonix permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          root: true,
          permission: {
            bash: { "git status *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    // Pre-seed ~/.reasonix/config.toml with the MCP [[plugins]] table to verify
    // the non-destructive merge into the shared global config.
    await writeFileContent(
      join(homeDir, ".reasonix", "config.toml"),
      ["[[plugins]]", 'name = "existing"', 'command = "node"'].join("\n"),
    );

    await runGenerate({
      target: "reasonix",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = toTable(
      smolToml.parse(await readFileContent(join(homeDir, ".reasonix", "config.toml"))),
    );
    const permissions = toTable(parsed.permissions);
    expect(permissions.allow).toContain("Bash(git status *)");
    expect(permissions.deny).toContain("Read(.env)");
    expect(toTableArray(parsed.plugins)).toMatchObject([{ name: "existing", command: "node" }]);
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
