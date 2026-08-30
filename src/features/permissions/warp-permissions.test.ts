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
          // Anchored, so the `ask` and the `allow` name disjoint commands —
          // an unanchored regex matches anywhere and would overlap both ways.
          bash: { "^git .*$": "allow", "^secret .*$": "ask" },
          read: { "src/**": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
      expect(profiles[DENYLIST_KEY]).toBeUndefined();
    });

    it("withholds the bash allow an all-tools deny blocks, without touching the denylist", async () => {
      const logger = createMockLogger();

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          // A pattern under `*` is canonical, so it is written as a glob even
          // for a tool whose own patterns are regexes.
          "*": { "rm -rf *": "deny" },
          bash: { "^rm -rf .*$": "allow", "^git .*$": "allow" },
        }),
        logger,
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      // Writing any denylist replaces Warp's built-in default one, so an
      // all-tools pattern — which need not name a command at all — withholds
      // the allow it covers instead of being written there.
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
      expect(profiles[DENYLIST_KEY]).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("did not write the all-tools '*' deny rule(s) for rm -rf *"),
      );
    });

    it("withholds a regex allow the all-tools deny covers", async () => {
      const logger = createMockLogger();

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { rm: "deny" },
          // `.*` is Warp's catch-all, not a literal dot beside a wildcard, so
          // the restriction covers it however narrowly the deny is spelled.
          bash: { ".*": "allow" },
        }),
        logger,
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the allow rule(s) for .*"),
      );
    });

    it("withholds an allow that a wider unanchored ask covers", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          // An unanchored regex matches anywhere in the command, so `^npm `
          // covers `^npm publish` even though neither glob covers the other.
          bash: { "^npm ": "ask", "^npm publish": "allow", "^git .*$": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
    });

    it("withholds an allow the character class in a restriction spells out", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          // `[rf]` is a class Warp expands, not the four characters a glob
          // reads, so the ask reaches `rm -r` however differently it is spelled.
          bash: { "^rm -[rf]$": "ask", "^rm -r$": "allow", "^git .*$": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
      expect(profiles[DENYLIST_KEY]).toBeUndefined();
    });

    it("withholds an allow a group, a quantifier or a character escape reaches", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          bash: {
            // Each restriction covers the allow under it: an alternation, an
            // optional group, an optional letter and `\s+` all stand for text
            // the allow spells differently.
            "^(git|npm) publish$": "ask",
            "^(sudo )?shutdown$": "ask",
            "^git commits?$": "ask",
            "^npm\\s+install$": "ask",
            "^npm publish$": "allow",
            "^shutdown$": "allow",
            "^git commit$": "allow",
            "^npm install$": "allow",
            "^ls -la$": "allow",
          },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^ls -la$"]);
    });

    it("reports the all-tools allow rules it read past", async () => {
      const logger = createMockLogger();

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "git .*": "allow" },
          bash: { "ls .*": "allow" },
        }),
        logger,
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["ls .*"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("deny and ask rules only"));
    });

    it("keeps Warp's built-in denylist when only the all-tools category denies", async () => {
      const logger = createMockLogger();

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "secrets/**": "deny" },
          bash: { "^git .*$": "allow" },
        }),
        logger,
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      // `secrets/**` matches no command and is not even a valid regex; writing
      // it would trade Warp's built-in denylist for an inert entry.
      expect(profiles[DENYLIST_KEY]).toBeUndefined();
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("built-in default denylist"),
      );
    });

    it("withholds a bash allow that the all-tools category asks about", async () => {
      const logger = createMockLogger();

      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "npm *": "ask" },
          bash: { "^npm .*$": "allow", "^git .*$": "allow" },
        }),
        logger,
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git .*$"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("^npm .*$"));
    });

    it("reads an all-tools pattern as the glob it is, not as a Warp regex", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          // Widening `secrets/**` as if it were an unanchored regex would make
          // it cover every command that merely mentions `secrets`.
          "*": { "secrets/**": "deny" },
          bash: { "^git secrets --scan$": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["^git secrets --scan$"]);
    });

    it("ignores the all-tools category's allow rules", async () => {
      const perms = await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          "*": { "src/**": "allow" },
          bash: { "git .*": "allow" },
        }),
        global: true,
      });

      const profiles = profilesOf(perms.getFileContent());
      expect(profiles[ALLOWLIST_KEY]).toEqual(["git .*"]);
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

    it("warns that a written denylist replaces Warp's built-in default denylist", async () => {
      const logger = createMockLogger();

      await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "rm -rf .*": "deny" } }),
        logger,
        global: true,
      });

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("replaces its built-in default denylist"),
        ),
      ).toBe(true);
    });

    it("does not warn about the built-in denylist when no deny rule is written", async () => {
      const logger = createMockLogger();

      await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ bash: { "git .*": "allow" } }),
        logger,
        global: true,
      });

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("replaces its built-in default denylist"),
        ),
      ).toBe(false);
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
                some_future_autonomy_key: "always_ask",
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
      expect(defaultProfile.some_future_autonomy_key).toBe("always_ask");
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

    it("creates the default record inside an existing collection when it is missing", async () => {
      const dir = join(testDir, WarpPermissions.getSettablePaths().relativeDirPath);
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "settings.toml"),
        ["[agents.execution_profiles.code-review]", 'name = "Code Review"', ""].join("\n"),
      );

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
        global: true,
      });

      // The collection already exists, so filling in the (required) default
      // record does not complete Warp's migration early.
      const executionProfiles = executionProfilesOf(perms.getFileContent());
      const defaultProfile = executionProfiles?.default as Record<string, unknown>;
      expect(defaultProfile.read_files).toBe("always_allow");
      expect(defaultProfile.command_allowlist).toEqual(["git .*"]);
      const otherProfile = executionProfiles?.["code-review"] as Record<string, unknown>;
      expect(otherProfile.name).toBe("Code Review");
    });

    it("does not warn about an un-migrated install for an empty execution_profile override", async () => {
      const logger = createMockLogger();
      await WarpPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: ".rulesync",
          relativeFilePath: "permissions.json",
          fileContent: JSON.stringify({
            permission: { bash: { "git .*": "allow" } },
            warp: { execution_profile: {} },
          }),
        }),
        logger,
        global: true,
      });

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes("warp.execution_profile"),
        ),
      ).toBe(false);
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
