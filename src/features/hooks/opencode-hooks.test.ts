// cspell:ignore todoread -- OpenCode tool id
import { execFileSync, spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CANONICAL_TO_OPENCODE_EVENT_NAMES, OPENCODE_HOOK_EVENTS } from "../../types/hooks.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { generateOpencodeStylePluginCode } from "./opencode-style-generator.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

/** The matcher regexes a generated plugin embeds, compiled in source order. */
function embeddedMatchers(content: string): RegExp[] {
  return [...content.matchAll(/new RegExp\(("(?:[^"\\]|\\.)*")\)/g)].map(
    ([, literal]) => new RegExp(JSON.parse(literal ?? '""') as string),
  );
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

  const generate = (
    config: Record<string, unknown>,
    logger?: ReturnType<typeof createMockLogger>,
  ): string => {
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
      logger,
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
    it("warns about a failClosed the plugin ignores where it changes the outcome", () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const rulesyncHooks = new RulesyncHooks({
        outputRoot: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "hooks.json",
        fileContent: JSON.stringify({
          version: 1,
          hooks: {
            preToolUse: [{ command: "guard.sh", failClosed: true }],
            beforeShellExecution: [{ command: "shell-guard.sh", failClosed: false }],
            preCompact: [{ command: "compact-guard.sh", failClosed: true }],
            postToolUse: [{ command: "format.sh", failClosed: true }],
            stop: [{ command: "audit.sh", failClosed: false }],
          },
        }),
        validate: false,
      });

      OpencodeHooks.fromRulesyncHooks({ outputRoot: testDir, rulesyncHooks, logger });

      // A hook that runs before its action always blocks on a failure, so there only a `false`
      // is ignored; elsewhere a failure is only logged, so only a `true` is.
      expect(warnSpy.mock.calls).toEqual([
        [
          'failClosed: false on "beforeShellExecution" hook will be ignored — the generated OpenCode plugin always blocks the action when this hook fails or times out, and only supports failClosed on preToolUse',
        ],
        [
          'failClosed on "postToolUse" hook will be ignored — the generated OpenCode plugin only supports failClosed on preToolUse',
        ],
      ]);
    });

    it("emits a V2 `{ id, setup }` plugin instead of the V1 module", () => {
      const content = generate({
        hooks: { preToolUse: [{ command: "echo pre" }] },
      });

      expect(content.startsWith("export default {\n")).toBe(true);
      expect(content).toContain('id: "rulesync-hooks:" + import.meta.url,');
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
        'ctx.session.hook("compaction"',
      ]) {
        expect(content.split(hook).length - 1).toBe(1);
      }
      // preModelInvocation's, and the one that adds sessionStart context to the system prompt.
      expect(content.split('ctx.session.hook("context"').length - 1).toBe(2);
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
          '  id: "rulesync-hooks:" + import.meta.url,',
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

    it("translates canonical tool names in matchers to the names OpenCode reports", () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const content = generate(
        {
          hooks: {
            preToolUse: [
              { matcher: "Read|Edit|Write", command: "echo guarded" },
              { matcher: "^Bash$", command: "echo shell-guarded" },
              { matcher: "mcp__srv__Read|webfetch", command: "echo untouched" },
            ],
          },
        },
        logger,
      );

      expect(content).toContain(
        '__rulesyncMatchesTool(new RegExp("^(?:read|edit|write)$"), event.tool)',
      );
      expect(content).toContain('__rulesyncMatchesTool(new RegExp("^shell$"), event.tool)');
      expect(content).toContain(
        '__rulesyncMatchesTool(new RegExp("mcp__srv__Read|webfetch"), event.tool)',
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns about a capitalized matcher name with no OpenCode equivalent", () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const content = generate(
        { hooks: { postToolUse: [{ matcher: "Edit|MultiEdit", command: "echo fmt" }] } },
        logger,
      );

      expect(content).toContain(
        '__rulesyncMatchesTool(new RegExp("^(?:edit|MultiEdit)$"), event.tool)',
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('"MultiEdit"');
      expect(warnSpy.mock.calls[0]?.[0]).toContain('"postToolUse" matcher');
    });

    it("translates whole names only, override matchers too, and warns once per matcher", () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, "warn");
      const content = generate(
        {
          hooks: {
            preToolUse: [
              { matcher: "\\bRead\\b|ReadFile", command: "echo partial" },
              { matcher: "Glob", command: "echo glob-1" },
              { matcher: "Glob", command: "echo glob-2" },
            ],
          },
          opencode: { hooks: { postToolUse: [{ matcher: "Write", command: "echo override" }] } },
        },
        logger,
      );

      expect(content).toContain(
        '__rulesyncMatchesTool(new RegExp("\\\\bread\\\\b|ReadFile"), event.tool)',
      );
      expect(content).toContain('__rulesyncMatchesTool(new RegExp("^(?:write)$"), event.tool)');
      expect(warnSpy.mock.calls).toEqual([
        [expect.stringContaining('"ReadFile" in the "preToolUse" matcher')],
        [expect.stringContaining('"Glob" in the "preToolUse" matcher')],
      ]);
      expect(warnSpy.mock.calls[1]?.[0]).toContain("is not translated by rulesync");
    });

    it("anchors translated plain-name matchers so they match whole tool names only", () => {
      const content = generate({
        hooks: {
          preToolUse: [
            { command: "write.sh", matcher: "Write" },
            { command: "files.sh", matcher: "Read|Edit|Write" },
            { command: "regex.sh", matcher: "^Wr" },
          ],
        },
      });

      const [write, files, regex] = embeddedMatchers(content);
      expect(write?.test("write")).toBe(true);
      expect(write?.test("todowrite")).toBe(false);
      expect(["read", "edit", "write"].every((tool) => files?.test(tool))).toBe(true);
      expect(["todoread", "todowrite", "multiedit"].some((tool) => files?.test(tool))).toBe(false);
      // A regex-style matcher is written as-is.
      expect(regex?.source).toBe("^Wr");
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
        '__rulesyncEnforcePreToolUseResult(await __rulesyncRunCommand({ command: "./guard.sh", input: __rulesyncPreToolUseInput(), seconds: 600 }));',
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

    it("gives every plugin file its own id, so OpenCode loads the global, project and parent ones", async () => {
      const content = generate({ hooks: { stop: [{ command: "echo stop" }] } });
      const ids: string[] = [];
      for (const name of ["first", "second"]) {
        const filePath = join(testDir, `${name}.mjs`);
        await writeFileContent(filePath, content);
        ids.push((await import(pathToFileURL(filePath).href)).default.id);
      }

      expect(ids[0]).toMatch(/^rulesync-hooks:file:/);
      expect(ids[0]).not.toBe(ids[1]);
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
      "  const BUN_BE_BUN = process.env.BUN_BE_BUN ?? null, RS_DOTENV = process.env.RS_DOTENV || null;",
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
      // Bun Shell has no `unset`: the command sees an empty `BUN_BE_BUN`, which Bun treats as unset.
      expect(records.every((record) => record.BUN_BE_BUN === "" && record.RS_DOTENV === null)).toBe(
        true,
      );
      expect(printed).toContain("visible-post-b");
    }, 60_000);

    it("keeps the event subscription going when building a handler's payload throws", async () => {
      const content = generate({
        hooks: {
          stop: [{ command: "node hook.cjs stop 0" }],
          permissionDenied: [{ command: "node hook.cjs denied 0" }],
        },
      });
      const { out, records } = await runUnderBun({
        content,
        prelude: [
          "console.error = (message) => out.push('error: ' + message);",
          "await mod.default.setup(ctx);",
        ].join("\n"),
        body: [
          // A BigInt session ID makes the Stop payload's JSON.stringify throw.
          "push({ type: 'session.execution.succeeded', data: { sessionID: 1n } });",
          "await Bun.sleep(500);",
          "push({ type: 'permission.replied', data: { reply: 'reject' } });",
          "await Bun.sleep(3000);",
        ].join("\n"),
      });

      expect(out).toEqual(["error: [rulesync-hooks] stop hook failed:"]);
      expect(records.map((record) => record.name)).toEqual(["denied"]);
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
      const run = (failClosed?: boolean) =>
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

      // A timeout denies like a non-zero exit; only an explicit `failClosed: false` lets it through.
      const denied = ["ok", "threw: preToolUse hook timed out.", "ok", "alive: 0"];
      expect((await run()).out).toEqual(denied);
      expect((await run(true)).out).toEqual(denied);
      expect((await run(false)).out).toEqual(["ok", "ok", "ok", "alive: 0"]);

      // Without the Bun CLI, Bun Shell cannot kill the command: the call is still denied,
      // while the command keeps running (the test ends it).
      const fallback = await runUnderBun({
        content: generate({
          hooks: { preToolUse: [{ command: "node forever.cjs fallback", timeout: 1 }] },
        }),
        prelude: `process.execPath = ${JSON.stringify(process.execPath)};\nawait mod.default.setup(ctx);`,
        body: [
          "await call(() => hooks['tool:execute.before']({ tool: 'write', input: {} }));",
          "await Bun.sleep(500);",
          "const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };",
          "const [, pid] = (await Bun.file(directory + '/pids.txt').text()).trim().split('\\n').map((line) => line.trim().split(' ')).find(([name]) => name === 'fallback');",
          "out.push('alive: ' + alive(Number(pid)));",
          "alive(Number(pid)) && process.kill(Number(pid));",
        ].join("\n"),
      });
      expect(fallback.out).toEqual(["threw: preToolUse hook timed out.", "alive: true"]);
    }, 90_000);

    // Killing the command's own process (TerminateProcess) ends that one process. libuv's job
    // object (KILL_ON_JOB_CLOSE | SILENT_BREAKAWAY_OK) then still ends what node spawned itself
    // ("direct"), but not a process started through a non-libuv program ("via-cmd") or a
    // detached one ("detached"): only ending the tree by parent PID reaches those two.
    it.runIf(process.platform === "win32")(
      "ends a timed-out command's descendants on Windows, including via cmd.exe and detached ones",
      async () => {
        const tree = [
          'const fs = require("node:fs");',
          'const { spawn } = require("node:child_process");',
          'fs.appendFileSync("pids.txt", process.argv[2] + " " + process.pid + "\\n");',
          'if (process.argv[2] === "command") {',
          '  spawn(process.execPath, ["tree.cjs", "direct"], { stdio: "ignore" });',
          '  spawn("cmd.exe", ["/c", "node tree.cjs via-cmd"], { stdio: "ignore" });',
          '  spawn(process.execPath, ["tree.cjs", "detached"], { stdio: "ignore", detached: true }).unref();',
          "}",
          "setInterval(() => {}, 1000);",
        ].join("\n");
        await writeFileContent(join(testDir, "tree.cjs"), tree);
        const { out } = await runUnderBun({
          content: generate({
            hooks: { postToolUse: [{ command: "node tree.cjs command", timeout: 2 }] },
          }),
          prelude: "await mod.default.setup(ctx);",
          body: [
            "await call(() => hooks['tool:execute.after']({ tool: 'write', input: {}, status: 'completed' }));",
            "await Bun.sleep(1000);",
            "const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };",
            "const pids = (await Bun.file(directory + '/pids.txt').text()).trim().split('\\n').map((line) => line.trim().split(' '));",
            "out.push('started: ' + pids.map(([name]) => name).sort().join(','));",
            "out.push('alive: ' + pids.filter(([, pid]) => alive(Number(pid))).map(([name]) => name).sort().join(','));",
            "pids.forEach(([, pid]) => alive(Number(pid)) && process.kill(Number(pid)));",
          ].join("\n"),
        });
        expect(out).toEqual(["ok", "started: command,detached,direct,via-cmd", "alive: "]);
      },
      90_000,
    );

    // POSIX only: the check relies on a write to a pipe whose reader is gone failing.
    it.runIf(process.platform !== "win32")(
      "stops reading output pipes a leftover holds once the command has exited",
      async () => {
        // With "bg", prints a line and leaves a child writing to its stdout; that child counts
        // the writes that went through in written.txt and stops at the first failing one.
        const writer = [
          'const fs = require("node:fs");',
          'if (process.argv[2] === "bg") {',
          '  require("node:child_process").spawn(process.execPath, ["writer.cjs"], { stdio: "inherit" });',
          '  console.log("before-exit");',
          "  process.exit(0);",
          "}",
          'fs.writeFileSync("writer.pid", String(process.pid));',
          "const chunk = Buffer.alloc(1024, 120);",
          "let writes = 0;",
          "const timer = setInterval(() => {",
          "  try {",
          "    fs.writeSync(1, chunk);",
          '    fs.writeFileSync("written.txt", String(++writes));',
          "  } catch (error) {",
          '    fs.writeFileSync("written.txt", writes + " " + error.code);',
          "    clearInterval(timer);",
          "  }",
          "}, 10);",
        ].join("\n");
        await writeFileContent(join(testDir, "writer.cjs"), writer);
        // Only preToolUse output is read; an ordinary command writes to the host's own stdout.
        const { out } = await runUnderBun({
          content: generate({ hooks: { preToolUse: [{ command: "node writer.cjs bg" }] } }),
          prelude: "await mod.default.setup(ctx);",
          body: [
            "const started = Date.now();",
            "await call(() => hooks['tool:execute.before']({ tool: 'write', input: {} }));",
            "out.push(Date.now() - started < 5000 ? 'prompt' : 'slow');",
            "const written = () => Bun.file(directory + '/written.txt').text();",
            "await Bun.sleep(500);",
            "const first = await written();",
            "await Bun.sleep(1000);",
            // EPIPE, or ECONNRESET when the pipe is closed with data still unread.
            "const closed = /^\\d+ (EPIPE|ECONNRESET)$/.test(first);",
            "out.push(first === (await written()) ? (closed ? 'closed' : 'stopped: ' + first) : 'still read');",
            "try { process.kill(Number(await Bun.file(directory + '/writer.pid').text())); } catch {}",
          ].join("\n"),
        });

        // What arrived in the 1 s after the exit is read; then the pipe is closed.
        expect(out).toEqual(["ok", "prompt", "closed"]);
      },
      60_000,
    );

    it("streams ordinary hook output without keeping it and denies over 1 MiB of preToolUse stdout", async () => {
      const write = (size: number, tail: string) =>
        `node -e "process.stdout.write(' '.repeat(${size}) + '${tail}')"`;
      const { out, printed } = await runUnderBun({
        content: generate({
          hooks: {
            preToolUse: [{ command: write(2 * 1024 * 1024, "{}") }],
            postToolUse: [{ command: write(50 * 1024 * 1024, "streamed-end") }],
          },
        }),
        prelude: "await mod.default.setup(ctx);",
        body: [
          "await call(() => hooks['tool:execute.before']({ tool: 'write', input: {} }));",
          "const base = process.memoryUsage.rss(); let peak = base;",
          "const sample = setInterval(() => (peak = Math.max(peak, process.memoryUsage.rss())), 5);",
          "await call(() => hooks['tool:execute.after']({ tool: 'write', input: {}, status: 'completed' }));",
          "clearInterval(sample);",
          "out.push(peak - base < 20 * 1048576 ? 'not kept' : 'kept: ' + (peak - base));",
        ].join("\n"),
      });

      expect(out).toEqual([
        "threw: preToolUse hook wrote more than 1 MiB to stdout.",
        "ok",
        "not kept",
      ]);
      expect(printed.endsWith("streamed-end")).toBe(true);
    }, 60_000);

    // Prints what its mode names; `plain` takes a moment and writes to stderr too.
    const CONTEXT_SCRIPT = [
      "const mode = process.argv[2];",
      "const print = (text) => process.stdout.write(text);",
      'if (mode === "plain") setTimeout(() => (process.stderr.write("to-stderr\\n"), print("  plain-context\\n")), 500);',
      'if (mode === "json") print(JSON.stringify({ hookSpecificOutput: { additionalContext: "json-context" } }));',
      'if (mode === "json-none") print(JSON.stringify({ continue: true }));',
      'if (mode === "fail") (print("failed-context"), (process.exitCode = 1));',
      'if (mode === "long") print("x".repeat(12000));',
      'if (mode === "huge") print("y".repeat(2 * 1048576));',
    ].join("\n");

    it("gives sessionStart stdout to the model as context of its own session only", async () => {
      await writeFileContent(join(testDir, "ctx.cjs"), CONTEXT_SCRIPT);
      const content = generate({
        hooks: {
          sessionStart: ["plain", "json", "json-none", "fail"].map((mode) => ({
            command: `node ctx.cjs ${mode}`,
          })),
        },
      });
      const body = [
        "const context = async (sessionID) => {",
        "  const request = { sessionID, system: [{ type: 'text', text: 'base' }] };",
        "  await call(() => hooks['session:context'](request));",
        "  out.push(sessionID + ': ' + request.system.slice(1).map((part) => part.type + ':' + part.text).join('|'));",
        "};",
        "push({ type: 'session.created', data: { sessionID: 's1' } });",
        "await Bun.sleep(50);",
        // The first request waits for the session's sessionStart commands.
        "await context('s1');",
        "await context('s1');",
        "await context('s2');",
        "await Bun.sleep(100);",
        "push({ type: 'session.deleted', data: { sessionID: 's1' } });",
        "await Bun.sleep(100);",
        "await context('s1');",
      ].join("\n");
      const expected = [
        "ok",
        "s1: text:plain-context\n\njson-context",
        "ok",
        "s1: text:plain-context\n\njson-context",
        "ok",
        "s2: ",
        "ok",
        "s1: ",
      ];
      const prelude = "await mod.default.setup(ctx);";
      const viaExec = await runUnderBun({ content, prelude, body });
      expect(viaExec.out).toEqual(expected);
      expect(viaExec.types).toEqual([["session.created", "session.deleted"]]);
      // Its stdout goes to the model instead of OpenCode's own stdout.
      expect(viaExec.printed).not.toContain("context");

      // Bun Shell, when the host binary is not the Bun CLI, gives the same context.
      const fallback = await runUnderBun({
        content,
        prelude: `process.execPath = ${JSON.stringify(process.execPath)};\n${prelude}`,
        body,
      });
      expect(fallback.out).toEqual(expected);
      expect(fallback.printed).not.toContain("context");
    }, 60_000);

    // Unlike the default stub, this event stream queues events the loop has not read yet.
    const QUEUED_EVENTS_PRELUDE = [
      "const queued = []; let wake = () => {};",
      "ctx.event.subscribe = (o) => { types.push(o.types); return { async *[Symbol.asyncIterator]() { for (;;) { while (queued.length) yield queued.shift(); await new Promise((r) => (wake = r)); } } }; };",
      "push = (e) => { queued.push(e); wake(); };",
    ].join("\n");

    it("registers sessionStart context while an earlier event's command is still running", async () => {
      await writeFileContent(join(testDir, "ctx.cjs"), CONTEXT_SCRIPT);
      const content = generate({
        hooks: {
          stop: [
            { command: `node -e "setTimeout(() => {}, 3000)"` },
            { command: "node hook.cjs stop 0" },
          ],
          sessionStart: [{ command: "node ctx.cjs json" }],
        },
      });
      const { out, records } = await runUnderBun({
        content,
        prelude: `${QUEUED_EVENTS_PRELUDE}\nawait mod.default.setup(ctx);`,
        body: [
          "push({ type: 'session.execution.succeeded', data: { sessionID: 's0' } });",
          "await Bun.sleep(50);",
          "push({ type: 'session.created', data: { sessionID: 's1' } });",
          "await Bun.sleep(50);",
          "const started = Date.now();",
          "const request = { sessionID: 's1', system: [] };",
          "await call(() => hooks['session:context'](request));",
          "out.push(request.system.map((part) => part.text).join('|'));",
          "out.push(Date.now() - started < 2000 ? 'not held back' : 'held back');",
          // The slow stop command still finishes, and the next one runs after it.
          "await Bun.sleep(3500);",
        ].join("\n"),
      });

      expect(out).toEqual(["ok", "json-context", "not held back"]);
      expect(records.map((record) => record.name)).toEqual(["stop"]);
    }, 60_000);

    it("runs the other event commands in event order, past a slow or throwing one", async () => {
      const content = generate({
        hooks: {
          stop: [
            { command: `node -e "setTimeout(() => {}, 1500)"` },
            { command: "node hook.cjs stop 0" },
          ],
          sessionDelete: [{ command: "node hook.cjs delete 0" }],
        },
      });
      const { out, records } = await runUnderBun({
        content,
        prelude: [
          "console.error = (message) => out.push('error: ' + message);",
          QUEUED_EVENTS_PRELUDE,
          "await mod.default.setup(ctx);",
        ].join("\n"),
        body: [
          // Reading this event's payload throws; the events after it still run.
          "push({ type: 'session.execution.succeeded', get data() { throw new Error('boom'); } });",
          "push({ type: 'session.execution.succeeded', data: { sessionID: 's1' } });",
          "push({ type: 'session.deleted', data: { sessionID: 's1' } });",
          "const recorded = async () => (await Bun.file(directory + '/rec.jsonl').text()).split('\\n').filter(Boolean).length;",
          "for (let i = 0; i < 400 && (await recorded()) < 2; i++) await Bun.sleep(50);",
        ].join("\n"),
      });

      expect(records.map((record) => record.name)).toEqual(["stop", "delete"]);
      // Each stop handler logs its own throw.
      expect(out).toEqual([
        "error: [rulesync-hooks] stop hook failed:",
        "error: [rulesync-hooks] stop hook failed:",
      ]);
    }, 60_000);

    it("still loads its other hooks when the host has no session context hook", async () => {
      const content = generate({
        hooks: {
          preToolUse: [{ command: "node hook.cjs pre 2" }],
          sessionStart: [{ command: "echo context" }],
        },
      });
      const { out } = await runUnderBun({
        content,
        prelude: [
          "console.error = (message) => out.push('error: ' + message);",
          "const sessionHook = ctx.session.hook;",
          "ctx.session.hook = async (name, handler) => {",
          "  if (name === 'context') throw new Error('unknown hook');",
          "  return sessionHook(name, handler);",
          "};",
          "await mod.default.setup(ctx);",
        ].join("\n"),
        body: "await call(() => hooks['tool:execute.before']({ tool: 'shell', input: {} }));",
      });

      expect(out[0]).toBe(
        "error: [rulesync-hooks] could not register the session context hook; sessionStart output does not reach the model:",
      );
      expect(out.slice(1)).toHaveLength(1);
      expect(out[1]).toMatch(/^threw: /);
    }, 60_000);

    it("adds sessionStart context to the OpenCode 1.x system prompt, capped like Claude Code's", async () => {
      await writeFileContent(join(testDir, "ctx.cjs"), CONTEXT_SCRIPT);
      const content = generateOpencodeStylePluginCode(
        {
          version: 1,
          hooks: {
            sessionStart: [{ command: "node ctx.cjs long" }, { command: "node ctx.cjs huge" }],
          },
        },
        OPENCODE_HOOK_EVENTS,
        "opencodev1",
        CANONICAL_TO_OPENCODE_EVENT_NAMES,
      );
      const { out } = await runUnderBun({
        content,
        prelude: [
          "console.error = (message) => out.push('error: ' + message);",
          "hooks = await mod.RulesyncHooksPlugin({ directory });",
        ].join("\n"),
        body: [
          "const transform = async (sessionID) => {",
          "  const output = { system: ['base'] };",
          "  await call(() => hooks['experimental.chat.system.transform']({ sessionID, model: {} }, output));",
          "  out.push(sessionID + ': ' + output.system.slice(1).map((text) => text[0] + text.length).join('|'));",
          "};",
          "const started = hooks.event({ event: { type: 'session.created', properties: { info: { id: 'v1' } } } });",
          "await transform('v1');",
          "await transform('v2');",
          "await started;",
          "await hooks.event({ event: { type: 'session.deleted', properties: { info: { id: 'v1' } } } });",
          "await transform('v1');",
        ].join("\n"),
      });

      expect(out).toEqual([
        "error: [rulesync-hooks] sessionStart hook wrote more than 1 MiB to stdout; it is ignored",
        "ok",
        "v1: x10000",
        "ok",
        "v2: ",
        "ok",
        "v1: ",
      ]);
    }, 60_000);

    it("keeps the 100 most recently used sessionStart contexts, and an empty one evicts none", async () => {
      const content = generateOpencodeStylePluginCode(
        { version: 1, hooks: { sessionStart: [{ command: "cat ctx.txt" }] } },
        OPENCODE_HOOK_EVENTS,
        "opencodev1",
        CANONICAL_TO_OPENCODE_EVENT_NAMES,
      );
      const { out } = await runUnderBun({
        content,
        prelude: "hooks = await mod.RulesyncHooksPlugin({ directory });",
        body: [
          "const start = async (id, text) => {",
          "  await Bun.write(directory + '/ctx.txt', text);",
          "  await hooks.event({ event: { type: 'session.created', properties: { info: { id } } } });",
          "};",
          "const transform = async (sessionID) => {",
          "  const output = { system: [] };",
          "  await hooks['experimental.chat.system.transform']({ sessionID, model: {} }, output);",
          "  out.push(sessionID + ': ' + output.system.join('|'));",
          "};",
          "for (let i = 1; i <= 100; i++) await start('s' + i, 'context-' + i);",
          "await start('empty', '');",
          // s1 is still kept; reading it makes it the most recently used.
          "await transform('s1');",
          "await start('s101', 'context-101');",
          "await transform('s2');",
          "await transform('s1');",
          "await transform('s101');",
        ].join("\n"),
      });

      expect(out).toEqual(["s1: context-1", "s2: ", "s1: context-1", "s101: context-101"]);
    }, 60_000);

    it("evicts sessionStart contexts in completion order, not start order", async () => {
      // Prints ctx.txt as read at start; a `slow` one marks that it has read it, then
      // waits until the test releases it.
      await writeFileContent(
        join(testDir, "ctx-wait.cjs"),
        [
          'const fs = require("node:fs");',
          'const text = fs.readFileSync("ctx.txt", "utf8");',
          "const done = () => process.stdout.write(text);",
          'if (!text.startsWith("slow")) done();',
          'else { fs.writeFileSync("started", ""); const timer = setInterval(() => fs.existsSync("release") && (clearInterval(timer), done()), 20); }',
        ].join("\n"),
      );
      const content = generateOpencodeStylePluginCode(
        { version: 1, hooks: { sessionStart: [{ command: "node ctx-wait.cjs" }] } },
        OPENCODE_HOOK_EVENTS,
        "opencodev1",
        CANONICAL_TO_OPENCODE_EVENT_NAMES,
      );
      const { out } = await runUnderBun({
        content,
        prelude: "hooks = await mod.RulesyncHooksPlugin({ directory });",
        body: [
          "const created = (id) => hooks.event({ event: { type: 'session.created', properties: { info: { id } } } });",
          "const transform = async (sessionID) => {",
          "  const output = { system: [] };",
          "  await hooks['experimental.chat.system.transform']({ sessionID, model: {} }, output);",
          "  out.push(sessionID + ': ' + output.system.join('|'));",
          "};",
          "await Bun.write(directory + '/ctx.txt', 'slow-context');",
          "const slow = created('slow');",
          "for (let i = 0; i < 400 && !(await Bun.file(directory + '/started').exists()); i++) await Bun.sleep(25);",
          "for (let i = 1; i <= 100; i++) {",
          "  await Bun.write(directory + '/ctx.txt', 'context-' + i);",
          "  await created('s' + i);",
          "}",
          "await Bun.write(directory + '/release', '');",
          "await slow;",
          "await Bun.sleep(50);",
          "await transform('s1');",
          "await transform('slow');",
        ].join("\n"),
      });

      expect(out).toEqual(["s1: ", "slow: slow-context"]);
    }, 60_000);

    it("writes a timed-out sessionStart command's stderr to the host once it ends on Bun Shell", async () => {
      const content = generateOpencodeStylePluginCode(
        {
          version: 1,
          hooks: {
            sessionStart: [
              {
                command: `node -e "setTimeout(() => process.stderr.write('late-stderr'), 1500)"`,
                timeout: 1,
              },
            ],
          },
        },
        OPENCODE_HOOK_EVENTS,
        "opencodev1",
        CANONICAL_TO_OPENCODE_EVENT_NAMES,
      );
      const { out } = await runUnderBun({
        content,
        prelude: [
          "const write = process.stderr.write.bind(process.stderr);",
          "process.stderr.write = (chunk, ...rest) => (String(chunk).includes('late-stderr') && out.push('stderr: ' + chunk), write(chunk, ...rest));",
          "hooks = await mod.RulesyncHooksPlugin({ directory });",
        ].join("\n"),
        body: [
          "await hooks.event({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });",
          "out.push('timed out');",
          "await Bun.sleep(2500);",
        ].join("\n"),
      });

      expect(out).toEqual(["timed out", "stderr: late-stderr"]);
    }, 60_000);

    // A Windows program ends its lines with CRLF; the context is trimmed of it.
    it.runIf(process.platform === "win32")(
      "reads sessionStart context printed through cmd.exe on Windows",
      async () => {
        const { out } = await runUnderBun({
          content: generate({
            hooks: { sessionStart: [{ command: "cmd.exe /c echo win-context" }] },
          }),
          prelude: "await mod.default.setup(ctx);",
          body: [
            "push({ type: 'session.created', data: { sessionID: 's1' } });",
            "await Bun.sleep(50);",
            "const request = { sessionID: 's1', system: [] };",
            "await call(() => hooks['session:context'](request));",
            "out.push(JSON.stringify(request.system));",
          ].join("\n"),
        });
        expect(out).toEqual(["ok", JSON.stringify([{ type: "text", text: "win-context" }])]);
      },
      60_000,
    );

    // POSIX only: the guard is an `sh` script.
    it.runIf(process.platform !== "win32")(
      "ends the payload with a newline",
      async () => {
        const { out } = await runUnderBun({
          content: generate({ hooks: { preToolUse: [{ command: "sh -c 'read -r payload'" }] } }),
          prelude: "await mod.default.setup(ctx);",
          body: "await call(() => hooks['tool:execute.before']({ tool: 'write', input: {} }));",
        });

        // `read` fails at an end of input that is not preceded by a newline, as `echo` wrote it.
        expect(out).toEqual(["ok"]);
      },
      60_000,
    );

    // POSIX only: the stand-in host is a script run through its shebang.
    it.runIf(process.platform !== "win32")(
      "falls back when the Bun CLI probe never settles, and does not probe again for a while",
      async () => {
        // Stands in for a host binary whose probe hangs: it ignores SIGTERM and only exits at 60 s.
        const host = [
          "#!/usr/bin/env node",
          'require("node:fs").appendFileSync("probes.txt", "probe\\n");',
          'process.on("SIGTERM", () => {});',
          "setTimeout(() => {}, 60000);",
        ].join("\n");
        const hostPath = join(testDir, "host.cjs");
        await writeFileContent(hostPath, host);
        await chmod(hostPath, 0o755);
        const { out, records } = await runUnderBun({
          content: generate({ hooks: { postToolUse: [{ command: "node hook.cjs post 0" }] } }),
          prelude: `process.execPath = ${JSON.stringify(hostPath)};\nawait mod.default.setup(ctx);`,
          body: [
            "for (const _ of [1, 2]) {",
            "  const started = Date.now();",
            "  await call(() => hooks['tool:execute.after']({ tool: 'write', input: {}, status: 'completed' }));",
            "  out.push(Date.now() - started < 9000 ? 'at once' : 'after the deadline');",
            "}",
            "out.push((await Bun.file(directory + '/probes.txt').text()).trim());",
          ].join("\n"),
        });

        expect(out).toEqual(["ok", "after the deadline", "ok", "at once", "probe"]);
        expect(records.map((record) => record.name)).toEqual(["post", "post"]);
      },
      60_000,
    );

    it.runIf(process.platform === "linux")(
      "kills what a command that survives SIGTERM starts during the grace",
      async () => {
        // Stands in for the host's Bun CLI (a `bun exec` process dies on SIGTERM): answers the
        // exec probe, and for a command records its pid, survives SIGTERM and starts a child then.
        const host = [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          'if (process.argv[4] === "echo rulesync") {',
          '  console.log("rulesync");',
          "  process.exit(0);",
          "}",
          'fs.appendFileSync("pids.txt", "root " + process.pid + "\\n");',
          'process.on("SIGTERM", () => {',
          '  const late = require("node:child_process").spawn("sleep", ["300"], { stdio: "ignore" });',
          '  fs.appendFileSync("pids.txt", "late " + late.pid + "\\n");',
          "});",
          "setInterval(() => {}, 1000);",
        ].join("\n");
        const hostPath = join(testDir, "host.cjs");
        await writeFileContent(hostPath, host);
        await chmod(hostPath, 0o755);
        const { out } = await runUnderBun({
          content: generate({
            hooks: { postToolUse: [{ command: "ignored by the stand-in", timeout: 1 }] },
          }),
          prelude: `process.execPath = ${JSON.stringify(hostPath)};\nawait mod.default.setup(ctx);`,
          body: [
            "await call(() => hooks['tool:execute.after']({ tool: 'write', input: {}, status: 'completed' }));",
            // A zombie (its parent gone, not reaped yet) counts as dead.
            "const alive = (pid) => { try { const stat = require('node:fs').readFileSync('/proc/' + pid + '/stat', 'utf8'); return stat[stat.lastIndexOf(')') + 2] !== 'Z'; } catch { return false; } };",
            "const read = async () => (await Bun.file(directory + '/pids.txt').text()).trim().split('\\n').map((line) => line.split(' '));",
            // Polled instead of a fixed wait so a slow machine does not fail the test early.
            "let pids = await read();",
            "for (let i = 0; i < 100 && (pids.length < 2 || pids.some(([, pid]) => alive(Number(pid)))); i++) { await Bun.sleep(100); pids = await read(); }",
            "out.push(pids.map(([name]) => name).join(' '));",
            "out.push('alive: ' + pids.filter(([, pid]) => alive(Number(pid))).map(([name]) => name).join(' '));",
            "pids.forEach(([, pid]) => alive(Number(pid)) && process.kill(Number(pid), 'SIGKILL'));",
          ].join("\n"),
        });

        expect(out).toEqual(["ok", "root late", "alive: "]);
      },
      60_000,
    );
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
