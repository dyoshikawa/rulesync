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
        permissions: {
          bash: { "npm *": "allow" },
          read: { "src/**": "allow" },
        },
      };

      await ensureDir(join(testDir, RULESYNC_RELATIVE_DIR_PATH));
      await writeFileContent(
        join(testDir, RULESYNC_RELATIVE_DIR_PATH, "permissions.json"),
        JSON.stringify(config),
      );

      const rulesyncPermissions = await RulesyncPermissions.fromFile({
        baseDir: testDir,
      });

      expect(rulesyncPermissions.getJson().permissions).toEqual(
        expect.arrayContaining([
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "read", pattern: ["src", "**"], action: "allow" },
        ]),
      );
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
        permissions: {
          bash: { "npm *": "allow" },
        },
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: true,
      });

      expect(instance.getJson().permissions).toEqual([
        { tool: "bash", pattern: ["npm", "*"], action: "allow" },
      ]);
      expect(instance.getFileContent()).toEqual(
        JSON.stringify(
          {
            permissions: {
              bash: { "npm *": "allow" },
            },
          },
          null,
          2,
        ),
      );
    });

    it("should reject invalid action values", () => {
      const config = {
        permissions: {
          bash: { npm: "invalid" },
        },
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
        permissions: {
          "": { npm: "allow" },
        },
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

    it("should allow empty tool permissions", () => {
      const config = {
        permissions: {
          bash: {},
        },
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: true,
      });

      expect(instance.getJson()).toEqual({ permissions: [] });
      expect(instance.getFileContent()).toEqual(
        JSON.stringify(
          {
            permissions: {},
          },
          null,
          2,
        ),
      );
    });

    it("should reject empty pattern segment", () => {
      const config = {
        permissions: {
          bash: { "": "allow" },
        },
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

    it("should preserve empty path segments", () => {
      const config = {
        permissions: {
          read: { "//": "allow" },
        },
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: true,
      });

      expect(instance.getJson().permissions).toEqual([
        { tool: "read", pattern: ["", "", ""], action: "allow" },
      ]);
      expect(instance.getFileContent()).toEqual(
        JSON.stringify(
          {
            permissions: {
              read: { "//": "allow" },
            },
          },
          null,
          2,
        ),
      );
    });

    it("should allow MCP tool names with hyphens and dots", () => {
      const config = {
        permissions: {
          "mcp__serena-v2__search.docs": { "**": "allow" },
        },
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: true,
      });

      expect(instance.getJson().permissions).toEqual([
        { tool: "mcp__serena-v2__search.docs", pattern: ["**"], action: "allow" },
      ]);
    });
  });

  describe("getJson", () => {
    it("should return the parsed JSON content", () => {
      const config = {
        permissions: {
          bash: { "rm -rf *": "deny" },
          read: { "*/.env": "ask" },
        },
      };

      const instance = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      expect(instance.getJson().permissions).toEqual(
        expect.arrayContaining([
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
          { tool: "read", pattern: ["*", ".env"], action: "ask" },
        ]),
      );
    });
  });
});
