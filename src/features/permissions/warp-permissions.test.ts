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
            ? join("AppData", "Roaming", "warp", "Warp", "data")
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

    it("preserves other agents.profiles keys and other top-level tables", async () => {
      const dir = join(testDir, ".config", "warp-terminal");
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
