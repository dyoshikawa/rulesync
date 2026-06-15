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
    expect(parsed.tools.bash.allow).toEqual(["git status"]);
    expect(parsed.tools.bash.deny).toEqual(["rm -rf *"]);
    expect(parsed.tools.read_file.permission).toBe("always");
    expect(parsed.disabled_tools).toEqual(["write_file"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pattern-level "ask" rules'));
  });

  it("should import Vibe tool filters and per-tool permissions", () => {
    const fileContent = [
      'enabled_tools = ["read_file"]',
      'disabled_tools = ["write_file"]',
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
      read: { "*": "allow" },
      edit: { "*": "deny" },
      bash: {
        "*": "ask",
        "git status": "allow",
        "rm -rf *": "deny",
      },
    });
  });

  it("should not be deletable because config.toml is shared", () => {
    const vibePermissions = VibePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    });

    expect(vibePermissions.isDeletable()).toBe(false);
  });

  it("should merge edit and write categories to same write_file tool", async () => {
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

    expect(parsed.tools.write_file.allow).toEqual(["*.md", "*.txt"]);
  });

  it("should clear a stale disabled_tools entry when rulesync now allows the tool", async () => {
    await ensureDir(join(testDir, ".vibe"));
    await writeFileContent(
      join(testDir, ".vibe", "config.toml"),
      'disabled_tools = ["write_file"]',
    );

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

    // The stale deny filter must not survive the new "allow" source of truth.
    expect(parsed.disabled_tools).toBeUndefined();
    expect(parsed.enabled_tools).toEqual(["write_file"]);
    expect(parsed.tools.write_file.permission).toBe("always");
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
    expect(parsed.disabled_tools).toEqual(["other_tool", "write_file"]);
  });
});
