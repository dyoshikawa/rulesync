import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("RulesyncPermissions", () => {
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
    it("should return .rulesync and permissions.json", () => {
      const paths = RulesyncPermissions.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
      });
    });
  });

  describe("fromFile", () => {
    it("should load and parse a valid permissions file", async () => {
      const config = {
        permissions: [
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "read", pattern: ["src", "**"], action: "allow" },
        ],
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify(config),
      );

      const rulesyncPermissions = await RulesyncPermissions.fromFile({
        baseDir: testDir,
      });

      expect(rulesyncPermissions.getJson()).toEqual(config);
    });

    it("should throw if file does not exist", async () => {
      await expect(RulesyncPermissions.fromFile({ baseDir: testDir })).rejects.toThrow(
        "No .rulesync/permissions.json found.",
      );
    });
  });

  describe("validate", () => {
    it("should validate a correct permissions config", () => {
      const config = {
        permissions: [{ tool: "bash", pattern: ["npm", "*"], action: "allow" }],
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: true,
      });

      expect(instance.getJson()).toEqual(config);
    });

    it("should reject invalid action values", () => {
      const config = {
        permissions: [{ tool: "bash", pattern: ["npm"], action: "invalid" }],
      };

      expect(
        () =>
          new RulesyncPermissions({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify(config),
            validate: true,
          }),
      ).toThrow();
    });

    it("should reject empty tool", () => {
      const config = {
        permissions: [{ tool: "", pattern: ["npm"], action: "allow" }],
      };

      expect(
        () =>
          new RulesyncPermissions({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify(config),
            validate: true,
          }),
      ).toThrow();
    });

    it("should reject empty pattern array", () => {
      const config = {
        permissions: [{ tool: "bash", pattern: [], action: "allow" }],
      };

      expect(
        () =>
          new RulesyncPermissions({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify(config),
            validate: true,
          }),
      ).toThrow();
    });

    it("should reject empty pattern segment", () => {
      const config = {
        permissions: [{ tool: "bash", pattern: [""], action: "allow" }],
      };

      expect(
        () =>
          new RulesyncPermissions({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
            relativeFilePath: "permissions.json",
            fileContent: JSON.stringify(config),
            validate: true,
          }),
      ).toThrow();
    });
  });

  describe("getJson", () => {
    it("should return the parsed JSON content", () => {
      const config = {
        permissions: [
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
          { tool: "read", pattern: ["*", ".env"], action: "ask" },
        ],
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      expect(instance.getJson().permissions).toHaveLength(2);
      expect(instance.getJson().permissions[0]!.tool).toBe("bash");
      expect(instance.getJson().permissions[1]!.action).toBe("ask");
    });
  });
});
