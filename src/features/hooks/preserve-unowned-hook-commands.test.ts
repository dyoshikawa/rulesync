import { describe, expect, it, vi } from "vitest";

import { ownedHookKey } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";

function contentWith(hooks: unknown): string {
  return JSON.stringify({ hooks }, null, 2);
}

function firstGroupCommands(hooks: Record<string, unknown[]>, event: string): string[] {
  const groups = hooks[event];
  if (groups === undefined) {
    throw new Error(`expected ${event}`);
  }
  const group = groups[0] as { hooks: { command: string }[] };
  return group.hooks.map((handler) => handler.command);
}

function merge({
  existing,
  generated,
  shape = "matcher-groups",
  previouslyOwned,
  logger,
}: {
  existing: unknown;
  generated: Record<string, unknown[]>;
  shape?: "matcher-groups" | "flat";
  previouslyOwned?: ReadonlySet<string>;
  logger?: { warn: (message: string) => void };
}) {
  return mergeGeneratedHookLists({
    existingContent: typeof existing === "string" ? existing : contentWith(existing),
    generatedHooks: generated,
    shape,
    preserveUnowned: true,
    previouslyOwned,
    // The adapters pass a full Logger; only `warn` is exercised here.
    logger: logger as never,
  });
}

describe("mergeGeneratedHookLists", () => {
  it("replaces the list untouched when preservation is off", () => {
    const generated = { SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }] };
    const merged = mergeGeneratedHookLists({
      existingContent: contentWith({
        SessionStart: [{ hooks: [{ type: "command", command: "other-tool-hook" }] }],
      }),
      generatedHooks: generated,
      shape: "matcher-groups",
      preserveUnowned: false,
    });

    expect(merged.hooks).toBe(generated);
  });

  it("appends unmatched matcher-group commands and skips duplicates", () => {
    const merged = merge({
      existing: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo rulesync" },
              { type: "command", command: "other-tool-hook claude-hook" },
            ],
          },
        ],
      },
      generated: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo rulesync" }] }],
      },
    });

    expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual([
      "echo rulesync",
      "other-tool-hook claude-hook",
    ]);
  });

  it("keeps an existing event that generate did not emit", () => {
    const merged = merge({
      existing: {
        Stop: [{ hooks: [{ type: "command", command: "other-tool-hook claude-hook" }] }],
      },
      generated: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
    });

    expect(firstGroupCommands(merged.hooks, "Stop")).toEqual(["other-tool-hook claude-hook"]);
    expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual(["echo start"]);
  });

  it("keeps a non-command handler that generate did not emit", () => {
    const merged = merge({
      existing: {
        SessionStart: [{ hooks: [{ type: "http", url: "https://example.test/hook" }] }],
      },
      generated: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
    });

    expect(merged.hooks.SessionStart).toEqual([
      {
        hooks: [
          { type: "command", command: "echo start" },
          { type: "http", url: "https://example.test/hook" },
        ],
      },
    ]);
  });

  it("does not throw when an existing event is named toString", () => {
    const merged = merge({
      existing: JSON.parse(
        '{"toString":[{"hooks":[{"type":"command","command":"other-tool-hook"}]}]}',
      ),
      generated: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
      },
    });

    expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual(["echo start"]);
    expect(firstGroupCommands(merged.hooks, "toString")).toEqual(["other-tool-hook"]);
  });

  it("merges Cursor flat handler arrays without duplicating a command", () => {
    const merged = merge({
      existing: {
        sessionStart: [{ command: "shared.sh" }, { command: "other-tool-hook cursor-hook" }],
      },
      generated: {
        sessionStart: [{ type: "command", command: "shared.sh" }],
      },
      shape: "flat",
    });

    expect(merged.hooks.sessionStart).toEqual([
      { type: "command", command: "shared.sh" },
      { command: "other-tool-hook cursor-hook" },
    ]);
  });

  it("ignores non-object existing hooks", () => {
    const merged = merge({
      existing: "nope",
      generated: { Stop: [{ hooks: [{ command: "echo" }] }] },
    });

    expect({ ...merged.hooks }).toEqual({ Stop: [{ hooks: [{ command: "echo" }] }] });
  });

  it("warns and replaces when the existing file is not valid JSON", () => {
    const logger = { warn: vi.fn() };
    const merged = merge({
      existing: "{ not json",
      generated: { Stop: [{ hooks: [{ command: "echo" }] }] },
      logger,
    });

    expect({ ...merged.hooks }).toEqual({ Stop: [{ hooks: [{ command: "echo" }] }] });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not valid JSON"));
  });

  describe("ownership", () => {
    it("reports every generated handler as owned", () => {
      const merged = merge({
        existing: {},
        generated: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo a" }] }],
        },
      });

      expect(merged.owned).toEqual([
        { event: "PreToolUse", matcher: '"Bash"', identity: "command:echo a" },
      ]);
    });

    it("does not claim a preserved third-party handler", () => {
      const merged = merge({
        existing: {
          SessionStart: [{ hooks: [{ type: "command", command: "other-tool-hook" }] }],
        },
        generated: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }],
        },
      });

      expect(merged.owned).toEqual([
        { event: "SessionStart", matcher: "", identity: "command:echo start" },
      ]);
    });

    it("retracts a hook the lock says rulesync generated and no longer does", () => {
      const logger = { warn: vi.fn() };
      const merged = merge({
        existing: {
          SessionStart: [
            {
              hooks: [
                { type: "command", command: "removed-from-rulesync.sh" },
                { type: "command", command: "other-tool-hook" },
              ],
            },
          ],
        },
        generated: {},
        previouslyOwned: new Set([
          ownedHookKey({
            event: "SessionStart",
            matcher: "",
            identity: "command:removed-from-rulesync.sh",
          }),
        ]),
        logger,
      });

      expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual(["other-tool-hook"]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Removing hook rulesync no longer generates"),
      );
    });

    it("drops the event entirely once its only hook is retracted", () => {
      const merged = merge({
        existing: {
          SessionStart: [{ hooks: [{ type: "command", command: "removed.sh" }] }],
        },
        generated: {},
        previouslyOwned: new Set([
          ownedHookKey({ event: "SessionStart", matcher: "", identity: "command:removed.sh" }),
        ]),
      });

      expect(Object.hasOwn(merged.hooks, "SessionStart")).toBe(false);
    });

    it("retracts a hook whose generated matcher moved rather than duplicating it", () => {
      const merged = merge({
        existing: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "a.sh" }] }],
        },
        generated: {
          PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "a.sh" }] }],
        },
        previouslyOwned: new Set([
          ownedHookKey({ event: "PreToolUse", matcher: '"Bash"', identity: "command:a.sh" }),
        ]),
      });

      expect(merged.hooks.PreToolUse).toEqual([
        { matcher: "Edit", hooks: [{ type: "command", command: "a.sh" }] },
      ]);
    });

    it("preserves a hook rulesync never recorded, even when it looks generated", () => {
      const merged = merge({
        existing: {
          SessionStart: [{ hooks: [{ type: "command", command: ".rulesync/hooks/theirs.sh" }] }],
        },
        generated: {},
      });

      expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual([
        ".rulesync/hooks/theirs.sh",
      ]);
    });
  });

  describe("identity", () => {
    it("gives a handler with no recognizable action a stable identity", () => {
      const existing = {
        SessionStart: [{ hooks: [{ type: "command", timeout: 5 }] }],
      };
      const first = merge({ existing, generated: {} });
      // The same file merged again must not grow: the shapeless handler is
      // matched by structure, so it is recognized as already present.
      const second = merge({
        existing: contentWith(first.hooks),
        generated: {},
      });

      expect((second.hooks.SessionStart![0] as { hooks: unknown[] }).hooks).toHaveLength(1);
    });

    it("treats mcp_tool handlers with different input as different hooks", () => {
      const merged = merge({
        existing: {
          PreToolUse: [
            {
              hooks: [{ type: "mcp_tool", server: "s", tool: "t", input: { path: "b" } }],
            },
          ],
        },
        generated: {
          PreToolUse: [
            {
              hooks: [{ type: "mcp_tool", server: "s", tool: "t", input: { path: "a" } }],
            },
          ],
        },
      });

      expect((merged.hooks.PreToolUse![0] as { hooks: unknown[] }).hooks).toHaveLength(2);
    });

    it("matches a handler whose key order differs", () => {
      const merged = merge({
        existing: {
          SessionStart: [{ hooks: [{ timeout: 5, type: "command", command: "echo a" }] }],
        },
        generated: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo a", timeout: 5 }] }],
        },
      });

      expect(firstGroupCommands(merged.hooks, "SessionStart")).toEqual(["echo a"]);
    });

    it("keeps groups with different non-string matchers apart", () => {
      const merged = merge({
        existing: {
          PreToolUse: [
            { matcher: { tool: "a" }, hooks: [{ command: "a.sh" }] },
            { matcher: { tool: "b" }, hooks: [{ command: "b.sh" }] },
          ],
        },
        generated: {},
      });

      expect(merged.hooks.PreToolUse).toHaveLength(2);
    });
  });

  describe("malformed entries", () => {
    it("warns and skips an existing event whose value is not an array", () => {
      const logger = { warn: vi.fn() };
      const merged = merge({
        existing: { SessionStart: { hooks: [] } },
        generated: { Stop: [{ hooks: [{ command: "echo" }] }] },
        logger,
      });

      expect(Object.hasOwn(merged.hooks, "SessionStart")).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("expected an array of hook entries"),
      );
    });

    it("warns and skips a non-object handler", () => {
      const logger = { warn: vi.fn() };
      const merged = merge({
        existing: { SessionStart: [{ hooks: ["echo"] }] },
        generated: {},
        logger,
      });

      expect(Object.hasOwn(merged.hooks, "SessionStart")).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("expected a hook object"));
    });

    it("strips a prototype-polluting key from a preserved handler", () => {
      const merged = merge({
        existing: JSON.parse(
          '{"SessionStart":[{"hooks":[{"command":"theirs.sh","__proto__":{"polluted":true}}]}]}',
        ),
        generated: {},
      });

      const handler = (merged.hooks.SessionStart![0] as { hooks: Record<string, unknown>[] })
        .hooks[0]!;
      expect(Object.hasOwn(handler, "__proto__")).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("keeps group-level keys when a whole existing group is preserved", () => {
      const merged = merge({
        existing: {
          PreToolUse: [
            { matcher: "Bash", commandRegex: "^git ", hooks: [{ command: "theirs.sh" }] },
          ],
        },
        generated: {},
      });

      expect(merged.hooks.PreToolUse).toEqual([
        { matcher: "Bash", commandRegex: "^git ", hooks: [{ command: "theirs.sh" }] },
      ]);
    });
  });
});
