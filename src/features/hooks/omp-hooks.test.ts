import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { OmpHooks } from "./omp-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function buildRulesyncHooks({
  testDir,
  config,
}: {
  testDir: string;
  config: Record<string, unknown>;
}): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

function generate({
  testDir,
  config,
}: {
  testDir: string;
  config: Record<string, unknown>;
}): string {
  return OmpHooks.fromRulesyncHooks({
    outputRoot: testDir,
    rulesyncHooks: buildRulesyncHooks({ testDir, config }),
    validate: false,
  }).getFileContent();
}

type OmpHandler = (event?: unknown, ctx?: unknown) => Promise<unknown>;

/**
 * Write the generated extension out and load it, so the runtime tests below
 * exercise the emitted module itself rather than a re-implementation of it.
 */
async function loadOmpExtension({
  testDir,
  config,
}: {
  testDir: string;
  config: Record<string, unknown>;
}): Promise<{ registeredEvents: string[]; handlerFor: (ompEvent: string) => OmpHandler }> {
  const extensionsDir = join(testDir, ".omp", "extensions");
  await ensureDir(extensionsDir);
  const filePath = join(extensionsDir, "rulesync-hooks.ts");
  await writeFileContent(filePath, generate({ testDir, config }));

  const mod = await tsImport(pathToFileURL(filePath).href, import.meta.url);
  const on = vi.fn();
  mod.default({ on });
  return {
    registeredEvents: on.mock.calls.map(([event]) => event),
    handlerFor: (ompEvent) => on.mock.calls.find(([event]) => event === ompEvent)?.[1],
  };
}

async function loadPromptGate({
  testDir,
  command,
}: {
  testDir: string;
  command: string;
}): Promise<OmpHandler> {
  const { handlerFor } = await loadOmpExtension({
    testDir,
    config: { version: 1, hooks: { beforeSubmitPrompt: [{ type: "command", command }] } },
  });
  return handlerFor("input");
}

function stopEvent({
  stopHookActive = false,
  stopReason = "stop",
}: { stopHookActive?: boolean; stopReason?: string } = {}) {
  return {
    type: "session_stop",
    messages: [],
    turn_id: 0,
    last_assistant_message: { role: "assistant", content: [], stopReason },
    session_id: "session",
    stop_hook_active: stopHookActive,
    signal: new AbortController().signal,
  };
}

function uiContext(notify: ReturnType<typeof vi.fn>) {
  return { hasUI: true, ui: { notify } };
}

