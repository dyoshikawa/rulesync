import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("ClaudecodeHooks", () => {
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
    it("should return .claude and settings.json for project mode", () => {
      const paths = ClaudecodeHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".claude", relativeFilePath: "settings.json" });
    });

    it("should return .claude and settings.json for global mode", () => {
      const paths = ClaudecodeHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".claude", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to Claude-supported events and convert to PascalCase", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          afterFileEdit: [{ command: "format.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
    });

    it("should prefix non-absolute commands with $CLAUDE_PROJECT_DIR", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      const sessionStartEntry = parsed.hooks.SessionStart[0];
      expect(sessionStartEntry).toBeDefined();
      expect(sessionStartEntry.matcher).toBeUndefined();
      expect(sessionStartEntry.hooks[0].command).toContain("$CLAUDE_PROJECT_DIR");
      expect(sessionStartEntry.hooks[0].command).toContain(".rulesync/hooks/session-start.sh");
    });

    it("should merge config.claudecode.hooks on top of shared hooks", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        claudecode: {
          hooks: {
            notification: [
              {
                matcher: "permission_prompt",
                command: "$CLAUDE_PROJECT_DIR/.claude/hooks/notify.sh",
              },
            ],
            sessionStart: [{ type: "command", command: "claude-override.sh" }],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("claude-override.sh");
      expect(parsed.hooks.Notification).toBeDefined();
      expect(parsed.hooks.Notification[0].matcher).toBe("permission_prompt");
    });

    it("should merge rulesync hooks into existing .claude/settings.json content", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ otherKey: "preserved" }),
      );

      const config = {
        version: 1,
        hooks: { sessionStart: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.otherKey).toBe("preserved");
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert Claude PascalCase hooks to canonical camelCase", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/echo.sh" }] },
            ],
            Stop: [{ hooks: [{ command: "audit.sh" }] }],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.sessionStart).toHaveLength(1);
      expect(json.hooks.sessionStart[0].command).toContain("echo.sh");
      expect(json.hooks.stop).toHaveLength(1);
    });
  });

  describe("fromFile", () => {
    it("should load from .claude/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(
        join(testDir, ".claude", "settings.json"),
        JSON.stringify({ hooks: { SessionStart: [] } }),
      );

      const claudecodeHooks = await ClaudecodeHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(claudecodeHooks).toBeInstanceOf(ClaudecodeHooks);
      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toEqual([]);
    });

    it("should initialize empty hooks when .claude/settings.json does not exist", async () => {
      const claudecodeHooks = await ClaudecodeHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(claudecodeHooks).toBeInstanceOf(ClaudecodeHooks);
      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toEqual({});
    });
  });

  describe("isDeletable", () => {
    it("should return false", () => {
      const hooks = new ClaudecodeHooks({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return ClaudecodeHooks instance with empty hooks for deletion path", () => {
      const hooks = ClaudecodeHooks.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });
      expect(hooks).toBeInstanceOf(ClaudecodeHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
