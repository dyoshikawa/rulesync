import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import {
  CANONICAL_TO_OPENCODE_EVENT_NAMES,
  CANONICAL_TO_OPENCODE_V2_EVENT_NAMES,
  type HooksConfig,
  OPENCODE_HOOK_EVENTS,
  OPENCODE_V2_HOOK_EVENTS,
} from "../../types/hooks.js";
import { writeFileContent } from "../../utils/file.js";
import {
  ALWAYS_BLOCKING_EVENTS,
  BLOCKING_HOOKS,
  generateOpencodeStylePluginCode,
  SHELL_EVENT_TOOL_GATES,
} from "./opencode-style-generator.js";
import {
  generateOpencodeV2PluginCode,
  isBlockingOpencodeV2Target,
} from "./opencode-v2-plugin-generator.js";

const SUPPORTED_EVENTS = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "beforeShellExecution",
  "afterShellExecution",
];

type ShellResult = { exitCode: number; stdout: string; stderr: string };
type ShellCall = { command: string; values: unknown[] };

/**
 * Stubs the `Bun.spawn` the generated plugin runs commands with: answers the
 * Bun CLI probe, records each command with its stdin as `values[0]` and
 * settles with a scripted result. Returns `$` too, for the plugin context.
 */
function createFakeShell(
  resultFor: (command: string) => ShellResult,
  probe: () => Record<string, unknown> | undefined = () => undefined,
) {
  const calls: ShellCall[] = [];
  const stream = (text: string) => new Response(text).body;
  vi.stubGlobal("Bun", {
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    spawn: (argv: string[], options: { stdin: Uint8Array | string }) => {
      const command = String(argv.at(-1)).replace(/^export BUN_BE_BUN=\n/, "");
      if (command === "echo rulesync") {
        return { stdout: stream("rulesync"), ...(probe() ?? { exited: Promise.resolve(0) }) };
      }
      calls.push({ command, values: [new TextDecoder().decode(options.stdin as Uint8Array)] });
      const { exitCode, stdout, stderr } = resultFor(command);
      return { exited: Promise.resolve(exitCode), stdout: stream(stdout), stderr: stream(stderr) };
    },
  });
  return { $: undefined, calls };
}

const ok = (stdout = ""): ShellResult => ({ exitCode: 0, stdout, stderr: "" });

type ToolExecuteBefore = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: unknown },
) => Promise<void>;

