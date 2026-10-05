import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { PermissionsProcessor } from "./permissions-processor.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { WarpcliPermissions } from "./warpcli-permissions.js";

function rulesyncPermissions(json: Record<string, unknown>): RulesyncPermissions {
  return new RulesyncPermissions({
    relativeDirPath: ".rulesync",
    relativeFilePath: "permissions.json",
    fileContent: JSON.stringify(json),
  });
}

describe("WarpcliPermissions", () => {
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

  const settingsPath = (): string => {
    const paths = WarpcliPermissions.getSettablePaths();
    return join(testDir, paths.relativeDirPath, paths.relativeFilePath);
  };

  const writeSettings = async (content: string): Promise<void> => {
    await ensureDir(join(testDir, WarpcliPermissions.getSettablePaths().relativeDirPath));
    await writeFileContent(settingsPath(), content);
  };

  describe("getSettablePaths", () => {
    it.each([
      ["darwin", ".warp_cli"],
      ["linux", join(".config", "warp-terminal", "cli")],
      ["win32", join("AppData", "Local", "warp", "Warp", "config", "cli")],
    ] as const)("targets the CLI's own settings.toml on %s", (platform, expectedDir) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);

      expect(WarpcliPermissions.getSettablePaths()).toEqual({
        relativeDirPath: expectedDir,
        relativeFilePath: "settings.toml",
      });
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("rejects project scope", async () => {
      await expect(
        WarpcliPermissions.fromRulesyncPermissions({
          outputRoot: testDir,
          rulesyncPermissions: rulesyncPermissions({ permission: {} }),
        }),
      ).rejects.toThrow("global-only");
    });

    it("creates the default execution profile on a fresh install, without legacy keys", async () => {
      const logger = createMockLogger();
      const perms = await WarpcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          permission: { bash: { "^git status$": "allow", "^rm .*$": "deny" } },
          warpcli: { execution_profile: { apply_code_diffs: "always_ask" } },
        }),
        logger,
        global: true,
      });

      expect(smolToml.parse(perms.getFileContent())).toEqual({
        agents: {
          execution_profiles: {
            default: {
              apply_code_diffs: "always_ask",
              command_allowlist: ["^git status$"],
              command_denylist: ["^rm .*$"],
            },
          },
        },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warp Agent CLI's command_denylist replaces its built-in default"),
      );
    });

    it("creates the default execution profile from the override alone", async () => {
      const perms = await WarpcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          permission: {},
          warpcli: { execution_profile: { read_files: "always_allow" } },
        }),
        global: true,
      });

      expect(smolToml.parse(perms.getFileContent())).toEqual({
        agents: { execution_profiles: { default: { read_files: "always_allow" } } },
      });
    });

    it("merges into the default profile and keeps every other setting", async () => {
      await writeSettings(
        [
          "[appearance]",
          'theme = "dark"',
          "",
          "[agents.warp_agent.other]",
          "auto_approve_bypasses_command_denylist = false",
          "",
          "[agents.execution_profiles.default]",
          'name = "Default"',
          'base_model = "auto"',
          "command_allowlist = ['^stale$']",
          "",
          "[agents.execution_profiles.other]",
          'name = "Other"',
          "",
        ].join("\n"),
      );

      const perms = await WarpcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({
          permission: { bash: { "^ls$": "allow" } },
          // The rulesync-owned list wins over an override value.
          warpcli: { execution_profile: { command_allowlist: ["^ignored$"] } },
        }),
        global: true,
      });

      expect(smolToml.parse(perms.getFileContent())).toEqual({
        appearance: { theme: "dark" },
        agents: {
          warp_agent: { other: { auto_approve_bypasses_command_denylist: false } },
          execution_profiles: {
            default: { name: "Default", base_model: "auto", command_allowlist: ["^ls$"] },
            other: { name: "Other" },
          },
        },
      });
    });

    it("drops stale command lists when no rule maps", async () => {
      await writeSettings("[agents.execution_profiles.default]\ncommand_denylist = ['^old$']\n");

      const perms = await WarpcliPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: rulesyncPermissions({ permission: {} }),
        global: true,
      });

      expect(smolToml.parse(perms.getFileContent())).toEqual({
        agents: { execution_profiles: { default: {} } },
      });
    });
  });

  describe("toRulesyncPermissions", () => {
    it("reads only the default profile and lifts its autonomy keys into the warpcli override", async () => {
      await writeSettings(
        [
          "[agents.profiles]",
          "agent_mode_command_execution_allowlist = ['^legacy$']",
          "",
          "[agents.execution_profiles.default]",
          'name = "Default"',
          'read_files = "always_allow"',
          "command_allowlist = ['^git .*$']",
          "command_denylist = ['^rm .*$']",
          "",
          "[agents.execution_profiles.other]",
          "command_allowlist = ['^other$']",
          "",
        ].join("\n"),
      );

      const perms = await WarpcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({ bash: { "^git .*$": "allow", "^rm .*$": "deny" } });
      expect(json.warpcli).toEqual({ execution_profile: { read_files: "always_allow" } });
      expect(json.warp).toBeUndefined();
    });

    it("imports nothing from a missing settings file", async () => {
      const perms = await WarpcliPermissions.fromFile({ outputRoot: testDir, global: true });
      const json = JSON.parse(perms.toRulesyncPermissions().getFileContent());

      expect(json.permission).toEqual({});
      expect(json.warpcli).toBeUndefined();
    });
  });

  describe("PermissionsProcessor", () => {
    const generate = async (json: Record<string, unknown>): Promise<void> => {
      const processor = new PermissionsProcessor({
        logger: createMockLogger(),
        outputRoot: testDir,
        toolTarget: "warpcli",
        global: true,
      });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        rulesyncPermissions(json),
      ]);
      await processor.writeAiFiles(toolFiles);
    };

    it("is a global-only target", () => {
      expect(PermissionsProcessor.getToolTargets({ global: false })).not.toContain("warpcli");
      expect(PermissionsProcessor.getToolTargets({ global: true })).toContain("warpcli");
    });

    it("does not create settings.toml when nothing maps", async () => {
      await generate({ permission: {} });

      expect(await fileExists(settingsPath())).toBe(false);
    });

    it("writes settings.toml when only the override maps", async () => {
      await generate({
        permission: {},
        warpcli: { execution_profile: { run_agents: "always_ask" } },
      });

      expect(smolToml.parse(await readFileContent(settingsPath()))).toEqual({
        agents: { execution_profiles: { default: { run_agents: "always_ask" } } },
      });
    });

    it("writes settings.toml when a rule maps", async () => {
      await generate({ permission: { bash: { "^git .*$": "allow" } } });

      expect(smolToml.parse(await readFileContent(settingsPath()))).toEqual({
        agents: { execution_profiles: { default: { command_allowlist: ["^git .*$"] } } },
      });
    });
  });
});
