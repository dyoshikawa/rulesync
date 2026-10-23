// cspell:ignore nothrow -- Bun Shell API
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

/**
 * Fake of the slice of the OpenCode V2 plugin context and Bun Shell the
 * generated plugin touches, used to run the plugin's `setup` in tests.
 */
type ShellResult = { exitCode: number; stdout: string; stderr: string };
type FakeHookHandler = (event: Record<string, unknown>) => Promise<void>;

function createFakeRuntime(resultFor: (command: string) => ShellResult) {
  const commands: string[] = [];
  const hooks = new Map<string, FakeHookHandler>();
  const pendingEvents: Array<Record<string, unknown>> = [];
  let wakeEventStream: (() => void) | undefined;

  const shell = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce(
      (acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ""),
      "",
    );
    commands.push(command);
    const result = resultFor(command);
    const nothrowPromise = Promise.resolve(result);
    const promise = Object.assign(
      result.exitCode === 0
        ? Promise.resolve(result)
        : Promise.reject(new Error(`exit ${result.exitCode}`)),
      {
        nothrow: () => Object.assign(nothrowPromise, { quiet: () => nothrowPromise }),
        quiet: () => promise,
      },
    );
    // Silence unhandled rejections for promises the plugin converts with nothrow().
    promise.catch(() => {});
    return promise;
  };
  const shellInstance = Object.assign(shell, { cwd: vi.fn() });

  const domain = (name: string) => ({
    hook: async (hookName: string, handler: FakeHookHandler) => {
      hooks.set(`${name}:${hookName}`, handler);
      return { dispose: async () => {} };
    },
  });

  const ctx = {
    location: { directory: "/project" },
    tool: domain("tool"),
    session: domain("session"),
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            const next = pendingEvents.shift();
            if (next) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              wakeEventStream = resolve;
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          }
        },
      }),
    },
  };

  const bun = {
    $: {
      Shell: function Shell() {
        return shellInstance;
      },
    },
  };

  return {
    ctx,
    bun,
    commands,
    hooks,
    emit: async (event: Record<string, unknown>) => {
      pendingEvents.push(event);
      wakeEventStream?.();
      // Let the event loop pick the event up and run its command.
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

describe("OpencodeHooks (OpenCode V2)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const generate = (config: Record<string, unknown>): string => {
    const rulesyncHooks = new RulesyncHooks({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: JSON.stringify({ version: 1, ...config }),
      validate: false,
    });
    return OpencodeHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks,
      validate: false,
    }).getFileContent();
  };

  const loadPlugin = async (content: string, name: string) => {
    const filePath = join(testDir, `${name}.mjs`);
    await writeFileContent(filePath, content);
    const module = await import(pathToFileURL(filePath).href);
    return module.default as {
      id: string;
      setup: (ctx: unknown) => Promise<(() => Promise<void>) | void>;
    };
  };

  describe("getSettablePaths", () => {
    it("should return .opencode/plugins and rulesync-hooks.js", () => {
      expect(OpencodeHooks.getSettablePaths()).toEqual({
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
    });

    it("should return .config/opencode/plugins for global mode", () => {
      expect(OpencodeHooks.getSettablePaths({ global: true })).toEqual({
        relativeDirPath: join(".config", "opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
    });
  });

  describe("fromRulesyncHooks", () => {
    it("emits a V2 `{ id, setup }` plugin instead of the V1 module", () => {
      const content = generate({
        hooks: { preToolUse: [{ command: "echo pre" }] },
      });

      expect(content.startsWith("export default {\n")).toBe(true);
      expect(content).toContain('id: "rulesync-hooks"');
      expect(content).toContain("setup: async (ctx) => {");
      expect(content).toContain("const $ = new Bun.$.Shell();");
      expect(content).toContain("$.cwd(directory);");
      expect(content).not.toContain("RulesyncHooksPlugin");
      expect(content).not.toContain("server:");
      execFileSync("node", ["--input-type=module", "--check"], {
        input: content,
      });
    });

    it("registers every supported event on its V2 hook point or event type", () => {
      const content = generate({
        hooks: {
          sessionStart: [{ command: "echo session-start" }],
          sessionDelete: [{ command: "echo session-delete" }],
          preToolUse: [{ command: "echo pre-tool" }],
          postToolUse: [{ command: "echo post-tool" }],
          postToolUseFailure: [{ command: "echo post-tool-failure" }],
          beforeShellExecution: [{ command: "echo before-shell" }],
          afterShellExecution: [{ command: "echo after-shell" }],
          beforeSubmitPrompt: [{ command: "echo prompt" }],
          preModelInvocation: [{ command: "echo model" }],
          preCompact: [{ command: "echo pre-compact" }],
          postCompact: [{ command: "echo post-compact" }],
          stop: [{ command: "echo stop" }],
          afterError: [{ command: "echo error" }],
          permissionRequest: [{ command: "echo permission-asked" }],
          permissionDenied: [{ command: "echo permission-denied" }],
        },
      });

      for (const hook of [
        'ctx.tool.hook("execute.before"',
        'ctx.tool.hook("execute.after"',
        'ctx.session.hook("prompt"',
        'ctx.session.hook("context"',
        'ctx.session.hook("compaction"',
      ]) {
        expect(content.split(hook).length - 1).toBe(1);
      }
      for (const eventType of [
        "session.created",
        "session.deleted",
        "session.compaction.ended",
        "session.execution.succeeded",
        "session.execution.failed",
        "permission.asked",
        "permission.replied",
      ]) {
        expect(content).toContain(`(event.type === "${eventType}")`);
      }
      expect(content).toContain("ctx.event.subscribe({ signal: __rulesyncEvents.signal })");
      expect(content).toContain("__rulesyncEvents.abort();");
      execFileSync("node", ["--input-type=module", "--check"], {
        input: content,
      });
    });

    it("gates the shell events on the V2 `shell` tool and splits execute.after by status", () => {
      const content = generate({
        hooks: {
          beforeShellExecution: [{ command: "echo before-shell" }],
          afterShellExecution: [{ command: "echo after-shell" }],
          postToolUse: [{ command: "echo ok" }],
          postToolUseFailure: [{ command: "echo failed" }],
          permissionDenied: [{ command: "echo denied" }],
        },
      });

      expect(content.split('if (event.tool === "shell")').length - 1).toBe(2);
      expect(content).not.toContain('"bash"');
      expect(content).toContain('if (event.status === "completed")');
      expect(content).toContain('if (event.status === "error")');
      expect(content).toContain('if (event.data?.reply === "reject")');
    });

    it("skips events without a verified OpenCode V2 counterpart", () => {
      const content = generate({
        hooks: {
          afterFileEdit: [{ command: "echo file-edit" }],
          fileChanged: [{ command: "echo file-changed" }],
          notification: [{ command: "echo toast" }],
          userPromptExpansion: [{ command: "echo expansion" }],
        },
      });

      expect(content).not.toContain("file-edit");
      expect(content).not.toContain("file-changed");
      expect(content).not.toContain("toast");
      expect(content).not.toContain("expansion");
      expect(content).toBe(
        [
          "export default {",
          '  id: "rulesync-hooks",',
          "  setup: async () => {",
          "  },",
          "};",
          "",
        ].join("\n"),
      );
    });

    it("honors matchers on the tool hooks against the tool name", () => {
      const content = generate({
        hooks: {
          postToolUse: [{ matcher: "write|edit", command: "echo formatted" }],
        },
      });

      expect(content).toContain(
        'if (event.status === "completed" && new RegExp("write|edit").test(event.tool)) {',
      );
    });

    it("drops matcher-carrying definitions on hook points with nothing to match", () => {
      const content = generate({
        hooks: {
          beforeShellExecution: [{ matcher: "git", command: "echo shell-matched" }],
          beforeSubmitPrompt: [{ matcher: "x", command: "echo prompt-matched" }],
          stop: [{ matcher: "x", command: "echo stop-matched" }],
        },
      });

      expect(content).not.toContain("shell-matched");
      expect(content).not.toContain("prompt-matched");
      expect(content).not.toContain("stop-matched");
    });

    it("pipes a PreToolUse payload built from the V2 event into preToolUse commands", () => {
      const content = generate({
        hooks: { preToolUse: [{ matcher: "shell", command: "./guard.sh" }] },
      });

      expect(content).toContain('hook_event_name: "PreToolUse",');
      expect(content).toContain("session_id: event.sessionID,");
      expect(content).toContain("tool_use_id: event.id,");
      expect(content).toContain("tool_name: event.tool,");
      expect(content).toContain("tool_input: event.input,");
      expect(content).toContain("cwd: directory,");
      expect(content).toContain(
        "__rulesyncEnforcePreToolUseResult(await $`echo ${__rulesyncPreToolUseInput()} | ./guard.sh`.nothrow().quiet());",
      );
      expect(content).toContain("function sanitizeBlockReason(raw) {");
    });

    it("merges config.opencode.hooks on top of shared hooks and ignores opencodev1 overrides", () => {
      const content = generate({
        hooks: { sessionStart: [{ command: "shared.sh" }] },
        opencode: {
          hooks: {
            sessionStart: [{ command: "opencode-override.sh" }],
            stop: [{ command: "opencode-only.sh" }],
          },
        },
        opencodev1: { hooks: { stop: [{ command: "v1-only.sh" }] } },
      });

      expect(content).toContain("opencode-override.sh");
      expect(content).not.toContain("shared.sh");
      expect(content).toContain("opencode-only.sh");
      expect(content).not.toContain("v1-only.sh");
    });

    it("skips prompt-type hooks", () => {
      const content = generate({
        hooks: { stop: [{ type: "prompt", prompt: "Summarize" }] },
      });
      expect(content).not.toContain("session.execution.succeeded");
    });

    it("escapes template literal syntax in commands", () => {
      const content = generate({
        hooks: { stop: [{ command: "echo ${HOME} `date` \\n" }] },
      });
      expect(content).toContain("await $`echo \\${HOME} \\`date\\` \\\\n`;");
      execFileSync("node", ["--input-type=module", "--check"], {
        input: content,
      });
    });

    it("throws on an invalid matcher regex", () => {
      expect(() =>
        generate({
          hooks: { preToolUse: [{ matcher: "[invalid", command: "echo x" }] },
        }),
      ).toThrow("Invalid regex pattern in hook matcher: [invalid");
    });
  });

  describe("generated plugin at runtime", () => {
    it("blocks a tool call when a preToolUse command exits 2, with a sanitized reason", async () => {
      const content = generate({
        hooks: {
          preToolUse: [{ matcher: "^shell$", command: "./guard.sh" }],
          beforeShellExecution: [{ command: "echo before-shell" }],
        },
      });
      const runtime = createFakeRuntime((command) =>
        command.endsWith("./guard.sh") && command.includes("rm -rf")
          ? { exitCode: 2, stdout: "", stderr: "no rm\u001b[31m here\n" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
      vi.stubGlobal("Bun", runtime.bun);
      const plugin = await loadPlugin(content, "block");
      const dispose = await plugin.setup(runtime.ctx);
      const before = runtime.hooks.get("tool:execute.before");
      expect(before).toBeDefined();

      await expect(
        before?.({
          tool: "shell",
          sessionID: "s1",
          id: "c1",
          input: { command: "rm -rf /" },
        }),
      ).rejects.toThrow("no rm here");
      const payload = JSON.parse(
        runtime.commands[0]?.replace(/^echo /, "").replace(/ \| \.\/guard\.sh$/, "") ?? "",
      );
      expect(payload).toEqual({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_use_id: "c1",
        tool_name: "shell",
        tool_input: { command: "rm -rf /" },
        cwd: "/project",
      });

      await before?.({
        tool: "shell",
        sessionID: "s1",
        id: "c2",
        input: { command: "ls" },
      });
      expect(runtime.commands).toContain("echo before-shell");

      await before?.({ tool: "read", sessionID: "s1", id: "c3", input: {} });
      expect(runtime.commands.filter((command) => command === "echo before-shell")).toHaveLength(1);
      await (dispose as () => Promise<void>)();
    });

    it("blocks a tool call on a JSON permissionDecision deny", async () => {
      const content = generate({
        hooks: { preToolUse: [{ command: "./guard.sh" }] },
      });
      const runtime = createFakeRuntime(() => ({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: "deny",
            permissionDecisionReason: "nope",
          },
        }),
        stderr: "",
      }));
      vi.stubGlobal("Bun", runtime.bun);
      const plugin = await loadPlugin(content, "deny");
      const dispose = await plugin.setup(runtime.ctx);

      await expect(
        runtime.hooks.get("tool:execute.before")?.({
          tool: "write",
          input: {},
        }),
      ).rejects.toThrow("nope");
      await (dispose as () => Promise<void>)();
    });

    it("runs event-stream hooks and keeps the stream alive after a failing command", async () => {
      const content = generate({
        hooks: {
          sessionStart: [{ command: "exit 1" }, { command: "echo session-start" }],
          stop: [{ command: "echo stop" }],
          permissionDenied: [{ command: "echo denied" }],
        },
      });
      const runtime = createFakeRuntime((command) =>
        command === "exit 1"
          ? { exitCode: 1, stdout: "", stderr: "" }
          : { exitCode: 0, stdout: "", stderr: "" },
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("Bun", runtime.bun);
      const plugin = await loadPlugin(content, "events");
      const dispose = await plugin.setup(runtime.ctx);

      await runtime.emit({ type: "session.created", data: {} });
      await runtime.emit({
        type: "permission.replied",
        data: { reply: "once" },
      });
      await runtime.emit({
        type: "permission.replied",
        data: { reply: "reject" },
      });
      await runtime.emit({ type: "session.execution.succeeded", data: {} });

      expect(runtime.commands).toEqual([
        "exit 1",
        "echo session-start",
        "echo denied",
        "echo stop",
      ]);
      await (dispose as () => Promise<void>)();
    });
  });

  describe("toRulesyncHooks", () => {
    it("should throw because OpenCode hooks cannot be converted back", () => {
      const opencodeHooks = new OpencodeHooks({
        outputRoot: testDir,
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
        fileContent: "export default { id: 'x', setup() {} }",
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
      const content = 'export default { id: "rulesync-hooks", setup: async () => {} };\n';
      await writeFileContent(join(pluginsDir, "rulesync-hooks.js"), content);

      const opencodeHooks = await OpencodeHooks.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(opencodeHooks).toBeInstanceOf(OpencodeHooks);
      expect(opencodeHooks.getFileContent()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should return an OpencodeHooks instance with empty content for deletion", () => {
      const hooks = OpencodeHooks.forDeletion({
        outputRoot: testDir,
        relativeDirPath: join(".opencode", "plugins"),
        relativeFilePath: "rulesync-hooks.js",
      });
      expect(hooks).toBeInstanceOf(OpencodeHooks);
      expect(hooks.getFileContent()).toBe("");
      expect(hooks.isDeletable()).toBe(true);
    });
  });
});
