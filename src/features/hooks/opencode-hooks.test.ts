import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CANONICAL_TO_OPENCODE_EVENT_NAMES, OPENCODE_HOOK_EVENTS } from "../../types/hooks.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { generateOpencodeStylePluginCode } from "./opencode-style-generator.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

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
      expect(content).toContain("cwd: directory,");
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
      expect(content).toContain(
        [
          "for await (const event of ctx.event.subscribe({",
          '        types: ["session.created", "session.deleted", "session.compaction.ended", "session.execution.succeeded", "session.execution.failed", "permission.asked", "permission.replied"],',
          "        signal: __rulesyncEvents.signal,",
          "      })) {",
        ].join("\n"),
      );
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
        'if (event.status === "completed" && __rulesyncMatchesTool(new RegExp("write|edit"), event.tool)) {',
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
        '__rulesyncEnforcePreToolUseResult(await __rulesyncRunCommand({ command: "./guard.sh", input: __rulesyncPreToolUseInput(), seconds: 600 }), false);',
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
      expect(content).toContain(
        'command: "echo \\\\${HOME} \\\\`date\\\\` \\\\\\\\n", input: __rulesyncStopInput(), blocking: false, seconds: 600',
      );
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

  describe("generated plugin at runtime (real Bun)", () => {
    // Records each run: argv, stdin, BUN_BE_BUN and a variable only `.env` sets; prints
    // `visible-<name>` and exits with the given code.
    const HOOK_SCRIPT = [
      'const fs = require("node:fs");',
      'let stdin = "";',
      'process.stdin.on("data", (c) => (stdin += c)).on("end", () => {',
      "  const [name, code, ...rest] = process.argv.slice(2);",
      "  const BUN_BE_BUN = process.env.BUN_BE_BUN || null, RS_DOTENV = process.env.RS_DOTENV || null;",
      '  fs.appendFileSync("rec.jsonl", JSON.stringify({ name, rest, stdin, BUN_BE_BUN, RS_DOTENV }) + "\\n");',
      '  process.stdout.write("visible-" + name + "\\n");',
      "  process.exit(Number(code));",
      "});",
    ].join("\n");

    /**
     * Loads the plugin under the real `bun` with an open stdin, as OpenCode's own is (the TTY,
     * or the pipe of `opencode serve --stdio`), runs `body` (with `hooks`, `push` and `call` in
     * scope) and returns each call's outcome, the subscribed event types, the hook records and
     * what Bun printed.
     */
    type HookRecord = { name: string; rest: string[]; stdin: string } & Record<string, unknown>;
    type RunResult = { out: string[]; types: string[][]; records: HookRecord[]; printed: string };
    const payloadOf = (record?: HookRecord): unknown => JSON.parse(record?.stdin ?? "null");
    const runUnderBun = async ({
      content,
      prelude,
      body,
    }: {
      content: string;
      prelude: string;
      body: string;
    }): Promise<RunResult> => {
      await writeFileContent(join(testDir, "hook.cjs"), HOOK_SCRIPT);
      await writeFileContent(join(testDir, "rec.jsonl"), "");
      await writeFileContent(join(testDir, ".env"), "RS_DOTENV=leaked\n");
      const pluginPath = join(testDir, "plugin.mjs");
      await writeFileContent(pluginPath, content);
      const outPath = join(testDir, "out.json");
      const runnerPath = join(testDir, "runner.mjs");
      await writeFileContent(
        runnerPath,
        [
          `const mod = await import(${JSON.stringify(pathToFileURL(pluginPath).href)});`,
          `const directory = ${JSON.stringify(testDir)};`,
          "let hooks = {}; const types = []; const out = []; let push;",
          "const domain = (d) => ({ hook: async (n, h) => { hooks[d + ':' + n] = h; return { dispose: async () => {} }; } });",
          "const subscribe = (o) => { types.push(o.types); return { [Symbol.asyncIterator]: () => ({ next: () => new Promise((r) => { push = (e) => r({ value: e, done: false }); }) }) }; };",
          "const ctx = { location: { directory }, tool: domain('tool'), session: domain('session'), event: { subscribe } };",
          "const call = async (fn) => { try { await fn(); out.push('ok'); } catch (e) { out.push('threw: ' + e.message); } };",
          prelude,
          body,
          `await Bun.write(${JSON.stringify(outPath)}, JSON.stringify({ out, types }));`,
          "process.exit(0);",
        ].join("\n"),
      );
      const child = spawn("bun", [runnerPath], { stdio: ["pipe", "pipe", "inherit"] });
      let printed = "";
      child.stdout.on("data", (chunk) => (printed += chunk));
      const exit = await new Promise<number | "timeout">((resolve) => {
        const timer = setTimeout(() => (child.kill(), resolve("timeout")), 30_000);
        child.on("exit", (code) => (clearTimeout(timer), resolve(code ?? 1)));
      });
      expect(exit).toBe(0);
      const records = (await readFileContent(join(testDir, "rec.jsonl")))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HookRecord);
      return { ...JSON.parse(await readFileContent(outPath)), records, printed };
    };

    const LEFTOVER_DENY =
      "console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'kept' } })); require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }).unref()";

    it("feeds payloads to every reader, blocks only in hooks that run before their action", async () => {
      const content = generate({
        hooks: {
          preToolUse: [
            { matcher: "^bash$", command: "node hook.cjs pre 0" },
            // Denies through JSON, then leaves a process holding its output: the deny must survive.
            { matcher: "^edit$", command: `node -e "${LEFTOVER_DENY}"` },
          ],
          beforeShellExecution: [{ command: "node hook.cjs shell-gate 1" }],
          postToolUse: [
            {
              command:
                'node hook.cjs post 0 && node hook.cjs post-b 0 $(node hook.cjs sub 0) "quote\\"inner"',
            },
            { command: "node hook.cjs post-fail 1 # a trailing comment" },
          ],
          stop: [{ command: "node hook.cjs fails 3" }, { command: "node hook.cjs stop 0" }],
        },
      });
      const { out, types, records, printed } = await runUnderBun({
        content,
        prelude: "await mod.default.setup(ctx);",
        body: [
          "await call(() => hooks['tool:execute.before']({ tool: 'shell', sessionID: 's1', id: 'c1', input: { command: 'rm -rf /' } }));",
          "await call(() => hooks['tool:execute.before']({ tool: 'edit', input: {} }));",
          "await call(() => hooks['tool:execute.after']({ tool: 'write', sessionID: 's1', id: 'c2', input: { path: 'a' }, status: 'completed', result: { ok: 1 } }));",
          "push({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });",
          "await Bun.sleep(3000);",
        ].join("\n"),
      });

      // `shell` matches `^bash$` through its OpenCode 1.x name; the guard allows, then the
      // shell gate's non-zero exit blocks the call, as it did before; postToolUse only logs.
      expect(out).toEqual([
        "threw: [rulesync-hooks] beforeShellExecution hook exited with code 1",
        "threw: kept",
        "ok",
      ]);
      expect(types).toEqual([["session.execution.succeeded"]]);
      const byName = Object.fromEntries(records.map((record) => [record.name, record]));
      expect(payloadOf(byName.pre)).toEqual({
        hook_event_name: "PreToolUse",
        session_id: "s1",
        tool_use_id: "c1",
        tool_name: "shell",
        tool_input: { command: "rm -rf /" },
        cwd: testDir,
      });
      expect(payloadOf(byName.post)).toMatchObject({
        hook_event_name: "PostToolUse",
        tool_input: { path: "a" },
        tool_response: { ok: 1 },
      });
      // The first reader consumes the payload; `$(...)` and later parts see its end.
      expect([byName.sub?.stdin, byName["post-b"]?.stdin]).toEqual(["", ""]);
      expect(byName["post-b"]?.rest).toEqual(["visible-sub", "quote\\inner"]);
      expect(byName["post-fail"]?.rest).toEqual([]);
      expect(payloadOf(byName.stop)).toMatchObject({ hook_event_name: "Stop", session_id: "s1" });
      expect(
        records.every((record) => record.BUN_BE_BUN === null && record.RS_DOTENV === null),
      ).toBe(true);
      expect(printed).toContain("visible-post-b");
    }, 60_000);

    it("runs the V1 plugin the same way, and falls back to Bun Shell without the Bun CLI", async () => {
      const content = generateOpencodeStylePluginCode(
        {
          version: 1,
          hooks: {
            postToolUse: [{ command: "node hook.cjs post 0" }],
            beforeSubmitPrompt: [{ command: "node hook.cjs prompt 1" }],
            stop: [{ command: "node hook.cjs stop 0" }],
          },
        },
        OPENCODE_HOOK_EVENTS,
        "opencodev1",
        CANONICAL_TO_OPENCODE_EVENT_NAMES,
      );
      const body = [
        "await call(() => hooks['tool.execute.after']({ tool: 'write', sessionID: 's1', callID: 'c1', args: { filePath: 'a' } }, { title: 'a', output: 'done', metadata: {} }));",
        "await call(() => hooks['chat.message']({ sessionID: 's1' }, { parts: [] }));",
        "await call(() => hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } }));",
      ].join("\n");
      const prelude = "hooks = await mod.RulesyncHooksPlugin({ directory });";
      const viaExec = await runUnderBun({ content, prelude, body });
      expect(viaExec.out).toEqual([
        "ok",
        "threw: [rulesync-hooks] beforeSubmitPrompt hook exited with code 1",
        "ok",
      ]);
      expect(payloadOf(viaExec.records[0])).toMatchObject({
        hook_event_name: "PostToolUse",
        tool_input: { filePath: "a" },
        tool_response: { title: "a", output: "done", metadata: {} },
      });
      expect(payloadOf(viaExec.records[2])).toMatchObject({ hook_event_name: "Stop" });

      // A host binary that is not the Bun CLI: the probe fails and Bun Shell runs the commands.
      const fallback = await runUnderBun({
        content,
        prelude: `process.execPath = ${JSON.stringify(process.execPath)};\n${prelude}`,
        body,
      });
      expect(fallback.out).toEqual(viaExec.out);
      expect(payloadOf(fallback.records[0])).toMatchObject({ hook_event_name: "PostToolUse" });
    }, 60_000);

    it("kills a command at its timeout and stops waiting for output pipes a leftover holds", async () => {
      // Writes its pid and runs forever; with "bg", starts such a child on its own output and exits.
      const forever = [
        'const fs = require("node:fs");',
        "const [name, mode] = process.argv.slice(2);",
        'if (mode === "bg") {',
        '  const child = require("node:child_process").spawn(process.execPath, ["forever.cjs", name], { stdio: "inherit" });',
        "  process.exit(0);",
        "}",
        'fs.appendFileSync("pids.txt", name + " " + process.pid + "\\n");',
        "setInterval(() => {}, 1000);",
      ].join("\n");
      await writeFileContent(join(testDir, "forever.cjs"), forever);
      const run = (failClosed: boolean) =>
        runUnderBun({
          content: generate({
            hooks: {
              preToolUse: [
                { matcher: "^write$", command: "node forever.cjs pre", timeout: 1, failClosed },
              ],
              // Beyond what `setTimeout` can wait: capped, not fired at once.
              beforeShellExecution: [{ command: "node forever.cjs bg bg", timeout: 1e12 }],
              postToolUse: [{ command: "node forever.cjs post", timeout: 1 }],
            },
          }),
          prelude: "await mod.default.setup(ctx);",
          body: [
            "await call(() => hooks['tool:execute.before']({ tool: 'shell', input: {} }));",
            "await call(() => hooks['tool:execute.before']({ tool: 'write', input: {} }));",
            "await call(() => hooks['tool:execute.after']({ tool: 'write', input: {}, status: 'completed' }));",
            // Checked while the host still runs: its exit could end the processes itself.
            "await Bun.sleep(2500);",
            "const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };",
            "const pids = (await Bun.file(directory + '/pids.txt').text()).trim().split('\\n').map((line) => line.split(' '));",
            "out.push('alive: ' + pids.filter(([name, pid]) => name !== 'bg' && alive(Number(pid))).length);",
            // The leftover of the command that exited is not waited for, nor killed on POSIX,
            // where it has left the command's tree; the test ends it.
            "pids.forEach(([, pid]) => alive(Number(pid)) && process.kill(Number(pid)));",
          ].join("\n"),
        });

      expect((await run(false)).out).toEqual(["ok", "ok", "ok", "alive: 0"]);
      expect((await run(true)).out).toEqual([
        "ok",
        "threw: preToolUse hook timed out.",
        "ok",
        "alive: 0",
      ]);
    }, 90_000);
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
