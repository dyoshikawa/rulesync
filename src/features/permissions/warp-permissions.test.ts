import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { WarpPermissions } from "./warp-permissions.js";

const ALLOWLIST_KEY = "agent_mode_command_execution_allowlist";
const DENYLIST_KEY = "agent_mode_command_execution_denylist";

function rulesyncPermissions(
  permission: Record<string, Record<string, string>>,
): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify({ permission }),
  });
}

function profilesOf(tomlContent: string): Record<string, unknown> {
  const parsed = smolToml.parse(tomlContent);
  const agents = isRecord(parsed.agents) ? parsed.agents : {};
  return isRecord(agents.profiles) ? agents.profiles : {};
}

function executionProfilesOf(tomlContent: string): Record<string, unknown> | undefined {
  const parsed = smolToml.parse(tomlContent);
  const agents = isRecord(parsed.agents) ? parsed.agents : {};
  return isRecord(agents.execution_profiles) ? agents.execution_profiles : undefined;
}

describe("WarpPermissions", () => {
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

  describe("getSettablePaths", () => {
    it("targets settings.toml in the platform-specific Warp config dir", () => {
      const paths = WarpPermissions.getSettablePaths();
      expect(paths.relativeFilePath).toBe("settings.toml");
      const expectedDir =
        process.platform === "darwin"
          ? ".warp"
          : process.platform === "win32"
            ? join("AppData", "Local", "warp", "Warp", "config")
            : join(".config", "warp-terminal");
      expect(paths.relativeDirPath).toBe(expectedDir);
    });
  });

  describe("isDeletable", () => {
    it("is never deletable (shared settings.toml)", () => {
      const perms = new WarpPermissions({
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: "",
        validate: false,
      });
      expect(perms.isDeletable()).toBe(false);
    });
  });

  describe("global-only", () => {
    it("fromRulesyncPermissions throws without global", async () => {
      await expect(
        WarpPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ bash: { "git .*": "allow" } }),
          global: false,
        }),
      ).rejects.toThrow(/global-only/);
    });

    it("fromFile throws without global", async () => {
      await expect(
        WarpPermissions.fromFile({ outputRoot: testDir, global: false }),
      ).rejects.toThrow(/global-only/);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("maps bash allow/deny to the agent profile command lists", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git .*": "allow", "ls(\\s.*)?": "allow", "rm -rf .*": "deny" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*", "ls(\\s.*)?"]);
      expect(profiles[DENYLIST_KEY]).toEqual(["rm -rf .*"]);
    });

    it("drops ask rules and skips non-bash categories", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git .*": "allow", "secret .*": "ask" },
          read: { "src/**": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
      expect(profiles[DENYLIST_KEY]).toBeUndefined();
    });

    it("overlays the warp override's file-read/read-only autonomy keys onto agents.profiles", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: {
              agent_mode_coding_permissions: "allow_reading_specific_files",
              agent_mode_coding_file_read_allowlist: ["src/**", "docs/**"],
              agent_mode_execute_readonly_commands: true,
            },
          }),
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
      expect(profiles.agent_mode_coding_permissions).toBe("allow_reading_specific_files");
      expect(profiles.agent_mode_coding_file_read_allowlist).toEqual(["src/**", "docs/**"]);
      expect(profiles.agent_mode_execute_readonly_commands).toBe(true);
    });

    it("passes through forward-compat override keys but keeps rulesync owning the command lists", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: {
              // An unknown future autonomy key must pass through verbatim...
              agent_mode_future_knob: "x",
              // ...but a command list in the override must NOT clobber the
              // rulesync-owned allowlist.
              [ALLOWLIST_KEY]: ["should-be-overwritten"],
            },
          }),
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles.agent_mode_future_knob).toBe("x");
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
    });

    it("lets the warp override win over an existing agents.profiles autonomy value", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.profiles]",
          'agent_mode_coding_permissions = "always_ask_before_reading"',
          "",
        ].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: { agent_mode_coding_permissions: "always_allow_reading" },
          }),
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles.agent_mode_coding_permissions).toBe("always_allow_reading");
    });

    it("preserves other agents.profiles keys and other top-level tables", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.profiles]",
          'agent_mode_coding_permissions = "always_allow_reading"',
          "",
          "[ui]",
          'theme = "dark"',
          "",
        ].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git .*": "allow" } }),
        global: true,
      });

      const parsed = smolToml.parse(perms.getFileContent());
      const profiles = profilesOf(perms.getFileContent());
      expect(profiles.agent_mode_coding_permissions).toBe("always_allow_reading");
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
      expect(isRecord(parsed.ui) && parsed.ui.theme).toBe("dark");
    });

    it("merges the command lists into the default execution profile on a migrated install", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.execution_profiles.default]",
          'name = "Default"',
          'execute_commands = "always_ask"',
          'command_allowlist = ["stale .*"]',
          "",
          "[agents.execution_profiles.code-review]",
          'name = "Code Review"',
          'read_files = "always_allow"',
          "",
        ].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: { "git .*": "allow", "rm -rf .*": "deny" },
        }),
        global: true,
      });

      const executionProfiles = executionProfilesOf(perms.getFileContent());
      expect(executionProfiles).toBeDefined();
      const defaultProfile = executionProfiles?.default as Record<string, unknown>;
      expect(defaultProfile.command_allowlist).toEqual(["git .*"]);
      expect(defaultProfile.command_denylist).toEqual(["rm -rf .*"]);
      // Other keys of the default profile and other profile IDs survive.
      expect(defaultProfile.name).toBe("Default");
      expect(defaultProfile.execute_commands).toBe("always_ask");
      const otherProfile = executionProfiles?.["code-review"] as Record<string, unknown>;
      expect(otherProfile.name).toBe("Code Review");
      expect(otherProfile.read_files).toBe("always_allow");
      // The legacy block is still written for old clients.
      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
      expect(profiles[DENYLIST_KEY]).toEqual(["rm -rf .*"]);
    });

    it("removes stale profile command lists when the rulesync config has none", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.execution_profiles.default]",
          'name = "Default"',
          'command_allowlist = ["stale .*"]',
          'command_denylist = ["stale-deny .*"]',
          "",
        ].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({}),
        global: true,
      });

      const executionProfiles = executionProfilesOf(perms.getFileContent());
      const defaultProfile = executionProfiles?.default as Record<string, unknown>;
      expect(defaultProfile.command_allowlist).toBeUndefined();
      expect(defaultProfile.command_denylist).toBeUndefined();
      expect(defaultProfile.name).toBe("Default");
    });

    it("warns when deny rules are written while non-default execution profiles exist", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.execution_profiles.default]",
          'name = "Default"',
          "",
          "[agents.execution_profiles.code-review]",
          'name = "Code Review"',
          "",
        ].join("\n"),
      );
      const logger = createMockLogger();

      await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "rm -rf .*": "deny" } }),
        logger,
        global: true,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("code-review"));
    });

    it("merges the execution_profile override into the default profile on a migrated install", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        [
          "[agents.execution_profiles.default]",
          'name = "Default"',
          'read_files = "always_ask"',
          "",
        ].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: {
              execution_profile: {
                read_files: "always_allow",
                directory_allowlist: ["/home/me/projects"],
                mcp_denylist: ["untrusted-server"],
                write_to_pty: "always_ask",
              },
            },
          }),
        }),
        global: true,
      });

      const executionProfiles = executionProfilesOf(perms.getFileContent());
      const defaultProfile = executionProfiles?.default as Record<string, unknown>;
      expect(defaultProfile.read_files).toBe("always_allow");
      expect(defaultProfile.directory_allowlist).toEqual(["/home/me/projects"]);
      expect(defaultProfile.mcp_denylist).toEqual(["untrusted-server"]);
      // Forward-compat keys pass through verbatim.
      expect(defaultProfile.write_to_pty).toBe("always_ask");
      // Command lists stay rulesync-owned and other profile keys survive.
      expect(defaultProfile.command_allowlist).toEqual(["git .*"]);
      expect(defaultProfile.name).toBe("Default");
      // The nested block does not leak into the legacy [agents.profiles] table.
      const profiles = profilesOf(perms.getFileContent());
      expect(profiles.execution_profile).toBeUndefined();
      expect(profiles.read_files).toBeUndefined();
    });

    it("keeps rulesync ownership of the command lists over an execution_profile override", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        ["[agents.execution_profiles.default]", 'name = "Default"', ""].join("\n"),
      );

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: {
              execution_profile: { command_allowlist: ["override .*"] },
            },
          }),
        }),
        global: true,
      });

      const executionProfiles = executionProfilesOf(perms.getFileContent());
      const defaultProfile = executionProfiles?.default as Record<string, unknown>;
      expect(defaultProfile.command_allowlist).toEqual(["git .*"]);
    });

    it("warns and skips the execution_profile override on an un-migrated install", async () => {
      const logger = createMockLogger();
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: { execution_profile: { read_files: "always_allow" } },
          }),
        }),
        logger,
        global: true,
      });

      expect(executionProfilesOf(perms.getFileContent())).toBeUndefined();
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("warp.execution_profile"),
        ),
      ).toBe(true);
    });

    it("does not create the execution-profile collection on an un-migrated install", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git .*": "allow" } }),
        global: true,
      });

      // Creating the collection would mark Warp's one-shot migration complete
      // early and strand the user's other legacy settings; the legacy keys are
      // still live on an un-migrated install.
      expect(executionProfilesOf(perms.getFileContent())).toBeUndefined();
      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
    });
  });

  describe("toRulesyncPermissions round-trip", () => {
    it("maps the command lists back to the bash category (denylist wins)", () => {
      const content = [
        "[agents.profiles]",
        `${ALLOWLIST_KEY} = ["git .*", "shared .*"]`,
        `${DENYLIST_KEY} = ["rm -rf .*", "shared .*"]`,
        "",
      ].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
      expect(config.permission.bash["rm -rf .*"]).toBe("deny");
      // A pattern in both lists resolves to deny.
      expect(config.permission.bash["shared .*"]).toBe("deny");
    });

    it("prefers the default execution profile's command lists over stale legacy keys", () => {
      const content = [
        "[agents.profiles]",
        `${ALLOWLIST_KEY} = ["stale .*"]`,
        `${DENYLIST_KEY} = ["stale-deny .*"]`,
        "",
        "[agents.execution_profiles.default]",
        'name = "Default"',
        'command_allowlist = ["git .*"]',
        'command_denylist = ["rm -rf .*"]',
        "",
      ].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
      expect(config.permission.bash["rm -rf .*"]).toBe("deny");
      expect(config.permission.bash["stale .*"]).toBeUndefined();
      expect(config.permission.bash["stale-deny .*"]).toBeUndefined();
    });

    it("falls back to the legacy keys when the collection lacks a default record", () => {
      const content = [
        "[agents.profiles]",
        `${ALLOWLIST_KEY} = ["git .*"]`,
        "",
        "[agents.execution_profiles.code-review]",
        'name = "Code Review"',
        "",
      ].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
    });

    it("falls back to the legacy keys when no execution-profile collection exists", () => {
      const content = ["[agents.profiles]", `${ALLOWLIST_KEY} = ["git .*"]`, ""].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
    });

    it("lifts the file-read/read-only autonomy keys into the warp override", () => {
      const content = [
        "[agents.profiles]",
        `${ALLOWLIST_KEY} = ["git .*"]`,
        'agent_mode_coding_permissions = "allow_reading_specific_files"',
        'agent_mode_coding_file_read_allowlist = ["src/**", "docs/**"]',
        "agent_mode_execute_readonly_commands = true",
        "",
      ].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
      expect(config.warp).toEqual({
        agent_mode_coding_permissions: "allow_reading_specific_files",
        agent_mode_coding_file_read_allowlist: ["src/**", "docs/**"],
        agent_mode_execute_readonly_commands: true,
      });
    });

    it("round-trips the warp override through export and re-import", async () => {
      const original = new RulesyncPermissions({
        relativeDirPath: ".rulesync",
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify({
          permission: { bash: { "git .*": "allow" } },
          warp: {
            agent_mode_coding_permissions: "always_allow_reading",
            agent_mode_execute_readonly_commands: true,
          },
        }),
      });

      const exported = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
        global: true,
      });

      const reimported = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: exported.getFileContent(),
      });

      const config = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
      expect(config.warp).toEqual({
        agent_mode_coding_permissions: "always_allow_reading",
        agent_mode_execute_readonly_commands: true,
      });
    });

    it("lifts the default profile's autonomy keys into the execution_profile override", () => {
      const content = [
        "[agents.execution_profiles.default]",
        'name = "Default"',
        'read_files = "always_allow"',
        'execute_commands = "agent_decides"',
        'directory_allowlist = ["/home/me/projects"]',
        'mcp_denylist = ["untrusted-server"]',
        'command_allowlist = ["git .*"]',
        "",
      ].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });

      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["git .*"]).toBe("allow");
      expect(config.warp.execution_profile).toEqual({
        read_files: "always_allow",
        execute_commands: "agent_decides",
        directory_allowlist: ["/home/me/projects"],
        mcp_denylist: ["untrusted-server"],
      });
      // Profile-management keys are not permissions and are not lifted.
      expect(config.warp.execution_profile.name).toBeUndefined();
    });

    it("round-trips the execution_profile override through export and re-import", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        ["[agents.execution_profiles.default]", 'name = "Default"', ""].join("\n"),
      );

      const exported = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: {
              execution_profile: {
                read_files: "always_allow",
                mcp_allowlist: ["trusted-server"],
              },
            },
          }),
        }),
        global: true,
      });

      const reimported = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: exported.getFileContent(),
      });

      const config = JSON.parse(reimported.toRulesyncPermissions().getFileContent());
      expect(config.warp.execution_profile).toEqual({
        read_files: "always_allow",
        mcp_allowlist: ["trusted-server"],
      });
    });

    it("omits the warp override when no autonomy keys are present", () => {
      const content = ["[agents.profiles]", `${ALLOWLIST_KEY} = ["git .*"]`, ""].join("\n");
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: content,
      });
      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.warp).toBeUndefined();
    });

    it("returns an empty permission set when there are no command lists", () => {
      const perms = new WarpPermissions({
        outputRoot: testDir,
        relativeDirPath: ".config/warp-terminal",
        relativeFilePath: "settings.toml",
        fileContent: '[ui]\ntheme = "dark"\n',
      });
      const config = JSON.parse(perms.toRulesyncPermissions().getFileContent());
      expect(config.permission).toEqual({});
    });
  });
});
