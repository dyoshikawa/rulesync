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
          bash: { "git *": "allow", "npm publish": "ask" },
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

    it("should write an all-tools deny into commandDenylist and withhold the allow it covers", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "rm -rf *": "deny" },
          bash: { "rm -rf *": "allow", "git *": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const json = JSON.parse(instance.getFileContent());
      // The deny is written, where the denylist outranks the allowlist for the
      // commands it names — and it withholds the allow it covers as well, since
      // a pattern under `*` need not name a command for the entry to be read.
      expect(json.commandDenylist).toEqual(["rm -rf *"]);
      expect(json.commandAllowlist).toEqual(["git *"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("was not given the allow rule(s)"),
      );
    });

    it("should withhold a catch-all allow that an all-tools deny of a path covers", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "secrets/**": "deny" },
          bash: { "*": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      // `secrets/**` names no command, so writing it alone beside an allowed
      // `*` would auto-approve every command the deny meant to hold back.
      expect(json.commandDenylist).toEqual(["secrets/**"]);
      expect(json.commandAllowlist).toBeUndefined();
    });

    it("should write an all-tools deny that names no command at all, and say it enforces nothing", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "secrets/**": "deny" },
          bash: { "git *": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const json = JSON.parse(instance.getFileContent());
      // `secrets/**` matches no command, so the entry is inert — but dropping
      // it would lose the rule on a later import, and it costs nothing to keep.
      // It reaches no command, so it withholds no allow either — which is the
      // one case where the author's deny rule stops nothing at all, so it is
      // reported rather than left to be discovered.
      expect(json.commandDenylist).toEqual(["secrets/**"]);
      expect(json.commandAllowlist).toEqual(["git *"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("withheld none of the allow rules beside them"),
      );
    });

    it("should not call an all-tools deny unenforced when there was no allow rule to withhold", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "rm -rf *": "deny" },
          bash: { "curl *": "deny" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // Nothing was allowed, so withholding nothing says nothing about whether
      // `rm -rf *` names a command — and it plainly does. Reporting it here
      // would call a working denylist entry inert.
      const json = JSON.parse(instance.getFileContent());
      expect(json.commandDenylist).toEqual(["curl *", "rm -rf *"]);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("withheld none of the allow rules beside them"),
      );
    });

    it("should not call an all-tools deny unenforced when the same pattern is written under bash", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "rm -rf /tmp/x": "deny" },
          bash: { "rm -rf /tmp/x": "deny", "git *": "allow" },
        },
      });

      await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // The author wrote the same pattern under `bash`, so it is a command on
      // their own word; advising them to write it there would be nonsense.
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("withheld none of the allow rules beside them"),
      );
    });

    it("should say nothing about an ask that withheld nothing, since it is honored as written", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { "npm publish": "ask", "git *": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // Factory Droid prompts for whatever its allowlist does not cover, so an
      // `ask` no allow rule overlaps is already honored exactly as written.
      // Warning about it would tell the author to fix a rule that works.
      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["git *"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should withhold an allow spelled with a character class, which no glob matches", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "curl -[sS]*": "ask" },
          bash: { "curl -[sS]*": "allow", "git *": "allow" },
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

    it("should withhold a bash allow that the all-tools category asks about", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "npm *": "ask" },
          bash: { "npm *": "allow", "git *": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["git *"]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("npm *"));
    });

    it("should withhold every allow a catch-all ask covers", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          bash: { "git *": "allow", "*": "ask" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      // The stricter rule wins whatever its width, so auto-approving `git`
      // beside an ask on everything would answer the prompt the author wanted.
      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("stricter rule wins"));
    });

    it("should ignore the all-tools category's allow rules", async () => {
      const rulesyncPermissions = buildRulesyncPermissions({
        permission: {
          "*": { "src/**": "allow" },
          bash: { "git *": "allow" },
        },
      });

      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
      });

      const json = JSON.parse(instance.getFileContent());
      expect(json.commandAllowlist).toEqual(["git *"]);
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
    it("round-trips modelPolicy and missionPolicy, the organization-level controls", async () => {
      const factorydroid = {
        modelPolicy: { allowedModels: ["claude-opus-4"], defaultModel: "claude-opus-4" },
        missionPolicy: { enabled: false },
      };
      const instance = await FactorydroidPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions: new RulesyncPermissions({
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
          fileContent: JSON.stringify({ permission: {}, factorydroid }),
        }),
      });

      const settings = JSON.parse(instance.getFileContent());
      expect(settings.modelPolicy).toEqual(factorydroid.modelPolicy);
      expect(settings.missionPolicy).toEqual(factorydroid.missionPolicy);

      const imported = JSON.parse(
        new FactorydroidPermissions({
          relativeDirPath: ".factory",
          relativeFilePath: "settings.json",
          fileContent: instance.getFileContent(),
        })
          .toRulesyncPermissions()
          .getFileContent(),
      );
      expect(imported.factorydroid).toEqual(factorydroid);
    });
  });

  describe("fromFile", () => {
    const writeSettings = async (fileName: string, config: unknown): Promise<void> => {
      await ensureDir(join(testDir, ".factory"));
      await writeFileContent(join(testDir, ".factory", fileName), JSON.stringify(config));
    };

    it("should read settings.json when there is no local overlay", async () => {
      await writeSettings("settings.json", { commandAllowlist: ["git *"] });

      const instance = await FactorydroidPermissions.fromFile({ outputRoot: testDir });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "git *": "allow" });
    });

    it("should apply settings.local.json on top of settings.json", async () => {
      await writeSettings("settings.json", { commandAllowlist: ["git *"] });
      await writeSettings("settings.local.json", { commandAllowlist: ["ls *"] });

      const instance = await FactorydroidPermissions.fromFile({ outputRoot: testDir });

      // Droid enforces the local override, so importing must read it rather than
      // the committed list it replaces.
      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.permission.bash).toEqual({ "ls *": "allow" });
    });

    it("should read a settings.local.json that has no settings.json beside it", async () => {
      await writeSettings("settings.local.json", { commandBlocklist: ["curl *"] });

      const instance = await FactorydroidPermissions.fromFile({ outputRoot: testDir });

      const config = JSON.parse(instance.toRulesyncPermissions().getFileContent());
      expect(config.factorydroid).toEqual({ commandBlocklist: ["curl *"] });
    });

    it("should fall back to empty settings when neither file exists", async () => {
      const instance = await FactorydroidPermissions.fromFile({ outputRoot: testDir });

      expect(JSON.parse(instance.getFileContent())).toEqual({});
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
