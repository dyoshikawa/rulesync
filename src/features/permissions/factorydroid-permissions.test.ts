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
