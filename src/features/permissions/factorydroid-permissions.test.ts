import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { FactorydroidPermissions } from "./factorydroid-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const buildRulesyncPermissions = (config: unknown): RulesyncPermissions =>
  new RulesyncPermissions({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    fileContent: JSON.stringify(config),
  });

describe("FactorydroidPermissions", () => {
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
    it("should return .factory/settings.json", () => {
      const paths = FactorydroidPermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".factory");
      expect(paths.relativeFilePath).toBe("settings.json");
    });

    it("should return the same relative path for global scope", () => {
      const paths = FactorydroidPermissions.getSettablePaths({ global: true });
      expect(paths.relativeDirPath).toBe(".factory");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should return false since settings.json holds other settings", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should map bash allow/deny rules to commandAllowlist/commandDenylist", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { "git *": "allow", ls: "allow", "rm -rf *": "deny" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["git *", "ls"]);
      expect(json.commandDenylist).toEqual(["rm -rf *"]);
    });

    it("should drop ask rules (Factory Droid prompts by default)", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { "git *": "allow", "*": "ask" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["git *"]);
      expect(json.commandDenylist).toBeUndefined();
    });

    it("should preserve other keys in an existing settings.json", async () => {
      const settingsDir = join(testDir, ".factory");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          sessionDefaultSettings: { autonomyLevel: "low" },
          hooks: { PreToolUse: [] },
        }),
      );

      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git *": "allow" } },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.sessionDefaultSettings).toEqual({ autonomyLevel: "low" });
      expect(json.hooks).toEqual({ PreToolUse: [] });
      expect(json.commandAllowlist).toEqual(["git *"]);
    });

    it("should preserve an existing commandBlocklist verbatim (no canonical block action)", async () => {
      const settingsDir = join(testDir, ".factory");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({ commandBlocklist: ["curl *"] }),
      );

      const rulesyncPermissions = buildRulesyncPermissions({
        permission: { bash: { "git *": "allow" } },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      // rulesync owns only allow/deny lists; the hard-block tier is untouched.
      expect(json.commandBlocklist).toEqual(["curl *"]);
      expect(json.commandAllowlist).toEqual(["git *"]);
    });

    it("should warn and skip non-bash categories carrying deny rules", async () => {
      const mockLogger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { ls: "allow" },
          read: { "secret/**": "deny" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger: mockLogger,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["ls"]);
      expect(json.commandDenylist).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("read"));
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert commandAllowlist/commandDenylist back into bash rules", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          commandAllowlist: ["git *", "ls"],
          commandDenylist: ["rm -rf *"],
        }),
      });

      const rulesync = instance.toRulesyncPermissions();
      const config = JSON.parse(rulesync.getFileContent());
      expect(config.permission.bash).toEqual({
        "git *": "allow",
        ls: "allow",
        "rm -rf *": "deny",
      });
    });

    it("should let the denylist win when a command is in both lists", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          commandAllowlist: ["rm -rf *"],
          commandDenylist: ["rm -rf *"],
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash["rm -rf *"]).toBe("deny");
    });

    it("routes commandBlocklist into the factorydroid override (no deny collapse)", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          commandAllowlist: ["git *"],
          commandBlocklist: ["curl *", "wget *"],
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      // allow/deny drive the shared block; the hard-block tier lives in the override.
      expect(config.permission.bash).toEqual({ "git *": "allow" });
      expect(config.factorydroid).toEqual({ commandBlocklist: ["curl *", "wget *"] });
    });

    it("routes the other Factory Droid security keys into the override on import", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          commandDenylist: ["rm -rf *"],
          sandbox: { enabled: true, mode: "workspace" },
          networkPolicy: { allowedIps: ["10.0.0.0/8"] },
          enableDroidShield: false,
          sessionDefaultSettings: { autonomyLevel: "low" },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "rm -rf *": "deny" });
      expect(config.factorydroid).toEqual({
        sandbox: { enabled: true, mode: "workspace" },
        networkPolicy: { allowedIps: ["10.0.0.0/8"] },
        enableDroidShield: false,
        sessionDefaultSettings: { autonomyLevel: "low" },
      });
    });

    it("routes the autonomy keys (subagentAutonomyLevel, mcpAutonomyOverrides) into the override on import", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          subagentAutonomyLevel: "medium",
          mcpAutonomyOverrides: { "some-server": "high" },
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.factorydroid).toEqual({
        subagentAutonomyLevel: "medium",
        mcpAutonomyOverrides: { "some-server": "high" },
      });
    });

    it("routes the plugin-bootstrap keys and hooksDisabled into the override on import (issue #2412)", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          extraKnownMarketplaces: {
            "org-plugins": { source: { source: "github", repo: "org/plugins", ref: "v1.2.0" } },
          },
          enabledPlugins: { "code-standards@org-plugins": true },
          hooksDisabled: true,
        }),
      });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.factorydroid).toEqual({
        extraKnownMarketplaces: {
          "org-plugins": { source: { source: "github", repo: "org/plugins", ref: "v1.2.0" } },
        },
        enabledPlugins: { "code-standards@org-plugins": true },
        hooksDisabled: true,
      });
    });

    it("does not emit a factorydroid override when no Factory-specific keys are present", () => {
      const instance = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ commandAllowlist: ["git *"] }),
      });

      expect(
        JSON.parse(instance.toRulesyncPermissions().getFileContent()).factorydroid,
      ).toBeUndefined();
    });
  });

  describe("factorydroid override (generate)", () => {
    it("keeps commandBlocklist stable across a full import -> generate round-trip", async () => {
      const original = new FactorydroidPermissions({
        relativeDirPath: ".factory",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          commandAllowlist: ["git *"],
          commandBlocklist: ["curl *"],
          sandbox: { enabled: true },
        }),
      });

      const canonical = original.toRulesyncPermissions();
      const regenerated = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: join(testDir, "fresh"),
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: canonical.getFileContent(),
        }),
      });

      const settings = JSON.parse(regenerated.getFileContent());
      expect(settings.commandAllowlist).toEqual(["git *"]);
      expect(settings.commandBlocklist).toEqual(["curl *"]);
      expect(settings.sandbox).toEqual({ enabled: true });
    });

    it("lets the managed lists win over a stray commandDenylist inside the override", async () => {
      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({
            permission: { bash: { "rm *": "deny" } },
            factorydroid: { commandDenylist: ["should-be-ignored"] },
          }),
        }),
      });

      const settings = JSON.parse(instance.getFileContent());
      // The managed denylist (from the shared block) wins over the stray override value.
      expect(settings.commandDenylist).toEqual(["rm *"]);
    });

    it("merges the factorydroid override's security keys into settings.json", async () => {
      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({
            permission: { bash: { "git *": "allow" } },
            factorydroid: {
              commandBlocklist: ["curl *"],
              sandbox: { enabled: true },
            },
          }),
        }),
      });

      const settings = JSON.parse(instance.getFileContent());
      expect(settings.commandAllowlist).toEqual(["git *"]);
      expect(settings.commandBlocklist).toEqual(["curl *"]);
      expect(settings.sandbox).toEqual({ enabled: true });
    });

    it("merges the plugin-bootstrap override keys into settings.json (issue #2412)", async () => {
      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({
            permission: {},
            factorydroid: {
              extraKnownMarketplaces: {
                "org-plugins": { source: { source: "github", repo: "org/plugins" } },
              },
              enabledPlugins: { "code-standards@org-plugins": true },
              hooksDisabled: true,
            },
          }),
        }),
      });

      const settings = JSON.parse(instance.getFileContent());
      expect(settings.extraKnownMarketplaces).toEqual({
        "org-plugins": { source: { source: "github", repo: "org/plugins" } },
      });
      expect(settings.enabledPlugins).toEqual({ "code-standards@org-plugins": true });
      expect(settings.hooksDisabled).toBe(true);
    });

    it("round-trips disabledSkills, the per-skill kill switch", async () => {
      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({
            permission: {},
            factorydroid: { disabledSkills: ["legacy-migration", "scratch"] },
          }),
        }),
      });

      const settings = JSON.parse(instance.getFileContent());
      expect(settings.disabledSkills).toEqual(["legacy-migration", "scratch"]);

      const imported = JSON.parse(
        new FactorydroidPermissions({
          relativeDirPath: ".factory",
          relativeFilePath: "settings.json",
          fileContent: instance.getFileContent(),
        })
          .toRulesyncPermissions()
          .getFileContent(),
      );
      expect(imported.factorydroid).toEqual({
        disabledSkills: ["legacy-migration", "scratch"],
      });
    });
  });

  describe("round-trip", () => {
    it("should round-trip bash allow/deny rules", async () => {
      const original = buildRulesyncPermissions({
        permission: {
          bash: { "git *": "allow", "rm -rf *": "deny" },
        },
      });

      const factorydroid = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: original,
      });
      const roundTripped = JSON.parse(factorydroid.toRulesyncPermissions().getFileContent());

      expect(roundTripped.permission.bash).toEqual({
        "git *": "allow",
        "rm -rf *": "deny",
      });
    });
  });
});
