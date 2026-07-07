import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
