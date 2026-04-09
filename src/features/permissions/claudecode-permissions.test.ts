import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
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

  describe("constructor", () => {
    it("should create instance with valid JSON content", () => {
      const jsonContent = JSON.stringify(
        {
          permissions: {
            allow: ["Bash(npm run *)"],
            deny: ["Bash(rm -rf *)"],
          },
        },
        null,
        2,
      );

      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: jsonContent,
      });

      expect(instance).toBeInstanceOf(ClaudecodePermissions);
      expect(instance.getRelativeDirPath()).toBe(".claude");
      expect(instance.getRelativeFilePath()).toBe("settings.json");
    });

    it("should default to empty JSON when fileContent is undefined", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: undefined as unknown as string,
      });

      expect(instance.getFileContent()).toBe("{}");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for Claude Code settings", () => {
      const paths = ClaudecodePermissions.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".claude");
      expect(paths.relativeFilePath).toBe("settings.json");
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json can include non-permissions settings", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });

      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromFile", () => {
    it("should create instance from existing settings.json", async () => {
      const settingsDir = join(testDir, ".claude");
      const settingsPath = join(settingsDir, "settings.json");
      await ensureDir(settingsDir);
      await writeFileContent(
        settingsPath,
        JSON.stringify({
          permissions: {
            allow: ["Bash(git *)"],
            deny: ["Bash(rm *)"],
          },
        }),
      );

      const instance = await ClaudecodePermissions.fromFile({});

      expect(instance).toBeInstanceOf(ClaudecodePermissions);
    });

    it("should use default content when file does not exist", async () => {
      const instance = await ClaudecodePermissions.fromFile({});

      expect(instance).toBeInstanceOf(ClaudecodePermissions);
      expect(instance.getFileContent()).toBe('{"permissions":{}}');
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert basic rulesync permissions to Claude Code format", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toContain("Bash(git *)");
      expect(content.permissions.ask).toContain("Bash");
      expect(content.permissions.deny).toContain("Bash(rm *)");
    });

    it("should handle multiple tool categories", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow" },
            edit: { "src/**": "allow" },
            read: { ".env": "deny" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toContain("Bash(npm *)");
      expect(content.permissions.allow).toContain("Edit(src/**)");
      expect(content.permissions.deny).toContain("Read(.env)");
    });

    it("should map canonical tool names to Claude Code PascalCase names", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            webfetch: { "domain:github.com": "allow" },
            notebookedit: { "*": "deny" },
            agent: { Explore: "allow" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toContain("WebFetch(domain:github.com)");
      expect(content.permissions.allow).toContain("Agent(Explore)");
      expect(content.permissions.deny).toContain("NotebookEdit");
    });

    it("should pass through unknown tool names as-is (e.g., MCP tools)", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            mcp__puppeteer__puppeteer_navigate: { "*": "allow" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toContain("mcp__puppeteer__puppeteer_navigate");
    });

    it("should preserve existing non-permissions settings in settings.json", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ command: "echo test" }] },
          permissions: {
            allow: ["Bash(existing *)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      // Hooks should be preserved
      expect(content.hooks).toEqual({ PreToolUse: [{ command: "echo test" }] });
      // New Bash permission replaces existing Bash permission
      expect(content.permissions.allow).toContain("Bash(npm *)");
      expect(content.permissions.allow).not.toContain("Bash(existing *)");
    });

    it("should preserve permission entries from other features (e.g., ignore Read patterns)", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(.env)", "Read(*.secret)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "rm *": "deny" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      // Read deny patterns (from ignore feature) should be preserved since "read" is not in permissions config
      expect(content.permissions.deny).toContain("Read(.env)");
      expect(content.permissions.deny).toContain("Read(*.secret)");
      // New Bash deny should be added
      expect(content.permissions.deny).toContain("Bash(rm *)");
    });

    it("should replace existing entries when tool category is in permissions config", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(old command *)"],
            deny: ["Read(.env)", "Bash(dangerous *)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow", "rm *": "deny" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      // Old Bash entries replaced, Read entries preserved
      expect(content.permissions.allow).toContain("Bash(npm *)");
      expect(content.permissions.allow).not.toContain("Bash(old command *)");
      expect(content.permissions.deny).toContain("Bash(rm *)");
      expect(content.permissions.deny).not.toContain("Bash(dangerous *)");
      expect(content.permissions.deny).toContain("Read(.env)");
    });

    it("should warn when permissions overwrites existing Read deny entries from ignore feature", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(.env)", "Read(*.secret)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            read: { "src/**": "allow" },
          },
        }),
      });

      const mockLogger = createMockLogger();
      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
        logger: mockLogger,
      });

      const content = JSON.parse(instance.getFileContent());
      // Permissions feature takes precedence: Read deny entries from ignore are replaced
      expect(content.permissions.deny).toBeUndefined();
      expect(content.permissions.allow).toContain("Read(src/**)");
      // Warning should be emitted
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Permissions feature manages 'Read' tool"),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("2 existing Read deny"));
    });

    it("should not warn when permissions does not manage Read tool", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(.env)", "Read(*.secret)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow" },
          },
        }),
      });

      const mockLogger = createMockLogger();
      await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
        logger: mockLogger,
      });

      // No warning because Read is not managed by permissions
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should not warn when no logger is provided", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            deny: ["Read(.env)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            read: { "src/**": "allow" },
          },
        }),
      });

      // Should not throw even without logger
      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toContain("Read(src/**)");
    });

    it("should handle empty permissions config", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {},
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toBeUndefined();
      expect(content.permissions.ask).toBeUndefined();
      expect(content.permissions.deny).toBeUndefined();
    });

    it("should remove empty arrays from output", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      expect(content.permissions.allow).toEqual(["Bash(npm *)"]);
      expect(content.permissions.ask).toBeUndefined();
      expect(content.permissions.deny).toBeUndefined();
    });

    it("should deduplicate and sort entries", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            allow: ["Edit(docs/**)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow" },
          },
        }),
      });

      const instance = await ClaudecodePermissions.fromRulesyncPermissions({
        baseDir: testDir,
        rulesyncPermissions,
      });

      const content = JSON.parse(instance.getFileContent());
      // Should be sorted: Bash before Edit
      expect(content.permissions.allow).toEqual(["Bash(npm *)", "Edit(docs/**)"]);
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Claude Code permissions to rulesync format", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Bash(npm run *)", "Read(src/**)"],
            ask: ["Bash(git push *)"],
            deny: ["Bash(rm -rf *)", "Read(.env)"],
          },
        }),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission.bash).toEqual({
        "npm run *": "allow",
        "git push *": "ask",
        "rm -rf *": "deny",
      });
      expect(config.permission.read).toEqual({
        "src/**": "allow",
        ".env": "deny",
      });
    });

    it("should handle tool entries without parentheses (wildcard)", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Bash"],
            deny: ["WebFetch"],
          },
        }),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission.bash).toEqual({ "*": "allow" });
      expect(config.permission.webfetch).toEqual({ "*": "deny" });
    });

    it("should handle MCP tool names", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["mcp__puppeteer__puppeteer_navigate"],
          },
        }),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission["mcp__puppeteer__puppeteer_navigate"]).toEqual({ "*": "allow" });
    });

    it("should handle empty permissions", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ permissions: {} }),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission).toEqual({});
    });

    it("should handle missing permissions key", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({ hooks: {} }),
      });

      const rulesyncPermissions = instance.toRulesyncPermissions();
      const config = rulesyncPermissions.getJson();

      expect(config.permission).toEqual({});
    });

    it("should throw error for invalid JSON content", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{ invalid json }",
      });

      expect(() => instance.toRulesyncPermissions()).toThrow("Failed to parse");
    });
  });

  describe("forDeletion", () => {
    it("should create minimal instance for deletion", () => {
      const instance = ClaudecodePermissions.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });

      expect(instance).toBeInstanceOf(ClaudecodePermissions);
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const instance = new ClaudecodePermissions({
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });

      const result = instance.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });
});
