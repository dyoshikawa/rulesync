import { describe, expect, it } from "vitest";

import { preserveUnownedHookCommands } from "./preserve-unowned-hook-commands.js";

function firstGroupCommands(hooks: Record<string, unknown[]>, event: string): string[] {
  const groups = hooks[event];
  if (groups === undefined) {
    throw new Error(`expected ${event}`);
  }
  const group = groups[0] as { hooks: { command: string }[] };
  return group.hooks.map((handler) => handler.command);
}

describe("preserveUnownedHookCommands", () => {
  it("appends unmatched matcher-group commands and skips duplicates", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo rulesync" },
              { type: "command", command: "other-tool-hook claude-hook" },
            ],
          },
        ],
      },
      generatedHooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo rulesync" }] }],
      },
      shape: "matcher-groups",
    });

    expect(firstGroupCommands(merged, "SessionStart")).toEqual([
      "echo rulesync",
      "other-tool-hook claude-hook",
    ]);
  });

  it("keeps an existing event that generate did not emit", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        Stop: [{ hooks: [{ type: "command", command: "other-tool-hook claude-hook" }] }],
      },
      generatedHooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
      shape: "matcher-groups",
    });

    expect(firstGroupCommands(merged, "Stop")).toEqual(["other-tool-hook claude-hook"]);
    expect(firstGroupCommands(merged, "SessionStart")).toEqual(["echo start"]);
  });

  it("drops a stale .rulesync/hooks command that generate no longer emits", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: ".rulesync/hooks/old.sh" },
              { type: "command", command: "other-tool-hook claude-hook" },
            ],
          },
        ],
      },
      generatedHooks: {},
      shape: "matcher-groups",
    });

    expect(firstGroupCommands(merged, "SessionStart")).toEqual(["other-tool-hook claude-hook"]);
  });

  it("does not duplicate when a generated matcher changes for the same command", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: ".rulesync/hooks/a.sh" }] },
        ],
      },
      generatedHooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: ".rulesync/hooks/a.sh" }] },
        ],
      },
      shape: "matcher-groups",
    });

    expect(merged.PreToolUse).toEqual([
      { matcher: "Edit", hooks: [{ type: "command", command: ".rulesync/hooks/a.sh" }] },
    ]);
  });

  it("keeps a non-command handler that generate did not emit", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        SessionStart: [{ hooks: [{ type: "http", url: "https://example.test/hook" }] }],
      },
      generatedHooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
      shape: "matcher-groups",
    });

    expect(merged.SessionStart).toEqual([
      {
        hooks: [
          { type: "command", command: "echo start" },
          { type: "http", url: "https://example.test/hook" },
        ],
      },
    ]);
  });

  it("does not throw when an existing event is named toString", () => {
    const existingHooks = JSON.parse(
      '{"toString":[{"hooks":[{"type":"command","command":"other-tool-hook"}]}]}',
    );
    const merged = preserveUnownedHookCommands({
      existingHooks,
      generatedHooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
      shape: "matcher-groups",
    });

    expect(firstGroupCommands(merged, "SessionStart")).toEqual(["echo start"]);
    expect(firstGroupCommands(merged, "toString")).toEqual(["other-tool-hook"]);
  });

  it("merges Cursor flat handler arrays without duplicating a command", () => {
    const merged = preserveUnownedHookCommands({
      existingHooks: {
        sessionStart: [{ command: "shared.sh" }, { command: "other-tool-hook cursor-hook" }],
      },
      generatedHooks: {
        sessionStart: [{ type: "command", command: "shared.sh" }],
      },
      shape: "flat",
    });

    expect(merged.sessionStart).toEqual([
      { type: "command", command: "shared.sh" },
      { command: "other-tool-hook cursor-hook" },
    ]);
  });

  it("ignores non-object existing hooks", () => {
    expect(
      preserveUnownedHookCommands({
        existingHooks: "nope",
        generatedHooks: { Stop: [{ hooks: [{ command: "echo" }] }] },
        shape: "matcher-groups",
      }),
    ).toEqual({ Stop: [{ hooks: [{ command: "echo" }] }] });
  });
});
