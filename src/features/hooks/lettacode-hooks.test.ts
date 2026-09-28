import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { LettacodeHooks } from "./lettacode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

const buildRulesyncHooks = (testDir: string, config: Record<string, unknown>): RulesyncHooks =>
  new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });

const SETTINGS_DIR = ".letta";

describe("LettacodeHooks", () => {
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
    it("should return .letta/settings.json for both scopes", () => {
      const expected = { relativeDirPath: SETTINGS_DIR, relativeFilePath: "settings.json" };
      expect(LettacodeHooks.getSettablePaths({ global: false })).toEqual(expected);
      expect(LettacodeHooks.getSettablePaths({ global: true })).toEqual(expected);
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should map canonical events to Letta Code event names and convert timeouts to milliseconds", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ type: "command", command: "./pre.sh", matcher: "Bash", timeout: 5 }],
          beforeSubmitPrompt: [{ type: "command", command: "prompt.sh", matcher: "Bash" }],
          subagentStop: [{ type: "command", command: "subagent.sh" }],
          // Letta Code has no afterFileEdit event.
          afterFileEdit: [{ type: "command", command: "edit.sh" }],
        },
      });

      const hooks = await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(Object.keys(parsed.hooks).toSorted()).toEqual([
        "PreToolUse",
        "SubagentStop",
        "UserPromptSubmit",
      ]);
      // Hooks run with the project directory as cwd, so commands stay verbatim.
      expect(parsed.hooks.PreToolUse).toEqual([
        { matcher: "Bash", hooks: [{ type: "command", command: "./pre.sh", timeout: 5000 }] },
      ]);
      // UserPromptSubmit carries no matcher.
      expect(parsed.hooks.UserPromptSubmit).toEqual([
        { hooks: [{ type: "command", command: "prompt.sh" }] },
      ]);
    });

    it("should skip prompt hooks because only command hooks are emitted", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: {
          stop: [
            { type: "command", command: "stop.sh" },
            { type: "prompt", prompt: "Is the task done?" },
          ],
        },
      });

      const hooks = await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "stop.sh" }] }]);
    });

    it("should prefer the lettacode override hooks", async () => {
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ type: "command", command: "shared.sh" }] },
        lettacode: { hooks: { stop: [{ type: "command", command: "letta.sh" }] } },
      });

      const hooks = await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      const parsed = JSON.parse(hooks.getFileContent());
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe("letta.sh");
    });

    it("should merge into existing settings and keep the hooks.disabled switch", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      await writeFileContent(
        join(testDir, SETTINGS_DIR, "settings.json"),
        JSON.stringify({
          permissions: { allow: ["Read"] },
          hooks: { disabled: true, Stop: [{ hooks: [{ type: "command", command: "old.sh" }] }] },
        }),
      );
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { sessionStart: [{ type: "command", command: "start.sh" }] },
      });

      const hooks = await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks,
        validate: false,
      });

      expect(JSON.parse(hooks.getFileContent())).toEqual({
        permissions: { allow: ["Read"] },
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "start.sh" }] }],
          disabled: true,
        },
      });
    });

    it("should warn when existing prompt hooks are replaced", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      await writeFileContent(
        join(testDir, SETTINGS_DIR, "settings.json"),
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "prompt", prompt: "Is the task done?" }] }],
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "old.sh" }] }],
          },
        }),
      );
      const logger = createMockLogger();

      await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks(testDir, {
          version: 1,
          hooks: { stop: [{ type: "command", command: "stop.sh" }] },
        }),
        validate: false,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("(events: Stop)"));
    });

    it("should write global hooks to the home directory's .letta/settings.json", async () => {
      const hooks = await LettacodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: buildRulesyncHooks(testDir, {
          version: 1,
          hooks: { stop: [{ type: "command", command: "stop.sh" }] },
        }),
        validate: false,
        global: true,
      });

      expect(hooks.getFilePath()).toBe(join(testDir, SETTINGS_DIR, "settings.json"));
      expect(JSON.parse(hooks.getFileContent()).hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "stop.sh" }] },
      ]);
    });

    it("should refuse to overwrite an unparseable settings file", async () => {
      await ensureDir(join(testDir, SETTINGS_DIR));
      await writeFileContent(join(testDir, SETTINGS_DIR, "settings.json"), "{ not json");
      const rulesyncHooks = buildRulesyncHooks(testDir, {
        version: 1,
        hooks: { stop: [{ type: "command", command: "stop.sh" }] },
      });

      await expect(
        LettacodeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, validate: false }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should import events, convert timeouts to seconds and ignore hooks.disabled", async () => {
      const hooks = new LettacodeHooks({
        outputRoot: testDir,
        relativeDirPath: SETTINGS_DIR,
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          hooks: {
            disabled: false,
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "pre.sh", timeout: 3000 }] },
            ],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "prompt.sh" }] }],
          },
        }),
      });

      const json = hooks.toRulesyncHooks().getJson();
      expect(json.hooks).toEqual({
        preToolUse: [{ type: "command", command: "pre.sh", matcher: "Bash", timeout: 3 }],
        beforeSubmitPrompt: [{ type: "command", command: "prompt.sh" }],
      });
    });
  });

  describe("fromFile", () => {
    it("should fall back to empty hooks when the file is missing", async () => {
      const hooks = await LettacodeHooks.fromFile({ outputRoot: testDir });
      expect(JSON.parse(hooks.getFileContent())).toEqual({ hooks: {} });
      expect(hooks.isDeletable()).toBe(false);
    });
  });
});
