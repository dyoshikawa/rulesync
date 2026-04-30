import { join } from "node:path";

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

  it("should generate codexcli permissions into .codex/config.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status": "allow", "npm publish": "ask", "rm -rf": "deny" },
            read: { "/workspace/project/**": "allow", "/workspace/project/.env": "deny" },
            write: { "/workspace/project/src/**": "allow" },
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
    expect(filesystem["/workspace/project/**"]).toBe("read");
    expect(filesystem["/workspace/project/src/**"]).toBe("write");
    expect(domains["github.com"]).toBe("allow");

    const rulesContent = await readFileContent(join(testDir, ".codex", "rules", "rulesync.rules"));
    expect(rulesContent).toContain('pattern = ["git", "status"]');
    expect(rulesContent).toContain('decision = "allow"');
    expect(rulesContent).toContain('pattern = ["npm", "publish"]');
    expect(rulesContent).toContain('decision = "prompt"');
    expect(rulesContent).toContain('pattern = ["rm", "-rf"]');
    expect(rulesContent).toContain('decision = "forbidden"');
  });

  it("should generate geminicli permissions into .gemini/policies/rulesync.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git *": "allow", "rm *": "deny" },
            read: { "src/**": "allow" },
            webfetch: { "example.com": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "geminicli", features: "permissions" });

    const policyContent = await readFileContent(
      join(testDir, ".gemini", "policies", "rulesync.toml"),
    );
    expect(policyContent).toContain('toolName = "run_shell_command"');
    expect(policyContent).toContain('commandPrefix = "git"');
    expect(policyContent).toContain('decision = "deny"');
    expect(policyContent).toContain('toolName = "web_fetch"');
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

  it("should import codexcli permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".codex", "config.toml"),
      `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
"/workspace/project/**" = "read"
"/workspace/project/src/**" = "write"
"/workspace/project/.env" = "none"

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

  it("should import geminicli permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".gemini", "policies", "rulesync.toml"),
      [
        "[[rule]]",
        'toolName = "run_shell_command"',
        'decision = "allow"',
        'commandPrefix = "git"',
        "priority = 100",
        "",
        "[[rule]]",
        'toolName = "read_file"',
        'decision = "allow"',
        'argsPattern = "src/.*"',
        "priority = 100",
        "",
        "[[rule]]",
        'toolName = "run_shell_command"',
        'decision = "deny"',
        'commandPrefix = "rm"',
        "priority = 100",
        "",
        "[[rule]]",
        'toolName = "web_fetch"',
        'decision = "deny"',
        'argsPattern = "example\\\\.com"',
        "priority = 100",
        "",
      ].join("\n"),
    );

    await runImport({ target: "geminicli", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read["src/**"]).toBe("allow");
    expect(content.permission.bash["rm *"]).toBe("deny");
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

  it("should generate geminicli permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "git status *": "allow" },
            read: { "src/**": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "geminicli",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const policyContent = await readFileContent(
      join(homeDir, ".gemini", "policies", "rulesync.toml"),
    );
    expect(policyContent).toContain('toolName = "run_shell_command"');
    expect(policyContent).toContain('commandPrefix = "git status"');
    expect(policyContent).toContain('decision = "allow"');
    expect(policyContent).toContain('toolName = "read_file"');
    expect(policyContent).toContain('decision = "deny"');
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
