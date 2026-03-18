import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodePermissions } from "./claudecode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("ClaudecodePermissions", () => {
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
    it("should return .claude and settings.json", () => {
      const paths = ClaudecodePermissions.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const instance = new ClaudecodePermissions({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert canonical format to Claude Code format", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), "{}");

      const config = {
        permissions: {
          bash: { "npm *": "allow", "rm -rf *": "deny" },
          read: { "src/**": "allow", "*/.env": "ask" },
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

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permissions.allow).toEqual(
        expect.arrayContaining(["Bash(npm *)", "Edit(src/**)", "Read(src/**)"]),
      );
      expect(parsed.permissions.ask).toEqual(["Read(*/.env)"]);
      expect(parsed.permissions.deny).toEqual(["Bash(rm -rf *)"]);
    });

    it("should preserve existing non-permissions keys in settings.json", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ hooks: { PreToolUse: [] }, customKey: "value" }),
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

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.hooks).toEqual({ PreToolUse: [] });
      expect(parsed.customKey).toBe("value");
      expect(parsed.permissions.allow).toEqual(["Bash(npm *)"]);
    });

    it("should preserve Read() entries from ignore feature in deny", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(node_modules/**)", "Read(.env)"],
          },
        }),
      );

      const config = {
        permissions: {
          bash: { "rm -rf *": "deny" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      // Should preserve the Read() entries from ignore AND add the new deny
      expect(parsed.permissions.deny).toEqual(
        expect.arrayContaining(["Bash(rm -rf *)", "Read(.env)", "Read(node_modules/**)"]),
      );
    });

    it("should preserve existing manual allow and ask entries", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm ci *)"],
            ask: ["Read(secrets/**)"],
            deny: ["Bash(rm -rf *)"],
          },
        }),
      );

      const config = {
        permissions: {
          bash: { "npm *": "allow" },
          read: { "src/**": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permissions.allow).toEqual(
        expect.arrayContaining(["Bash(npm *)", "Read(src/**)", "Bash(npm ci *)"]),
      );
      expect(parsed.permissions.ask).toEqual(expect.arrayContaining(["Read(secrets/**)"]));
      expect(parsed.permissions.deny).toEqual(["Bash(rm -rf *)"]);
    });

    it("should create settings.json if it does not exist", async () => {
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

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permissions.allow).toEqual(["Bash(npm *)"]);
    });

    it("should handle MCP tool names (mcp__ prefix)", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), "{}");

      const config = {
        permissions: {
          mcp__serena__search: { "**": "allow" },
        },
      };

      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "permissions.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const result = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const parsed = JSON.parse(result.getFileContent());
      expect(parsed.permissions.allow).toEqual(["mcp__serena__search(**)"]);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Claude Code format back to canonical", () => {
      const settings = {
        permissions: {
          allow: ["Bash(npm *)", "Read(src/**)"],
          ask: ["Read(*.env)"],
          deny: ["Bash(rm -rf *)"],
        },
      };

      const instance = new ClaudecodePermissions({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify(settings),
        validate: false,
      });

      const rulesync = instance.toRulesyncPermissions();
      const json = rulesync.getJson();

      expect(json.permissions).toEqual(
        expect.arrayContaining([
          { tool: "bash", pattern: ["npm", "*"], action: "allow" },
          { tool: "read", pattern: ["src", "**"], action: "allow" },
          { tool: "read", pattern: ["*.env"], action: "ask" },
          { tool: "bash", pattern: ["rm", "-rf", "*"], action: "deny" },
        ]),
      );
    });
  });

  describe("fromFile", () => {
    it("should load from existing settings.json", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm *)"],
          },
        }),
      );

      const instance = await ClaudecodePermissions.fromFile({ baseDir: testDir });
      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toEqual(["Bash(npm *)"]);
    });

    it("should return empty object if file does not exist", async () => {
      const instance = await ClaudecodePermissions.fromFile({ baseDir: testDir });
      expect(instance.getFileContent()).toBe("{}");
    });
  });
});
