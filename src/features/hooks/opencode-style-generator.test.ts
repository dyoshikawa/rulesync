// cspell:ignore nothrow -- Bun Shell API (`.nothrow()`)
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CANONICAL_TO_OPENCODE_EVENT_NAMES, type HooksConfig } from "../../types/hooks.js";
import { writeFileContent } from "../../utils/file.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";
import { generateOpencodeStylePluginCode } from "./opencode-style-generator.js";

const SUPPORTED_EVENTS = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "beforeShellExecution",
  "afterShellExecution",
];

type ShellResult = { exitCode: number; stdout: string; stderr: string };
type ShellCall = { command: string; values: unknown[]; nothrow: boolean; quiet: boolean };

/**
 * A stand-in for Bun Shell's `$`: records each command (with the interpolated
 * values replaced by `<value>`) and resolves `.quiet()` with a scripted
 * result. Mirrors Bun's default mode, where a non-zero exit rejects unless
 * `.nothrow()` was called first. Commands awaited without `.quiet()` (the
 * handlers without a stdin payload) resolve to the shell object itself.
 */
function createFakeShell(resultFor: (command: string) => ShellResult) {
  const calls: ShellCall[] = [];
  const $ = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call: ShellCall = {
      command: strings.join("<value>"),
      values,
      nothrow: false,
      quiet: false,
    };
    calls.push(call);
    const settle = () => {
      const result = resultFor(call.command);
      if (result.exitCode !== 0 && !call.nothrow) {
        return Promise.reject(new Error(`ShellError: exit code ${result.exitCode}`));
      }
      return Promise.resolve({
        exitCode: result.exitCode,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr),
      });
    };
    const shellPromise = {
      nothrow() {
        call.nothrow = true;
        return shellPromise;
      },
      quiet() {
        call.quiet = true;
        return settle();
      },
    };
    return shellPromise;
  };
  return { $, calls };
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

      expect(code).toBe(
        [
          "export const RulesyncHooksPlugin = async ({ $, directory }) => {",
          ...buildBlockReasonSanitizerLines({ typed: false }).map((line) =>
            line === "" ? "" : `  ${line}`,
          ),
          "",
          "  const __rulesyncEnforcePreToolUseResult = (result) => {",
          "    const stderr = result.stderr.toString();",
          "    if (result.exitCode === 0) {",
          "      let parsed;",
          "      try {",
          "        parsed = JSON.parse(result.stdout.toString());",
          "      } catch {",
          "        return;",
          "      }",
          '      const specific = parsed && typeof parsed === "object" ? parsed.hookSpecificOutput : undefined;',
          '      if (specific && typeof specific === "object" && specific.permissionDecision === "deny") {',
          "        throw new Error(",
          '          (typeof specific.permissionDecisionReason === "string" &&',
          "            sanitizeBlockReason(specific.permissionDecisionReason)) ||",
          '            "Blocked by a preToolUse hook.",',
          "        );",
          "      }",
          "      return;",
          "    }",
          "    if (result.exitCode === 2) {",
          '      throw new Error(sanitizeBlockReason(stderr) || "Blocked by a preToolUse hook.");',
          "    }",
          "    throw new Error(",
          "      sanitizeBlockReason(stderr) ||",
          '        "preToolUse hook command failed with exit code " + result.exitCode + ".",',
          "    );",
          "  };",
          "  return {",
          '    "tool.execute.before": async (input, output) => {',
          "      let __rulesyncPreToolUseInputCache;",
          "      const __rulesyncPreToolUseInput = () =>",
          "        (__rulesyncPreToolUseInputCache ??= JSON.stringify({",
          '          hook_event_name: "PreToolUse",',
          "          session_id: input.sessionID,",
          "          tool_use_id: input.callID,",
          "          tool_name: input.tool,",
          "          tool_input: output?.args,",
          "          cwd: directory ?? process.cwd(),",
          "        }));",
          "      __rulesyncEnforcePreToolUseResult(await $`echo ${__rulesyncPreToolUseInput()} | guard.sh`.nothrow().quiet());",
          "      {",
          '        const __re = new RegExp("bash");',
          "        if (__re.test(input.tool)) {",
          "          __rulesyncEnforcePreToolUseResult(await $`echo ${__rulesyncPreToolUseInput()} | bash-guard.sh`.nothrow().quiet());",
          "        }",
          "      }",
          "    },",
          "  };",
          "};",
          "",
        ].join("\n"),
      );
      execFileSync("node", ["--input-type=module", "--check"], { input: code });
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
      expect(calls[0]?.command).toBe("echo <value> | guard.sh");
      expect(calls[0]?.nothrow).toBe(true);
      expect(calls[0]?.quiet).toBe(true);
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

    it("should allow on exit 0 with non-JSON, empty or non-deny output", async () => {
      for (const stdout of [
        "",
        "plain text\n",
        "null",
        JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }),
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
        "await $`echo ${__rulesyncPreToolUseInput()} | echo \\${HOME} \\`id\\` \\\\x`.nothrow().quiet()",
      );
      execFileSync("node", ["--input-type=module", "--check"], { input: code });
    });

    it("should leave the bash-gated beforeShellExecution handler without a payload", () => {
      const code = generate({
        beforeShellExecution: [{ type: "command", command: "pre-shell.sh" }],
      });

      expect(code).toContain('"tool.execute.before": async (input) => {');
      expect(code).toContain("        await $`pre-shell.sh`;");
      expect(code).not.toContain("__rulesyncEnforcePreToolUseResult");
      expect(code).not.toContain("JSON.stringify");
    });

    it("should leave postToolUse handlers unchanged", () => {
      const code = generate({ postToolUse: [{ type: "command", command: "post.sh" }] });

      expect(code).toContain('"tool.execute.after": async (input) => {');
      expect(code).toContain("      await $`post.sh`;");
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
          "  server: async ({ $, directory }) => {",
          "    const MAX_BLOCK_REASON_LENGTH = 2000;",
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
        "            __rulesyncEnforcePreToolUseResult(await $`echo ${__rulesyncPreToolUseInput()} | guard.sh`.nothrow().quiet());",
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
