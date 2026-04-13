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
});

describe("E2E: permissions (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

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
  });
});

function toTable(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}
