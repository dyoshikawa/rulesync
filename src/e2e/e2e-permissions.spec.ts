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

  it("should generate geminicli permissions into .gemini/settings.json", async () => {
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

    const content = JSON.parse(await readFileContent(join(testDir, ".gemini", "settings.json")));
    expect(content.tools.allowed).toContain("run_shell_command(git *)");
    expect(content.tools.allowed).toContain("read_file(src/**)");
    expect(content.tools.exclude).toContain("run_shell_command(rm *)");
    expect(content.tools.exclude).toContain("web_fetch(example.com)");
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
      join(testDir, ".gemini", "settings.json"),
      JSON.stringify(
        {
          tools: {
            allowed: ["run_shell_command(git *)", "read_file(src/**)"],
            exclude: ["run_shell_command(rm *)", "web_fetch(example.com)"],
          },
        },
        null,
        2,
      ),
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

    const generated = JSON.parse(await readFileContent(join(homeDir, ".gemini", "settings.json")));
    expect(generated.tools.allowed).toContain("run_shell_command(git status *)");
    expect(generated.tools.exclude).toContain("read_file(src/**)");
  });
});

function toTable(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}
