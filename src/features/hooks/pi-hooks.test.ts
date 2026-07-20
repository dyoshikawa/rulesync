import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { PiHooks } from "./pi-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

function rulesyncHooks(outputRoot: string, config: object): RulesyncHooks {
  return new RulesyncHooks({
    outputRoot,
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: "hooks.json",
    fileContent: JSON.stringify(config),
    validate: false,
  });
}

describe("PiHooks", () => {
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

  it("uses Pi's project and global extension paths", () => {
    expect(PiHooks.getSettablePaths()).toEqual({
      relativeDirPath: join(".pi", "extensions"),
      relativeFilePath: "rulesync-hooks.ts",
    });
    expect(PiHooks.getSettablePaths({ global: true })).toEqual({
      relativeDirPath: join(".pi", "agent", "extensions"),
      relativeFilePath: "rulesync-hooks.ts",
    });
  });

  it("maps only the supported canonical events to documented Pi events", () => {
    const hooks = Object.fromEntries(
      [
        "sessionStart",
        "sessionEnd",
        "beforeSubmitPrompt",
        "preModelInvocation",
        "postModelInvocation",
        "preToolUse",
        "postToolUse",
        "postToolUseFailure",
        "stop",
        "preCompact",
        "contextOffload",
        "notification",
      ].map((event) => [event, [{ command: `${event}.sh` }]]),
    );
    const generated = PiHooks.fromRulesyncHooks({
      outputRoot: testDir,
      rulesyncHooks: rulesyncHooks(testDir, { version: 1, hooks }),
      validate: false,
    }).getFileContent();

    for (const event of [
      "session_start",
      "session_shutdown",
      "input",
      "context",
      "turn_end",
      "tool_call",
      "tool_result",
      "agent_end",
      "session_before_compact",
      "session_before_tree",
    ]) {
      expect(generated).toContain(`pi.on("${event}"`);
    }
    expect(generated).not.toContain("notification.sh");
  });

  it("exports command hooks only, defaults a missing type to command, and preserves timeout", () => {
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [
            { command: "default-command.sh", timeout: 3 },
            { type: "command", command: "explicit-command.sh" },
            { type: "prompt", prompt: "do not export" },
            { type: "http", url: "https://example.com" },
            { type: "command" },
          ],
        },
      }),
      validate: false,
    }).getFileContent();

    expect(generated).toContain('"command":"default-command.sh","timeout":3');
    expect(generated).toContain('"command":"explicit-command.sh"');
    expect(generated).not.toContain("do not export");
    expect(generated).not.toContain("example.com");
  });

  it("applies pi-specific event overrides instead of shared definitions", () => {
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, {
        version: 1,
        hooks: {
          sessionStart: [{ command: "shared-start.sh" }],
          stop: [{ command: "shared-stop.sh" }],
        },
        pi: { hooks: { sessionStart: [{ command: "pi-start.sh" }] } },
      }),
      validate: false,
    }).getFileContent();

    expect(generated).toContain("pi-start.sh");
    expect(generated).not.toContain("shared-start.sh");
    expect(generated).toContain("shared-stop.sh");
  });

  it("matches tool hooks by tool name and splits successful and failed results", () => {
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, {
        version: 1,
        hooks: {
          preToolUse: [{ command: "before.sh", matcher: "^(bash|read)$" }],
          postToolUse: [{ command: "success.sh", matcher: "bash" }],
          postToolUseFailure: [{ command: "failure.sh", matcher: "bash" }],
        },
      }),
      validate: false,
    }).getFileContent();

    expect(generated).toContain("matches(hook.matcher, event.toolName)");
    expect(generated).toContain("if (!event.isError)");
    expect(generated).toContain("if (event.isError)");
  });

  it("runs commands in Pi's cwd, sends stable JSON on stdin, and converts seconds to milliseconds", () => {
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, {
        hooks: { sessionStart: [{ command: "start.sh", timeout: 2 }] },
      }),
      validate: false,
    }).getFileContent();

    expect(generated).toContain("cwd: ctx.cwd");
    expect(generated).toContain(
      "timeout: hook.timeout === undefined ? undefined : hook.timeout * 1000",
    );
    expect(generated).toContain("hook_event_name: canonicalEvent");
    expect(generated).toContain("pi_event_name: piEvent");
    expect(generated).toContain("child.stdin?.end(JSON.stringify(payload))");
  });

  it("escapes commands safely in generated TypeScript", () => {
    const command = "printf '` ${value} \\\\ path'";
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, { hooks: { sessionStart: [{ command }] } }),
      validate: false,
    }).getFileContent();

    expect(generated).toContain(JSON.stringify(command));
    expect(generated).not.toContain(`command: \`${command}\``);
  });

  it("marks only generated content as RuleSync-owned for deletion", () => {
    const generated = PiHooks.fromRulesyncHooks({
      rulesyncHooks: rulesyncHooks(testDir, { hooks: { sessionStart: [{ command: "start.sh" }] } }),
      validate: false,
    });
    const userFile = new PiHooks({
      outputRoot: testDir,
      relativeDirPath: join(".pi", "extensions"),
      relativeFilePath: "rulesync-hooks.ts",
      fileContent: "export default function userExtension() {}",
      validate: false,
    });

    expect(PiHooks.isDeletable(generated)).toBe(true);
    expect(PiHooks.isDeletable(userFile)).toBe(false);
  });

  it("does not support reverse import", () => {
    const generated = new PiHooks({
      outputRoot: testDir,
      relativeDirPath: join(".pi", "extensions"),
      relativeFilePath: "rulesync-hooks.ts",
      fileContent: "// Generated by RuleSync\n",
      validate: false,
    });
    expect(() => generated.toRulesyncHooks()).toThrow("do not support importing");
  });
});
