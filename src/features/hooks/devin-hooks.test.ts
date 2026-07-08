import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { DevinHooks } from "./devin-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

describe("DevinHooks", () => {
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

  const makeRulesyncHooks = (config: unknown): RulesyncHooks =>
    new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify(config),
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .devin and hooks.v1.json for project mode", () => {
      const paths = DevinHooks.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: ".devin", relativeFilePath: "hooks.v1.json" });
    });

    it("should return .config/devin and config.json for global mode", () => {
      const paths = DevinHooks.getSettablePaths({ global: true });
      expect(paths).toEqual({
        relativeDirPath: join(".config", "devin"),
        relativeFilePath: "config.json",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should produce a top-level event map (no wrapper key) for project mode", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "exec", command: "./scripts/check.sh", timeout: 10 }],
          postToolUse: [{ command: "./scripts/after.sh" }],
          beforeSubmitPrompt: [{ command: "./scripts/prompt.sh" }],
          stop: [{ command: "./scripts/stop.sh" }],
          sessionStart: [{ command: "./scripts/start.sh" }],
          permissionRequest: [{ matcher: "exec", prompt: "Allow?", type: "prompt" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      // No "hooks" wrapper key — events are at the top level.
      expect(parsed.hooks).toBeUndefined();
      expect(parsed.PreToolUse).toEqual([
        {
          matcher: "exec",
          hooks: [{ type: "command", command: "./scripts/check.sh", timeout: 10 }],
        },
      ]);
      expect(parsed.PostToolUse).toEqual([
        { hooks: [{ type: "command", command: "./scripts/after.sh" }] },
      ]);
      // Matcher-less events carry no matcher key.
      expect(parsed.UserPromptSubmit).toEqual([
        { hooks: [{ type: "command", command: "./scripts/prompt.sh" }] },
      ]);
      expect(parsed.Stop).toEqual([{ hooks: [{ type: "command", command: "./scripts/stop.sh" }] }]);
      expect(parsed.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "./scripts/start.sh" }] },
      ]);
      expect(parsed.PermissionRequest).toEqual([
        { matcher: "exec", hooks: [{ type: "prompt", prompt: "Allow?" }] },
      ]);
    });

    it("should drop canonical events without a Devin equivalent", async () => {
      const config = {
        version: 1,
        hooks: {
          // Not in the Devin native event set.
          beforeReadFile: [{ command: "read.sh" }],
          afterFileEdit: [{ command: "edit.sh" }],
          preToolUse: [{ command: "tool.sh" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(Object.keys(parsed)).toEqual(["PreToolUse"]);
    });

    it("should merge config.devin.hooks on top of shared hooks", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ command: "shared.sh" }],
        },
        devin: {
          hooks: {
            preToolUse: [{ command: "override.sh" }],
            stop: [{ command: "override-stop.sh" }],
          },
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.PreToolUse).toEqual([{ hooks: [{ type: "command", command: "override.sh" }] }]);
      expect(parsed.Stop).toEqual([{ hooks: [{ type: "command", command: "override-stop.sh" }] }]);
    });

    it("should write hooks under the hooks key of config.json in global mode, preserving siblings", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ mcpServers: { a: { command: "x" } }, permissions: { deny: ["Exec"] } }),
      );

      const config = {
        version: 1,
        hooks: { preToolUse: [{ command: "g.sh" }] },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
        global: true,
      });

      expect(devinHooks.getRelativeDirPath()).toBe(join(".config", "devin"));
      expect(devinHooks.getRelativeFilePath()).toBe("config.json");
      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.hooks.PreToolUse).toEqual([{ hooks: [{ type: "command", command: "g.sh" }] }]);
      // Sibling keys from MCP / permissions features are preserved.
      expect(parsed.mcpServers).toEqual({ a: { command: "x" } });
      expect(parsed.permissions).toEqual({ deny: ["Exec"] });
    });
  });

  describe("fromFile", () => {
    it("should parse an existing project hooks.v1.json (top-level events)", async () => {
      const dir = join(testDir, ".devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "hooks.v1.json"),
        JSON.stringify({
          PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "s.sh" }] }],
        }),
      );

      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir });
      const parsed = JSON.parse(devinHooks.getFileContent());
      expect(parsed.PreToolUse).toBeDefined();
    });

    it("should fall back to an empty object when the file is missing", async () => {
      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir });
      expect(JSON.parse(devinHooks.getFileContent())).toEqual({});
    });

    it("should read config.json in global mode", async () => {
      const dir = join(testDir, ".config", "devin");
      await ensureDir(dir);
      await writeFileContent(
        join(dir, "config.json"),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] } }),
      );

      const devinHooks = await DevinHooks.fromFile({ outputRoot: testDir, global: true });
      expect(devinHooks.getRelativeFilePath()).toBe("config.json");
    });
  });

  describe("toRulesyncHooks", () => {
    it("should map Devin events back to canonical names from a project hooks.v1.json", () => {
      const fileContent = JSON.stringify({
        PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "tool.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
      });
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "hooks.v1.json",
        fileContent,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.toRulesyncHooks().getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.hooks.preToolUse).toEqual([
        { type: "command", command: "tool.sh", matcher: "exec" },
      ]);
      expect(parsed.hooks.stop).toEqual([{ type: "command", command: "stop.sh" }]);
    });

    it("should read hooks from under the hooks key for a global config.json", () => {
      const fileContent = JSON.stringify({
        mcpServers: {},
        hooks: { Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }] },
      });
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: join(".config", "devin"),
        relativeFilePath: "config.json",
        fileContent,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.toRulesyncHooks().getFileContent());
      expect(parsed.hooks.stop).toEqual([{ type: "command", command: "stop.sh" }]);
    });

    it("should round-trip mappable events through fromRulesyncHooks and back", async () => {
      const config = {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "tool.sh", matcher: "exec" }],
          postToolUse: [{ type: "command", command: "after.sh" }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
          stop: [{ type: "command", command: "stop.sh" }],
          sessionStart: [{ type: "command", command: "start.sh" }],
          sessionEnd: [{ type: "command", command: "end.sh" }],
          permissionRequest: [{ type: "command", command: "perm.sh", matcher: "exec" }],
        },
      };
      const rulesyncHooks = makeRulesyncHooks(config);

      const devinHooks = await DevinHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(devinHooks.toRulesyncHooks().getFileContent());
      expect(parsed.hooks).toEqual(config.hooks);
    });

    it("should throw on invalid JSON content", () => {
      const devinHooks = new DevinHooks({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "hooks.v1.json",
        fileContent: "{ not json",
        validate: false,
      });

      expect(() => devinHooks.toRulesyncHooks()).toThrow(/Failed to parse Devin hooks/);
    });
  });

  describe("isDeletable / forDeletion", () => {
    it("should treat the project hooks.v1.json as deletable", () => {
      const devinHooks = DevinHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".devin",
        relativeFilePath: "hooks.v1.json",
      });
      expect(devinHooks.isDeletable()).toBe(true);
    });

    it("should never delete the shared global config.json", () => {
      const devinHooks = DevinHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".config", "devin"),
        relativeFilePath: "config.json",
      });
      expect(devinHooks.isDeletable()).toBe(false);
    });
  });
});
