import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("OpencodeHooks", () => {
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
    it("should return .opencode/plugins and rulesync-hooks.js", () => {
      const paths = OpencodeHooks.getSettablePaths();
      expect(paths).toEqual({
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
    });

    it("should return .config/opencode/plugins for global mode", () => {
      const paths = OpencodeHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".config", "opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should filter shared hooks to OpenCode-supported events only", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          afterFileEdit: [{ command: "format.sh" }],
          afterShellExecution: [{ command: "post-shell.sh" }],
          permissionRequest: [{ command: "perm-check.sh" }],
          // notification is not supported by OpenCode
          notification: [{ command: "notify.sh" }],
          // beforeSubmitPrompt has no OpenCode equivalent
          beforeSubmitPrompt: [{ command: "pre-prompt.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();

      // Generic events should be in the event handler with event.type checks
      expect(content).toContain('event.type === "session.created"');
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).toContain('event.type === "session.idle"');
      expect(content).toContain(".rulesync/hooks/audit.sh");
      expect(content).toContain('event.type === "file.edited"');
      expect(content).toContain("format.sh");
      expect(content).toContain('event.type === "command.executed"');
      expect(content).toContain("post-shell.sh");

      // permissionRequest maps to generic event permission.asked
      expect(content).toContain('event.type === "permission.asked"');
      expect(content).toContain("perm-check.sh");

      // Unsupported events should not appear
      expect(content).not.toContain("notify.sh");
      expect(content).not.toContain("pre-prompt.sh");
    });

    it("should generate tool event handlers with matcher support", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: ".rulesync/hooks/lint.sh", matcher: "Write|Edit" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      expect(content).toContain('"tool.execute.before"');
      expect(content).toContain("input.tool");
      expect(content).toContain('new RegExp("Write|Edit")');
      expect(content).toContain(".rulesync/hooks/lint.sh");
    });

    it("should generate tool event handlers without matcher when not specified", () => {
      const config = {
        version: 1,
        hooks: {
          postToolUse: [{ type: "command", command: ".rulesync/hooks/post-tool.sh" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      expect(content).toContain('"tool.execute.after"');
      expect(content).toContain(".rulesync/hooks/post-tool.sh");
      // Should not contain matcher logic
      expect(content).not.toContain(".test(input.tool)");
    });

    it("should skip prompt-type hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [
            { type: "command", command: ".rulesync/hooks/session-start.sh" },
            { type: "prompt", prompt: "Remember to use TypeScript" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      // sessionStart is a generic event, routed through event handler
      expect(content).toContain('event.type === "session.created"');
      expect(content).toContain(".rulesync/hooks/session-start.sh");
      expect(content).not.toContain("Remember to use TypeScript");
    });

    it("should merge config.opencode.hooks on top of shared hooks", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "shared.sh" }],
        },
        opencode: {
          hooks: {
            sessionStart: [{ type: "command", command: "opencode-override.sh" }],
            stop: [{ command: "opencode-only.sh" }],
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

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      expect(content).toContain("opencode-override.sh");
      expect(content).not.toContain("shared.sh");
      expect(content).toContain("opencode-only.sh");
    });

    it("should handle empty hooks config", () => {
      const config = {
        version: 1,
        hooks: {},
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(opencodeHooks.getFileContent()).toBe(
        [
          "export const RulesyncHooksPlugin = async ({ $ }) => {",
          "  return {",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
    });

    it("should escape ${} interpolation in commands", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo ${HOME}" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      // ${} should be escaped in the template literal
      expect(content).toContain("echo \\${HOME}");
      expect(content).not.toContain("echo ${HOME}");
    });

    it("should handle multiple handlers for the same event", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [
            { type: "command", command: "lint.sh", matcher: "Write" },
            { type: "command", command: "format.sh", matcher: "Edit" },
          ],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      expect(content).toContain("lint.sh");
      expect(content).toContain("format.sh");
      expect(content).toContain('new RegExp("Write")');
      expect(content).toContain('new RegExp("Edit")');
    });

    it("should throw on invalid regex in matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "[invalid" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      expect(() =>
        OpencodeHooks.fromRulesyncHooks({
          baseDir: testDir,
          rulesyncHooks,
          validate: false,
        }),
      ).toThrow("Invalid regex pattern in hook matcher");
    });

    it("should strip newline characters from matcher", () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "lint.sh", matcher: "Write\n|Edit\r" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      expect(content).toContain('new RegExp("Write|Edit")');
      // The matcher itself should not contain newline/CR (they were stripped)
      expect(content).not.toMatch(/\/Write\n/);
      expect(content).not.toMatch(/Edit\r/);
    });

    it("should escape backticks in commands", () => {
      const config = {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: "echo `date`" }],
        },
      };
      const rulesyncHooks = new RulesyncHooks({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify(config),
        validate: false,
      });

      const opencodeHooks = OpencodeHooks.fromRulesyncHooks({
        baseDir: testDir,
        rulesyncHooks,
        validate: false,
      });

      const content = opencodeHooks.getFileContent();
      // Backticks should be escaped in the template literal
      expect(content).toContain("echo \\`date\\`");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw because OpenCode hooks cannot be converted back", () => {
      const opencodeHooks = new OpencodeHooks({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
        fileContent: "export const Plugin = async ({ $ }) => { return {} }",
        validate: false,
      });

      expect(() => opencodeHooks.toRulesyncHooks()).toThrow(
        "Not implemented because OpenCode hooks are generated as a plugin file.",
      );
    });
  });

  describe("fromFile", () => {
    it("should load from .opencode/plugins/rulesync-hooks.js", async () => {
      const pluginsDir = join(testDir, ".opencode", "plugins");
      await ensureDir(pluginsDir);
      const content = [
        "export const RulesyncHooksPlugin = async ({ $ }) => {",
        "  return {}",
        "}",
      ].join("\n");
      await writeFileContent(join(pluginsDir, "rulesync-hooks.js"), content);

      const opencodeHooks = await OpencodeHooks.fromFile({
        baseDir: testDir,
        validate: false,
      });
      expect(opencodeHooks).toBeInstanceOf(OpencodeHooks);
      expect(opencodeHooks.getFileContent()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should return OpencodeHooks instance with empty content for deletion", () => {
      const hooks = OpencodeHooks.forDeletion({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
      expect(hooks).toBeInstanceOf(OpencodeHooks);
      expect(hooks.getFileContent()).toBe("");
    });
  });

  describe("isDeletable", () => {
    it("should return true (plugin file is standalone and deletable)", () => {
      const hooks = new OpencodeHooks({
        baseDir: testDir,
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
        fileContent: "",
        validate: false,
      });
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});
