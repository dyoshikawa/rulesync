import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { parseSharedConfig } from "../shared/shared-config-gateway.js";
import { KimiCodeHooks } from "./kimi-code-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

type KimiCodeHookEntry = {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
};

describe("KimiCodeHooks", () => {
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

  const readEntries = (content: string): KimiCodeHookEntry[] => {
    const parsed = parseSharedConfig({ format: "toml", fileContent: content });
    return (parsed.hooks ?? []) as KimiCodeHookEntry[];
  };

  describe("fromRulesyncHooks", () => {
    it("emits the 0.32.0 native-only events from a kimi-code override", () => {
      const hooks = KimiCodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          version: 1,
          hooks: {},
          "kimi-code": {
            hooks: {
              TurnStarted: [{ command: "./turn.sh", matcher: "user" }],
              UserPromptQueued: [{ command: "./queued.sh" }],
              TaskStarted: [{ command: "./task.sh", matcher: "agent" }],
              SessionHeartbeat: [{ command: "./beat.sh" }],
            },
          },
        }),
      });

      const entries = readEntries(hooks.getFileContent());
      expect(entries.map((entry) => entry.event)).toEqual([
        "TurnStarted",
        "UserPromptQueued",
        "TaskStarted",
        "SessionHeartbeat",
      ]);
      expect(entries[0]?.matcher).toBe("user");
      expect(entries[2]?.matcher).toBe("agent");
      // Every command is wrapped so it runs from the trusted source directory.
      for (const entry of entries) {
        expect(entry.command).toContain("RULESYNC_KIMI_HOOK_CWD=1");
      }
    });

    it("drops matchers on the events whose matcher is documented as an empty string", () => {
      const logger = createMockLogger();
      const hooks = KimiCodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          version: 1,
          hooks: {
            stop: [{ type: "command", command: "./stop.sh", matcher: "Bash" }],
          },
          "kimi-code": {
            hooks: {
              SessionHeartbeat: [{ command: "./beat.sh", matcher: "Bash" }],
              Interrupt: [{ command: "./interrupt.sh", matcher: "Bash" }],
            },
          },
        }),
        logger,
      });

      const entries = readEntries(hooks.getFileContent());
      expect(entries.map((entry) => entry.event)).toEqual([
        "Stop",
        "SessionHeartbeat",
        "Interrupt",
      ]);
      for (const entry of entries) {
        expect(entry.matcher).toBeUndefined();
      }
      for (const nativeEvent of ["Stop", "SessionHeartbeat", "Interrupt"]) {
        expect(logger.warn).toHaveBeenCalledWith(
          `matcher "Bash" on "${nativeEvent}" hook will be ignored — this event does not support matchers`,
        );
      }
    });

    it("keeps matchers on the events that match a real value", () => {
      const logger = createMockLogger();
      const hooks = KimiCodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          version: 1,
          hooks: {
            // PermissionRequest matches the tool name, UserPromptSubmit matches
            // the submitted prompt text, StopFailure matches the error type.
            permissionRequest: [{ type: "command", command: "./perm.sh", matcher: "Bash" }],
            beforeSubmitPrompt: [{ type: "command", command: "./prompt.sh", matcher: "deploy" }],
            stopFailure: [{ type: "command", command: "./fail.sh", matcher: "timeout" }],
          },
          "kimi-code": {
            // PermissionResult matches the tool name too.
            hooks: { PermissionResult: [{ command: "./result.sh", matcher: "Bash" }] },
          },
        }),
        logger,
      });

      const entries = readEntries(hooks.getFileContent());
      expect(entries.map((entry) => entry.matcher)).toEqual(["Bash", "deploy", "timeout", "Bash"]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("still skips event names Kimi Code does not accept", () => {
      const logger = createMockLogger();
      const hooks = KimiCodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          version: 1,
          hooks: {},
          "kimi-code": { hooks: { NotAnEvent: [{ command: "./nope.sh" }] } },
        }),
        logger,
      });

      expect(readEntries(hooks.getFileContent())).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NotAnEvent"));
    });
  });

  describe("toRulesyncHooks", () => {
    it("imports the native-only events into the kimi-code override", () => {
      const hooks = new KimiCodeHooks({
        outputRoot: testDir,
        fileContent: [
          "[[hooks]]",
          'event = "TaskStarted"',
          'command = "./task.sh"',
          'matcher = "process"',
          "",
          "[[hooks]]",
          'event = "SessionHeartbeat"',
          'command = "./beat.sh"',
          "",
          "[[hooks]]",
          'event = "SessionStart"',
          'command = "./start.sh"',
          "",
        ].join("\n"),
        validate: false,
      });

      const config = JSON.parse(hooks.toRulesyncHooks().getFileContent());
      expect(config.hooks.sessionStart).toHaveLength(1);
      expect(config["kimi-code"].hooks.TaskStarted).toEqual([
        { type: "command", command: "./task.sh", matcher: "process" },
      ]);
      expect(config["kimi-code"].hooks.SessionHeartbeat).toHaveLength(1);
    });

    it("round-trips the 0.32.0 events through generate and import", () => {
      const generated = KimiCodeHooks.fromRulesyncHooks({
        outputRoot: testDir,
        rulesyncHooks: makeRulesyncHooks({
          version: 1,
          hooks: { sessionStart: [{ command: "./start.sh" }] },
          "kimi-code": {
            hooks: {
              TurnStarted: [{ command: "./turn.sh", matcher: "task" }],
              UserPromptQueued: [{ command: "./queued.sh" }],
            },
          },
        }),
      });

      const reimported = new KimiCodeHooks({
        outputRoot: testDir,
        fileContent: generated.getFileContent(),
        validate: false,
      });

      const config = JSON.parse(reimported.toRulesyncHooks().getFileContent());
      expect(config.hooks.sessionStart).toEqual([{ type: "command", command: "./start.sh" }]);
      expect(config["kimi-code"].hooks.TurnStarted).toEqual([
        { type: "command", command: "./turn.sh", matcher: "task" },
      ]);
      expect(config["kimi-code"].hooks.UserPromptQueued).toEqual([
        { type: "command", command: "./queued.sh" },
      ]);
    });
  });
});