describe("generateOpencodeStylePluginCode", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let moduleCounter = 0;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const generate = (hooks: HooksConfig["hooks"], exportStyle: "named" | "default" = "named") =>
    generateOpencodeStylePluginCode(
      { version: 1, hooks },
      SUPPORTED_EVENTS,
      exportStyle === "named" ? "opencode" : "kilo",
      CANONICAL_TO_OPENCODE_EVENT_NAMES,
      exportStyle,
    );

  /** Import the generated module and return its `tool.execute.before` hook. */
  const loadBeforeHook = async ({
    code,
    exportStyle,
    $,
    directory,
  }: {
    code: string;
    exportStyle: "named" | "default";
    $: unknown;
    directory?: string;
  }): Promise<ToolExecuteBefore> => {
    moduleCounter += 1;
    const filePath = join(testDir, `plugin-${moduleCounter}.mjs`);
    await writeFileContent(filePath, code);
    const mod = await import(/* @vite-ignore */ pathToFileURL(filePath).href);
    const hooks =
      exportStyle === "named"
        ? await mod.RulesyncHooksPlugin({ $, directory })
        : await mod.default.server({ $, directory });
    return hooks["tool.execute.before"];
  };

  describe("preToolUse stdin payload (named OpenCode export)", () => {
    it("should emit the payload, the deny-aware helper and piped commands", () => {
      const code = generate({
        preToolUse: [
          { type: "command", command: "guard.sh" },
          { type: "command", command: "bash-guard.sh", matcher: "bash" },
        ],
      });

      expect(code.startsWith("export const RulesyncHooksPlugin = async ({ directory }) => {")).toBe(
        true,
      );
      for (const line of [
        "  const __rulesyncEnforcePreToolUseResult = (result, failClosed) => {",
        '    "tool.execute.before": async (input, output) => {',
        "          tool_input: output?.args,",
        "          cwd: directory ?? process.cwd(),",
        '      __rulesyncEnforcePreToolUseResult(await __rulesyncRunCommand({ command: "guard.sh", input: __rulesyncPreToolUseInput(), seconds: 600 }));',
        '        const __re = new RegExp("bash");',
        '          __rulesyncEnforcePreToolUseResult(await __rulesyncRunCommand({ command: "bash-guard.sh", input: __rulesyncPreToolUseInput(), seconds: 600 }));',
      ]) {
        expect(code).toContain(line);
      }
      execFileSync("node", ["--input-type=module", "--check"], { input: code });
    });

    it("should pass an explicit failClosed to the timeout check and leave an unset one out", () => {
      const code = generate({
        preToolUse: [
          { type: "command", command: "closed.sh", failClosed: true },
          { type: "command", command: "open.sh", failClosed: false },
          { type: "command", command: "default.sh" },
        ],
      });
      const runStatement = (command: string) =>
        code
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.includes(`command: ${JSON.stringify(command)},`));

      expect(runStatement("closed.sh")).toMatch(
        /^__rulesyncEnforcePreToolUseResult\(await __rulesyncRunCommand\(\{ .* \}\), true\);$/,
      );
      expect(runStatement("open.sh")).toMatch(
        /^__rulesyncEnforcePreToolUseResult\(await __rulesyncRunCommand\(\{ .* \}\), false\);$/,
      );
      expect(runStatement("default.sh")).toMatch(
        /^__rulesyncEnforcePreToolUseResult\(await __rulesyncRunCommand\(\{ .* \}\)\);$/,
      );
      // Unset and `true` both deny a timed-out call; only an explicit `false` lets it through.
      expect(code).toContain(
        'if (failClosed !== false) throw new Error("preToolUse hook timed out.");',
      );
    });

    it("should pass a Claude Code-style payload with the raw OpenCode tool name on stdin", async () => {
      const { $, calls } = createFakeShell(() => ok());
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await before(
        { tool: "github_create_issue", sessionID: "ses_1", callID: "call_1" },
        { args: { title: "x" } },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe("guard.sh");
      expect(JSON.parse(String(calls[0]?.values[0]))).toEqual({
        hook_event_name: "PreToolUse",
        session_id: "ses_1",
        tool_use_id: "call_1",
        tool_name: "github_create_issue",
        tool_input: { title: "x" },
        cwd: testDir,
      });
    });

    it("should report the plugin context's directory as cwd", async () => {
      const { $, calls } = createFakeShell(() => ok());
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
        directory: "/work/project",
      });

      await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} });

      expect(JSON.parse(String(calls[0]?.values[0])).cwd).toBe("/work/project");
    });

    it("should serialize the payload lazily and only once per tool call", async () => {
      const { $, calls } = createFakeShell(() => ok());
      const before = await loadBeforeHook({
        code: generate({
          preToolUse: [
            { type: "command", command: "first.sh", matcher: "^bash$" },
            { type: "command", command: "second.sh", matcher: "^bash$" },
          ],
        }),
        exportStyle: "named",
        $,
      });
      let argsReads = 0;
      const output = {
        get args() {
          argsReads += 1;
          return { command: "ls" };
        },
      };

      await before({ tool: "edit", sessionID: "s", callID: "c" }, output);
      expect(argsReads).toBe(0);
      expect(calls).toHaveLength(0);

      await before({ tool: "bash", sessionID: "s", callID: "c" }, output);
      expect(argsReads).toBe(1);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.values[0]).toBe(calls[0]?.values[0]);
    });

    it("should strip control characters from and cap the deny reason", async () => {
      const { $ } = createFakeShell(() => ({
        exitCode: 2,
        stdout: "",
        stderr: `\u001b[31mno\u202e push\u001b[0m\r\n${"x".repeat(3000)}`,
      }));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      const error = await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message.startsWith("no push\nxxx")).toBe(true);
      expect(message).toHaveLength(2003);
      expect(message.endsWith("...")).toBe(true);
    });

    it("should sanitize the permissionDecisionReason too", async () => {
      const decision = JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "\u001b[2J stop\u200b here",
        },
      });
      const { $ } = createFakeShell(() => ok(decision));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow(/^stop here$/);
    });

    it("should deny with stderr as the reason on exit code 2", async () => {
      const { $ } = createFakeShell(() => ({ exitCode: 2, stdout: "", stderr: "no git push\n" }));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "git push" } }),
      ).rejects.toThrow("no git push");
    });

    it("should fall back to a default reason on exit code 2 with empty stderr", async () => {
      const { $ } = createFakeShell(() => ({ exitCode: 2, stdout: "", stderr: "" }));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow("Blocked by a preToolUse hook.");
    });

    it("should deny on exit 0 with a permissionDecision of deny", async () => {
      const decision = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Re-check the destination first",
        },
      });
      const { $ } = createFakeShell(() => ok(decision));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow("Re-check the destination first");
    });

    it("should deny on exit 0 with the deprecated decision of block", async () => {
      const decision = JSON.stringify({ decision: "block", reason: "Use the wrapper script" });
      const { $ } = createFakeShell(() => ok(decision));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow("Use the wrapper script");
    });

    it("should allow on exit 0 with non-JSON, empty or non-deny output", async () => {
      for (const stdout of [
        "",
        "plain text\n",
        "null",
        JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }),
        // `permissionDecision` takes precedence over the deprecated `decision`.
        JSON.stringify({ decision: "block", hookSpecificOutput: { permissionDecision: "allow" } }),
      ]) {
        const { $ } = createFakeShell(() => ok(stdout));
        const before = await loadBeforeHook({
          code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
          exportStyle: "named",
          $,
        });

        await expect(
          before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
        ).resolves.toBeUndefined();
      }
    });

    it("should keep blocking on other non-zero exits, as the throwing Bun Shell call did", async () => {
      const { $ } = createFakeShell(() => ({ exitCode: 1, stdout: "", stderr: "" }));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow("preToolUse hook command failed with exit code 1.");
    });

    it("should probe the Bun CLI again when its time limit cut the last probe short", async () => {
      vi.useFakeTimers();
      let probes = 0;
      const { calls } = createFakeShell(
        () => ok(),
        () => {
          probes += 1;
          if (probes > 1) return undefined;
          let kill = () => {};
          const exited = new Promise<number>((resolve) => (kill = () => resolve(1)));
          return { exited, kill, stdout: new Response("").body };
        },
      );
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $: undefined,
      });

      // The hung probe is killed after 10 s; this call falls back (to a Bun Shell the fake lacks).
      const first = before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} });
      const settled = expect(first).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
      // It counts as no Bun CLI for 5 minutes; past that, the next command probes again.
      await vi.advanceTimersByTimeAsync(300_000);
      await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} });
      vi.useRealTimers();

      expect(probes).toBe(2);
      expect(calls.map((call) => call.command)).toEqual(["guard.sh"]);
    });

    it("should probe the Bun CLI again when the last probe exited 0 without printing rulesync", async () => {
      vi.useFakeTimers();
      let probes = 0;
      const { calls } = createFakeShell(
        () => ok(),
        () => {
          probes += 1;
          if (probes > 1) return undefined;
          return { exited: Promise.resolve(0), stdout: new Response("not bun").body };
        },
      );
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }),
        exportStyle: "named",
        $: undefined,
      });

      // The probe exits 0 with other output; this call falls back (to a Bun Shell the fake lacks).
      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
      ).rejects.toThrow();
      // It counts as no Bun CLI for 5 minutes, not for the life of the process.
      await vi.advanceTimersByTimeAsync(300_000);
      await before({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} });
      vi.useRealTimers();

      expect(probes).toBe(2);
      expect(calls.map((call) => call.command)).toEqual(["guard.sh"]);
    });

    it("should not run a command whose matcher does not match the raw tool name", async () => {
      const { $, calls } = createFakeShell(() => ({ exitCode: 2, stdout: "", stderr: "denied" }));
      const before = await loadBeforeHook({
        code: generate({
          preToolUse: [{ type: "command", command: "bash-guard.sh", matcher: "^bash$" }],
        }),
        exportStyle: "named",
        $,
      });

      await expect(
        before({ tool: "edit", sessionID: "s", callID: "c" }, { args: {} }),
      ).resolves.toBeUndefined();
      expect(calls).toHaveLength(0);
    });

    it("should keep escaping commands placed after the stdin pipe", () => {
      const code = generate({
        preToolUse: [{ type: "command", command: "echo ${HOME} `id` \\x" }],
      });

      expect(code).toContain(
        '__rulesyncRunCommand({ command: "echo \\\\${HOME} \\\\`id\\\\` \\\\\\\\x", input: __rulesyncPreToolUseInput(), seconds: 600 })',
      );
      execFileSync("node", ["--input-type=module", "--check"], { input: code });
    });

    it("should leave the bash-gated beforeShellExecution handler without a payload", () => {
      const code = generate({
        beforeShellExecution: [{ type: "command", command: "pre-shell.sh" }],
      });

      expect(code).toContain('"tool.execute.before": async (input) => {');
      expect(code).toContain(
        '        await __rulesyncRunHook({ label: "beforeShellExecution", command: "pre-shell.sh", input: "", blocking: true, seconds: 600 });',
      );
      expect(code).not.toContain("__rulesyncEnforcePreToolUseResult");
      expect(code).not.toContain("JSON.stringify");
    });

    it("should pipe a PostToolUse payload and only log a failing command", () => {
      const code = generate({ postToolUse: [{ type: "command", command: "post.sh" }] });

      expect(code).toContain('"tool.execute.after": async (input, output) => {');
      expect(code).toContain(
        '      await __rulesyncRunHook({ label: "postToolUse", command: "post.sh", input: __rulesyncPostToolUseInput(), blocking: false, seconds: 600 });',
      );
      expect(code).not.toContain("__rulesyncEnforcePreToolUseResult");
    });
  });

  describe("preToolUse stdin payload (default Kilo export)", () => {
    it("should define the helper inside server and stay valid ESM", () => {
      const code = generate(
        { preToolUse: [{ type: "command", command: "guard.sh", matcher: "bash" }] },
        "default",
      );

      expect(code).toContain(
        [
          "export default {",
          '  id: "rulesync-hooks",',
          "  server: async ({ directory }) => {",
          "    const __rulesyncRead = (stream, limit = 1048576) => {",
        ].join("\n"),
      );
      expect(code).toContain(
        [
          "    return {",
          '      "tool.execute.before": async (input, output) => {',
          "        let __rulesyncPreToolUseInputCache;",
        ].join("\n"),
      );
      expect(code).toContain(
        '            __rulesyncEnforcePreToolUseResult(await __rulesyncRunCommand({ command: "guard.sh", input: __rulesyncPreToolUseInput(), seconds: 600 }));',
      );
      execFileSync("node", ["--input-type=module", "--check"], { input: code });
    });

    it("should pass the payload and deny on exit code 2", async () => {
      const { $, calls } = createFakeShell(() => ({ exitCode: 2, stdout: "", stderr: "blocked" }));
      const before = await loadBeforeHook({
        code: generate({ preToolUse: [{ type: "command", command: "guard.sh" }] }, "default"),
        exportStyle: "default",
        $,
      });

      await expect(
        before({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "ls" } }),
      ).rejects.toThrow("blocked");
      expect(JSON.parse(String(calls[0]?.values[0]))).toMatchObject({
        hook_event_name: "PreToolUse",
        tool_name: "bash",
        tool_input: { command: "ls" },
      });
    });
  });
});

