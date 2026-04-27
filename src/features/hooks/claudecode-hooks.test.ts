import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

describe("ClaudecodeHooks", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
    });

    it("should only prefix dot-relative commands with $CLAUDE_PROJECT_DIR", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: ".rulesync/hooks/session-start.sh" },
            { type: "command", command: "npx prettier --write ./src/hooks/format.ts" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
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
      expect(sessionStartEntry.hooks[1].command).toBe("npx prettier --write ./src/hooks/format.ts");
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain("claude-override.sh");
      expect(parsed.hooks.Notification).toBeDefined();
      expect(parsed.hooks.Notification[0].matcher).toBe("permission_prompt");
    });

    it("should throw error with descriptive message when existing settings.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        ClaudecodeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse existing Claude settings/);
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
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
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
    it("should throw error with descriptive message when content contains invalid JSON", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => claudecodeHooks.toRulesyncHooks()).toThrow(
        /Failed to parse Claude hooks content/,
      );
    });

    it("should convert Claude PascalCase hooks to canonical camelCase", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
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
      expect(json.hooks.sessionStart?.[0]?.command).toContain("echo.sh");
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
        outputRoot: testDir,
        validate: false,
      });
      expect(claudecodeHooks).toBeInstanceOf(ClaudecodeHooks);
      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toEqual([]);
    });

    it("should initialize empty hooks when .claude/settings.json does not exist", async () => {
      const claudecodeHooks = await ClaudecodeHooks.fromFile({
        outputRoot: testDir,
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
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncHooks - worktree events", () => {
    it("should generate WorktreeCreate and WorktreeRemove events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: ".rulesync/hooks/worktree-create.sh" }],
          worktreeRemove: [{ type: "command", command: ".rulesync/hooks/worktree-remove.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeRemove).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].hooks[0].command).toContain("worktree-create.sh");
      expect(parsed.hooks.WorktreeRemove[0].hooks[0].command).toContain("worktree-remove.sh");
    });

    it("should NOT emit matcher for worktreeCreate and worktreeRemove even if defined in config", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: "create.sh", matcher: "*.js" }],
          worktreeRemove: [{ type: "command", command: "remove.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].matcher).toBeUndefined();
      expect(parsed.hooks.WorktreeRemove).toBeDefined();
      expect(parsed.hooks.WorktreeRemove[0].matcher).toBeUndefined();
    });

    it("should warn when matcher is defined on worktree events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const warnSpy = vi.spyOn(logger, "warn");

      const config = {
        version: 1,
        hooks: {
          worktreeCreate: [{ type: "command", command: "create.sh", matcher: "*.js" }],
          worktreeRemove: [{ type: "command", command: "remove.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "worktreeCreate" hook will be ignored'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.ts" on "worktreeRemove" hook will be ignored'),
      );
    });

    it("should NOT emit matcher for worktree events in claudecode-specific config", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {},
        claudecode: {
          hooks: {
            worktreeCreate: [
              { type: "command", command: "create-claude.sh", matcher: "should-be-ignored" },
            ],
          },
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.WorktreeCreate).toBeDefined();
      expect(parsed.hooks.WorktreeCreate[0].matcher).toBeUndefined();
    });

    it("should keep matcher for non-worktree events", async () => {
      await ensureDir(join(testDir, ".claude"));
      await writeFileContent(join(testDir, ".claude", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "session.sh", matcher: "*.js" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const claudecodeHooks = await ClaudecodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = claudecodeHooks.getFileContent();
      const parsed = JSON.parse(content);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.SessionStart[0].matcher).toBe("*.js");
    });
  });

  describe("toRulesyncHooks - worktree events", () => {
    it("should import WorktreeCreate and WorktreeRemove back to canonical names", () => {
      const claudecodeHooks = new ClaudecodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            WorktreeCreate: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/create.sh" }] },
            ],
            WorktreeRemove: [
              { hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/remove.sh" }] },
            ],
          },
        }),
        validate: false,
      });

      const rulesyncHooks = claudecodeHooks.toRulesyncHooks();
      const json = rulesyncHooks.getJson();
      expect(json.hooks.worktreeCreate).toHaveLength(1);
      expect(json.hooks.worktreeCreate?.[0]?.command).toContain("create.sh");
      expect(json.hooks.worktreeRemove).toHaveLength(1);
      expect(json.hooks.worktreeRemove?.[0]?.command).toContain("remove.sh");
    });
  });

  describe("forDeletion", () => {
    it("should return ClaudecodeHooks instance with empty hooks for deletion path", () => {
      const hooks = ClaudecodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
      });
      expect(hooks).toBeInstanceOf(ClaudecodeHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