describe("OmpHooks", () => {
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
    it("should return .omp/extensions and rulesync-hooks.ts", () => {
      expect(OmpHooks.getSettablePaths()).toEqual({
        relativeDirPath: join(".omp", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });

    it("should return .omp/agent/extensions for global mode", () => {
      expect(OmpHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".omp", "agent", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("should import types from the oh-my-pi package and map supported events", () => {
      const content = generate({
        testDir,
        config: {
          version: 1,
          hooks: {
            sessionStart: [{ command: "echo start" }],
            sessionEnd: [{ command: "echo end" }],
            preToolUse: [{ matcher: "bash", command: "echo pre" }],
            postToolUse: [{ command: "echo post" }],
            preModelInvocation: [{ command: "echo context" }],
            postModelInvocation: [{ command: "echo message" }],
            beforeSubmitPrompt: [{ command: "echo prompt" }],
            preCompact: [{ command: "echo pre-compact" }],
            postCompact: [{ command: "echo post-compact" }],
          },
        },
      });

      expect(content).toContain(
        'import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";',
      );
      expect(content).not.toContain("@earendil-works");
      for (const event of [
        "session_start",
        "session_shutdown",
        "tool_call",
        "tool_result",
        "context",
        "message_end",
        "input",
        "session_before_compact",
        "session_compact",
      ]) {
        expect(content).toContain(`pi.on(${JSON.stringify(event)}`);
      }
    });

    it("should map stop to session_stop rather than Pi's settle gate", () => {
      const content = generate({
        testDir,
        config: { version: 1, hooks: { stop: [{ command: "echo stop" }] } },
      });

      expect(content).toContain('pi.on("session_stop", async (event) => {');
      expect(content).toContain('import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";');
      expect(content).not.toContain("agent_before_settle");
      expect(content).not.toContain("agent_settled");
      expect(content).not.toContain("continueAfterStopHook");
    });

    it("should also run sessionStart commands on session_clear", async () => {
      const markerPath = join(testDir, "marker.txt");
      const { registeredEvents, handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { sessionStart: [{ command: `echo started >> ${JSON.stringify(markerPath)}` }] },
        },
      });

      expect(registeredEvents).toEqual(["session_start", "session_clear", "session_shutdown"]);
      await handlerFor("session_clear")({ type: "session_clear" });
      expect(await readFileContent(markerPath)).toBe("started\n");
    });

    it("should not map notification, which has no oh-my-pi equivalent", () => {
      const content = generate({
        testDir,
        config: { version: 1, hooks: { notification: [{ command: "echo notify" }] } },
      });

      expect(content).not.toContain("ui_prompt_start");
      expect(content).toContain("export default function () {}");
    });

    it("should merge config.omp.hooks and ignore config.pi.hooks", () => {
      const content = generate({
        testDir,
        config: {
          version: 1,
          hooks: { sessionStart: [{ command: "echo shared" }] },
          omp: { hooks: { sessionStart: [{ command: "echo omp" }] } },
          pi: { hooks: { postToolUse: [{ command: "echo pi" }] } },
        },
      });

      expect(content).toContain('await run("echo omp", { seconds: 600 });');
      expect(content).not.toContain("echo shared");
      expect(content).not.toContain("echo pi");
    });
  });

  describe("generated extension", () => {
    it("should block a tool call matching the matcher when the command fails", async () => {
      const { registeredEvents, handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { preToolUse: [{ matcher: "bash", command: "echo denied >&2; exit 2" }] },
        },
      });
      expect(registeredEvents).toEqual(["tool_call", "session_shutdown"]);
      const handler = handlerFor("tool_call");

      expect(await handler({ toolName: "bash", input: {} })).toEqual({
        block: true,
        reason: "denied",
      });
      expect(await handler({ toolName: "read", input: {} })).toBeUndefined();
    });

    it("should keep oh-my-pi's own old_string / new_string in the edit payload", async () => {
      const payloadPath = join(testDir, "payload.json");
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: {
            preToolUse: [{ type: "command", command: `cat > ${JSON.stringify(payloadPath)}` }],
          },
        },
      });
      const toolCall = handlerFor("tool_call");
      const ctx = { cwd: testDir, sessionManager: { getSessionId: () => "session-1" } };
      const payloadFor = async (input: unknown) => {
        await toolCall({ toolName: "edit", toolCallId: "call-1", input }, ctx);
        return JSON.parse(await readFileContent(payloadPath)).tool_input;
      };

      // `edit.mode: "replace"`; a decoy `file_path` is still dropped.
      expect(
        await payloadFor({
          path: "src/a.ts",
          old_string: "a",
          new_string: "b",
          replace_all: true,
          file_path: "README.md",
        }),
      ).toEqual({
        path: "src/a.ts",
        file_path: join(testDir, "src/a.ts"),
        old_string: "a",
        new_string: "b",
        replace_all: true,
      });
      // The internal batch form keeps its entries and joins their text.
      expect(
        await payloadFor({
          path: "src/a.ts",
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "c", new_string: "d" },
          ],
        }),
      ).toEqual({
        path: "src/a.ts",
        file_path: join(testDir, "src/a.ts"),
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d" },
        ],
        old_string: "a\nc",
        new_string: "b\nd",
      });
      // Patch modes carry the target inside the patch, passed through as is.
      const patch = "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch";
      expect(await payloadFor({ input: patch })).toEqual({ input: patch });
    });

    it("should resolve file paths the way oh-my-pi does", async () => {
      const payloadPath = join(testDir, "payload.json");
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: {
            preToolUse: [{ type: "command", command: `cat > ${JSON.stringify(payloadPath)}` }],
          },
        },
      });
      const ctx = { cwd: testDir, sessionManager: { getSessionId: () => "session-1" } };
      const filePathFor = async (path: string) => {
        await handlerFor("tool_call")({ toolName: "write", input: { path, content: "" } }, ctx);
        return JSON.parse(await readFileContent(payloadPath)).tool_input.file_path;
      };

      // A stray leading `:` before a path shape is stripped.
      expect(await filePathFor(":../escape.txt")).toBe(join(testDir, "..", "escape.txt"));
      // `@` is only a shorthand before an absolute path, `~` or an internal URL.
      expect(await filePathFor("@/etc/hosts")).toBe("/etc/hosts");
      expect(await filePathFor("@my-file.txt")).toBe(join(testDir, "@my-file.txt"));
      // Registered internal schemes are not filesystem paths.
      expect(await filePathFor("local://notes.md")).toBe("local://notes.md");
      // Any other scheme-looking text is a relative path.
      expect(await filePathFor("a://../.env")).toBe(join(testDir, ".env"));
      // A bare root is the workspace root.
      expect(await filePathFor("/")).toBe(testDir);
    });

    it("should map oh-my-pi's glob tool to Glob but leave its find tool alone", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { preToolUse: [{ matcher: "Glob", command: "exit 1" }] },
        },
      });
      const handler = handlerFor("tool_call");

      expect(await handler({ toolName: "glob", input: {} })).toMatchObject({ block: true });
      // oh-my-pi's `find` is a search tool, not Claude Code's `Glob`.
      expect(await handler({ toolName: "find", input: {} })).toBeUndefined();
    });

    it("should cancel the prompt with { handled: true } when the command fails", async () => {
      const gate = await loadPromptGate({ testDir, command: "exit 3" });

      const notify = vi.fn();
      expect(await gate({ text: "hi", source: "interactive" }, uiContext(notify))).toEqual({
        handled: true,
      });
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("3"), "error");
    });

    it("should let the prompt through when the command succeeds", async () => {
      const gate = await loadPromptGate({ testDir, command: "exit 0" });

      const notify = vi.fn();
      expect(await gate({ text: "hi", source: "rpc" }, uiContext(notify))).toEqual({});
      expect(notify).not.toHaveBeenCalled();
    });

    it("should not cancel prompts injected by another extension", async () => {
      // oh-my-pi itself only emits `input` for interactive and RPC prompts;
      // this guards the source check shared with Pi's generated extension.
      const gate = await loadPromptGate({ testDir, command: "exit 3" });

      const notify = vi.fn();
      expect(await gate({ text: "hi", source: "extension" }, uiContext(notify))).toEqual({});
      expect(notify).not.toHaveBeenCalled();
    });

    it("should run postToolUseFailure commands only for failed tool results", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { postToolUseFailure: [{ type: "command", command: "exit 3" }] },
        },
      });
      const handler = handlerFor("tool_result");

      await expect(handler({ toolName: "bash", isError: false })).resolves.toBeUndefined();
      await expect(handler({ toolName: "bash", isError: true })).rejects.toMatchObject({
        code: 3,
      });
    });
  });

  describe("generated session_stop handler", () => {
    it("should ask for one continuation when a stop command exits with 2", async () => {
      const { registeredEvents, handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { stop: [{ command: "echo tests are failing >&2; exit 2" }] },
        },
      });
      const stop = handlerFor("session_stop");

      expect(registeredEvents).toEqual(["session_stop", "session_shutdown"]);
      expect(await stop(stopEvent())).toEqual({
        continue: true,
        additionalContext: "Stop hook feedback:\ntests are failing",
      });
      // oh-my-pi sets stop_hook_active on the continuation's stop pass; a
      // second failure must not loop, and is left for oh-my-pi to report.
      await expect(stop(stopEvent({ stopHookActive: true }))).rejects.toMatchObject({ code: 2 });
    });

    it("should continue when the event carries no last assistant message", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: { version: 1, hooks: { stop: [{ command: "echo retry >&2; exit 2" }] } },
      });

      expect(
        await handlerFor("session_stop")({ ...stopEvent(), last_assistant_message: undefined }),
      ).toEqual({ continue: true, additionalContext: "Stop hook feedback:\nretry" });
    });

    it("should not continue a run that ended on a provider error", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: { version: 1, hooks: { stop: [{ command: "exit 2" }] } },
      });

      await expect(
        handlerFor("session_stop")(stopEvent({ stopReason: "error" })),
      ).rejects.toMatchObject({ code: 2 });
    });

    it("should not continue for a stop command failing with an exit code other than 2", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: { stop: [{ command: "exit 1" }, { command: "rulesync-missing-command-3080" }] },
        },
      });

      await expect(handlerFor("session_stop")(stopEvent())).rejects.toMatchObject({ code: 1 });
    });

    it("should run every stop command and combine their feedback", async () => {
      const marker = join(testDir, "second-ran");
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: {
          version: 1,
          hooks: {
            stop: [
              { command: "echo first >&2; exit 2" },
              { command: `touch "${marker}"` },
              { command: "echo third >&2; exit 2" },
            ],
          },
        },
      });

      expect(await handlerFor("session_stop")(stopEvent())).toEqual({
        continue: true,
        additionalContext: "Stop hook feedback:\nfirst\n\nthird",
      });
      expect(await fileExists(marker)).toBe(true);
    });

    it("should let the run settle when every stop command succeeds", async () => {
      const { handlerFor } = await loadOmpExtension({
        testDir,
        config: { version: 1, hooks: { stop: [{ command: "true" }] } },
      });

      expect(await handlerFor("session_stop")(stopEvent())).toBeUndefined();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw because oh-my-pi hooks cannot be converted back", () => {
      const hooks = new OmpHooks({
        outputRoot: testDir,
        relativeDirPath: join(".omp", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
        fileContent: "export default function () {}",
        validate: false,
      });

      expect(() => hooks.toRulesyncHooks()).toThrow(
        "Not implemented because oh-my-pi hooks are generated as a TypeScript extension file.",
      );
    });
  });

  describe("fromFile", () => {
    it("should load from .omp/extensions/rulesync-hooks.ts", async () => {
      const extensionsDir = join(testDir, ".omp", "extensions");
      await ensureDir(extensionsDir);
      const content = "export default function () {}";
      await writeFileContent(join(extensionsDir, "rulesync-hooks.ts"), content);

      const hooks = await OmpHooks.fromFile({ outputRoot: testDir, validate: false });
      expect(hooks).toBeInstanceOf(OmpHooks);
      expect(hooks.getFileContent()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should return an OmpHooks instance with empty content that is deletable", () => {
      const hooks = OmpHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".omp", "extensions"),
        relativeFilePath: "rulesync-hooks.ts",
      });
      expect(hooks).toBeInstanceOf(OmpHooks);
      expect(hooks.getFileContent()).toBe("");
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});
