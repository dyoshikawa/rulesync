import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("OpencodePermissions", () => {
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
    it("should return . and opencode.json", () => {
      const paths = OpencodePermissions.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const instance = new OpencodePermissions({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
        validate: false,
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert canonical format to OpenCode format", async () => {
      const config = {
        permissions: {
          bash: { "npm *": "allow", "rm -rf *": "deny" },
          read: { "*/.env": "ask", "src/**": "allow" },
          edit: { "src/**": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await OpencodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permission).toEqual({
        bash: { "npm *": "allow", "rm -rf *": "deny" },
        read: { "*/.env": "ask", "src/**": "allow" },
        edit: { "src/**": "allow" },
      });
    });

    it("should preserve path patterns with repeated slashes", async () => {
      const config = {
        permissions: {
          read: { "///": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await OpencodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permission).toEqual({
        read: { "///": "allow" },
      });
    });

    it("should preserve existing non-permission keys", async () => {
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify({ mcp: { server1: {} }, model: "claude" }),
      );

      const config = {
        permissions: {
          bash: { "npm *": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await OpencodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.mcp).toEqual({ server1: {} });
      expect(parsed.model).toBe("claude");
      expect(parsed.permission.bash).toEqual({ "npm *": "allow" });
    });

    it("should prefer jsonc file when both exist", async () => {
      await writeFileContent(
        join(testDir, "opencode.jsonc"),
        JSON.stringify({ existing: "jsonc" }),
      );
      await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ existing: "json" }));

      const config = {
        permissions: {
          bash: { "npm *": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await OpencodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.existing).toBe("jsonc");
    });

    it("should throw when existing config JSONC is invalid", async () => {
      await writeFileContent(join(testDir, "opencode.jsonc"), "{");

      const config = {
        permissions: {
          bash: { "npm *": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        OpencodePermissions.fromRulesyncPermissions({
          baseDir: testDir,
          rulesyncPermissions,
        }),
      ).rejects.toThrow(/Failed to parse existing OpenCode config/);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should throw when OpenCode config JSONC is invalid", () => {
      const instance = new OpencodePermissions({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{",
        validate: false,
      });

      expect(() => instance.toRulesyncPermissions()).toThrow(
        /Failed to parse OpenCode permissions content/,
      );
    });

    it("should convert OpenCode format back to canonical", () => {
      const opencodeConfig = {
        permission: {
          bash: { "npm *": "allow", "rm -rf *": "deny" },
          read: { "*.env": "ask", "src/**": "allow" },
        },
      };

      const instance = new OpencodePermissions({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(opencodeConfig),
        validate: false,
      });

      const rulesync = instance.toRulesyncPermissions();
      const json = rulesync.getJson();

      expect(json.permissions).toEqual(
        expect.arrayContaining([
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
          { tool: "read", pattern: ["*.env"], action: "ask" },
          { tool: "read", pattern: ["src", "**"], action: "allow" },
        ]),
      );
    });

    it("should preserve repeated slashes in path patterns", () => {
      const opencodeConfig = {
        permission: {
          read: { "///": "allow" },
        },
      };

      const instance = new OpencodePermissions({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: JSON.stringify(opencodeConfig),
        validate: false,
      });

      const rulesync = instance.toRulesyncPermissions();
      const json = rulesync.getJson();

      expect(json.permissions).toEqual([
        { tool: "read", pattern: ["", "", "", ""], action: "allow" },
      ]);
      expect(rulesync.getFileContent()).toEqual(
        JSON.stringify(
          {
            permissions: {
              read: { "///": "allow" },
            },
          },
          null,
          2,
        ),
      );
    });
  });

  describe("fromFile", () => {
    it("should load from existing opencode.json", async () => {
      await writeFileContent(
        join(testDir, "opencode.json"),
        JSON.stringify({ permission: { bash: { "npm *": "allow" } } }),
      );

      const instance = await OpencodePermissions.fromFile({ baseDir: testDir });
      expect(instance.getFileContent()).toContain("permission");
    });

    it("should return empty object if file does not exist", async () => {
      const instance = await OpencodePermissions.fromFile({ baseDir: testDir });
      expect(instance.getFileContent()).toBe("{}");
    });
  });
});