describe("sessionStart context", () => {
  const config = (hooks: HooksConfig["hooks"]): HooksConfig => ({ version: 1, hooks });
  // Every target that shares these generators, with the hook its plugin adds the context through.
  const targets = [
    ...(["opencodev1", "kilo", "mimocode"] as const).map((target) => ({
      target,
      hook: '"experimental.chat.system.transform": async (input, output) => {',
      start: "await __rulesyncSessionStart(",
      generate: (hooks: HooksConfig["hooks"]) =>
        generateOpencodeStylePluginCode(
          config(hooks),
          OPENCODE_HOOK_EVENTS,
          target,
          CANONICAL_TO_OPENCODE_EVENT_NAMES,
          target === "kilo" ? "default" : "named",
        ),
    })),
    {
      target: "opencode",
      hook: 'await ctx.session.hook("context", async (event) => {',
      // The serial V2 event loop must not wait for the commands.
      start: "void __rulesyncSessionStart(",
      generate: (hooks: HooksConfig["hooks"]) =>
        generateOpencodeV2PluginCode({
          config: config(hooks),
          supportedEvents: OPENCODE_V2_HOOK_EVENTS,
          toolConfigKey: "opencode",
          eventMap: CANONICAL_TO_OPENCODE_V2_EVENT_NAMES,
        }),
    },
  ];

  it.each(targets)(
    "adds it through the system prompt hook in $target",
    ({ hook, start, generate }) => {
      const content = generate({ sessionStart: [{ command: "echo context" }] });

      expect(content.split(hook).length - 1).toBe(1);
      expect(content).toContain(start);
      expect(content).toContain("context: true }));");
      expect(content).toContain(
        'if (event.type === "session.deleted") __rulesyncSessionContexts.delete(',
      );
      execFileSync("node", ["--input-type=module", "--check"], { input: content });
    },
  );

  it.each(targets)(
    "leaves the $target plugin unchanged without sessionStart",
    ({ hook, generate }) => {
      const content = generate({ stop: [{ command: "echo stop" }] });

      expect(content).not.toContain(hook);
      expect(content).not.toContain("__rulesyncSessionContext");
      expect(content).toContain('command: "echo stop"');
    },
  );
});

