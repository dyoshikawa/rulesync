import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { AugmentcodeHooks } from "./augmentcode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const logger = createMockLogger();

describe("AugmentcodeHooks", () => {
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
    it("should return .augment and settings.json for project mode", () => {
      const paths = AugmentcodeHooks.getSettablePaths({ global: false });
      expect(paths).toEqual({ relativeDirPath: ".augment", relativeFilePath: "settings.json" });
    });

    it("should return .augment and settings.json for global mode", () => {
      const paths = AugmentcodeHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".augment", relativeFilePath: "settings.json" });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to AugmentCode-supported events and convert to PascalCase", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "guard.sh" }],
          sessionStart: [{ type: "command", command: "setup.sh" }],
          stop: [{ command: "audit.sh" }],
          // Not supported by AugmentCode — must be dropped.
          afterFileEdit: [{ command: "format.sh" }],
          worktreeCreate: [{ command: "wt.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.afterFileEdit).toBeUndefined();
      expect(parsed.hooks.WorktreeCreate).toBeUndefined();
    });

    it("should emit commands verbatim without a project-directory prefix", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          preToolUse: [{ type: "command", command: "npx prettier --write ./src/index.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
        ".rulesync/hooks/session-start.sh",
      );
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(
        "npx prettier --write ./src/index.ts",
      );
      // AUGMENT_PROJECT_DIR is a runtime env var, never an inline substitution.
      expect(JSON.stringify(parsed)).not.toContain("AUGMENT_PROJECT_DIR");
    });

    it("should keep matcher for tool events (PreToolUse)", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "guard.sh", matcher: "mcp:*" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse[0].matcher).toBe("mcp:*");
    });

    it("should NOT emit matcher for session events and warn", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), JSON.stringify({}));

      const warnSpy = vi.spyOn(logger, "warn");

      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "setup.sh", matcher: "*.js" }],
          stop: [{ type: "command", command: "audit.sh", matcher: "*.ts" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        logger,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.SessionStart[0].matcher).toBeUndefined();
      expect(parsed.hooks.Stop[0].matcher).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('matcher "*.js" on "sessionStart" hook will be ignored'),
      );
    });

    it("should merge config.augmentcode.hooks on top of shared hooks", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), JSON.stringify({}));

      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "shared.sh" }],
        },
        augmentcode: {
          hooks: {
            postToolUse: [{ matcher: "mcp:*", command: "post.sh" }],
            preToolUse: [{ type: "command", command: "augment-override.sh" }],
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

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe("augment-override.sh");
      expect(parsed.hooks.PostToolUse).toBeDefined();
      expect(parsed.hooks.PostToolUse[0].matcher).toBe("mcp:*");
    });

    it("should preserve existing toolPermissions when merging hooks", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(
        join(testDir, ".augment", "settings.json"),
        JSON.stringify({
          toolPermissions: [{ toolName: "Bash", permission: { type: "ask-user" } }],
        }),
      );

      const config = {
        version: 1,
        hooks: { preToolUse: [{ command: "echo" }] },
      };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const augmentcodeHooks = await AugmentcodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.toolPermissions).toEqual([
        { toolName: "Bash", permission: { type: "ask-user" } },
      ]);
      expect(parsed.hooks.PreToolUse).toBeDefined();
    });

    it("should throw a descriptive error when existing settings.json contains invalid JSON", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(join(testDir, ".augment", "settings.json"), "invalid json {");

      const config = { version: 1, hooks: {} };
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      await expect(
        AugmentcodeHooks.fromRulesyncHooks({
          outputRoot: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).rejects.toThrow(/Failed to parse existing AugmentCode settings/);
    });
  });

  describe("toRulesyncHooks", () => {
    it("should convert AugmentCode PascalCase hooks to canonical camelCase", () => {
      const augmentcodeHooks = new AugmentcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: "mcp:*", hooks: [{ type: "command", command: "guard.sh" }] }],
            Stop: [{ hooks: [{ command: "audit.sh" }] }],
          },
        }),
        validate: false,
      });

      const json = augmentcodeHooks.toRulesyncHooks().getJson();
      expect(json.hooks.preToolUse).toHaveLength(1);
      expect(json.hooks.preToolUse?.[0]?.command).toContain("guard.sh");
      expect(json.hooks.stop).toHaveLength(1);
    });

    it("should throw a descriptive error when content contains invalid JSON", () => {
      const augmentcodeHooks = new AugmentcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: "invalid json {",
        validate: false,
      });

      expect(() => augmentcodeHooks.toRulesyncHooks()).toThrow(
        /Failed to parse AugmentCode hooks content/,
      );
    });
  });

  describe("fromFile", () => {
    it("should load from .augment/settings.json when it exists", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(
        join(testDir, ".augment", "settings.json"),
        JSON.stringify({ hooks: { PreToolUse: [] } }),
      );

      const augmentcodeHooks = await AugmentcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(augmentcodeHooks).toBeInstanceOf(AugmentcodeHooks);
      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toEqual([]);
    });

    it("should initialize empty hooks when .augment/settings.json does not exist", async () => {
      const augmentcodeHooks = await AugmentcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(augmentcodeHooks).toBeInstanceOf(AugmentcodeHooks);
      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });

    it("should overlay settings.local.json over settings.json on import (local wins)", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(
        join(testDir, ".augment", "settings.json"),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "base.sh" }] }] } }),
      );
      // The local overrides file replaces the top-level `hooks` key.
      await writeFileContent(
        join(testDir, ".augment", "settings.local.json"),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "local.sh" }] }] } }),
      );

      const augmentcodeHooks = await AugmentcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      // Local override wins: the whole `hooks` block comes from settings.local.json.
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.PreToolUse).toBeUndefined();
    });

    it("should leave import unchanged when settings.local.json is absent", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(
        join(testDir, ".augment", "settings.json"),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "base.sh" }] }] } }),
      );

      const augmentcodeHooks = await AugmentcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toBeDefined();
    });

    it("should NOT overlay settings.local.json in global mode (project-only file)", async () => {
      await ensureDir(join(testDir, ".augment"));
      await writeFileContent(
        join(testDir, ".augment", "settings.json"),
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "base.sh" }] }] } }),
      );
      await writeFileContent(
        join(testDir, ".augment", "settings.local.json"),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "local.sh" }] }] } }),
      );

      const augmentcodeHooks = await AugmentcodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });
      const parsed = JSON.parse(augmentcodeHooks.getFileContent());
      // Global mode ignores the project-only settings.local.json overlay.
      expect(parsed.hooks.PreToolUse).toBeDefined();
      expect(parsed.hooks.Stop).toBeUndefined();
    });
  });

  describe("isDeletable", () => {
    it("should return false because settings.json is shared with permissions", () => {
      const hooks = new AugmentcodeHooks({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
        fileContent: "{}",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(false);
    });
  });

  describe("forDeletion", () => {
    it("should return an AugmentcodeHooks instance with empty hooks", () => {
      const hooks = AugmentcodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".augment",
        relativeFilePath: "settings.json",
      });
      expect(hooks).toBeInstanceOf(AugmentcodeHooks);
      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks).toEqual({});
    });
  });
});
