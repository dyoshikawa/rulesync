import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
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

    it("should not map stop or notification, which oh-my-pi has no Pi-compatible event for", () => {
      const content = generate({
        testDir,
        config: {
          version: 1,
          hooks: {
            stop: [{ command: "echo stop" }],
            notification: [{ command: "echo notify" }],
          },
        },
      });

      expect(content).not.toContain("agent_before_settle");
      expect(content).not.toContain("agent_settled");
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

      expect(content).toContain('await run("echo omp");');
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
      expect(registeredEvents).toEqual(["tool_call"]);
      const handler = handlerFor("tool_call");

      expect(await handler({ toolName: "bash", input: {} })).toEqual({
        block: true,
        reason: "denied",
      });
      expect(await handler({ toolName: "read", input: {} })).toBeUndefined();
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