describe("ALWAYS_BLOCKING_EVENTS", () => {
  // The failClosed warnings rely on this set; it must match what the plugins actually block on.
  const expected = [...ALWAYS_BLOCKING_EVENTS, "preToolUse"].toSorted();

  it("matches the V1 plugin's blocking hooks", () => {
    const blocking = Object.keys({
      ...CANONICAL_TO_OPENCODE_EVENT_NAMES,
      ...SHELL_EVENT_TOOL_GATES,
    })
      .filter((event) => {
        const toolEvent =
          SHELL_EVENT_TOOL_GATES[event]?.toolEvent ?? CANONICAL_TO_OPENCODE_EVENT_NAMES[event];
        return toolEvent !== undefined && BLOCKING_HOOKS.has(toolEvent);
      })
      .toSorted();

    expect(blocking).toEqual(expected);
  });

  it("matches the V2 plugin's blocking hook points, minus the V1-only userPromptExpansion", () => {
    const blocking = Object.entries(CANONICAL_TO_OPENCODE_V2_EVENT_NAMES)
      .filter(([, target]) => isBlockingOpencodeV2Target(target))
      .map(([event]) => event)
      .toSorted();

    expect(blocking).toEqual(expected.filter((event) => event !== "userPromptExpansion"));
  });
});
