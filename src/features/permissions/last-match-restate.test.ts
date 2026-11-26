import { describe, expect, it, vi } from "vite-plus/test";

import { restateAllToolsRestrictionsLast } from "./last-match-restate.js";

describe("restateAllToolsRestrictionsLast", () => {
  it("puts all-tools denies after catch-all allows on last-match-wins tools", () => {
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: {
        "*": { ".env": "deny", "private/**": "deny", "*": "allow" },
      },
      toolTarget: "opencode",
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["*", "allow"],
      [".env", "deny"],
      ["private/**", "deny"],
    ]);
  });

  it("places asks after allows and denies after asks", () => {
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: {
        "*": { "secret/**": "deny", ".env": "ask", "*": "allow" },
        read: { "src/**": "allow" },
      },
      toolTarget: "opencode",
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["*", "allow"],
      [".env", "ask"],
      ["secret/**", "deny"],
    ]);
    expect(result.read).toEqual({ "src/**": "allow" });
  });

  it("leaves a catch-all deny at the end even when the input had a later allow", () => {
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: {
        "*": { "*": "deny", "src/**": "allow" },
      },
      toolTarget: "opencode",
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["src/**", "allow"],
      ["*", "deny"],
    ]);
  });

  it("warns when the all-tools patterns are reordered", () => {
    const logger = { warn: vi.fn() };
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: { "*": { "*": "ask", "src/**": "allow" } },
      toolTarget: "kilo",
      logger: logger as any,
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["src/**", "allow"],
      ["*", "ask"],
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain('kilo.permission["*"]');
  });

  it("does not warn when the all-tools patterns are already ordered", () => {
    const logger = { warn: vi.fn() };
    restateAllToolsRestrictionsLast({
      sharedPermission: { "*": { "*": "allow", ".env": "ask", "secret/**": "deny" } },
      toolTarget: "opencode",
      logger: logger as any,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not warn when the all-tools key is overridden for the target", () => {
    const logger = { warn: vi.fn() };
    restateAllToolsRestrictionsLast({
      sharedPermission: { "*": { "*": "ask", "src/**": "allow" } },
      toolTarget: "opencode",
      allToolsOverridden: true,
      logger: logger as any,
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("respells an integer-like deny a later looser rule overlaps and moves it to the key's end", () => {
    const logger = { warn: vi.fn() };
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: { bash: { "*": "allow", "8080": "deny", "git *": "allow" } },
      toolTarget: "opencode",
      logger: logger as any,
    });

    expect(Object.entries(result.bash ?? {})).toEqual([
      ["*", "allow"],
      ["git *", "allow"],
      ["8080*", "deny"],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bash: 8080"));
  });

  it("moves an overlapping deny, integer-like or not, after a respelled ask", () => {
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: {
        bash: { "*": "allow", "80": "ask", "8080": "deny", "80 --force": "deny" },
      },
      toolTarget: "opencode",
    });

    expect(Object.entries(result.bash ?? {})).toEqual([
      ["*", "allow"],
      ["80*", "ask"],
      ["8080*", "deny"],
      ["80 --force", "deny"],
    ]);
  });

  it("respells an integer-like '*' restriction restated into another key", () => {
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: { "*": { "42": "deny" }, webfetch: { "*": "allow" } },
      toolTarget: "opencode",
    });

    expect(Object.entries(result.webfetch ?? {})).toEqual([
      ["*", "allow"],
      ["42*", "deny"],
    ]);
  });

  it("leaves an integer-like key alone when nothing after it is looser and overlapping", () => {
    const logger = { warn: vi.fn() };
    const sharedPermission = {
      bash: { "8080": "allow", "*": "deny" },
      read: { "1": "deny", "src/**": "allow" },
    } as const;
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: structuredClone(sharedPermission) as any,
      toolTarget: "opencode",
      logger: logger as any,
    });

    expect(result).toEqual(sharedPermission);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps a __proto__ pattern in the all-tools key", () => {
    const allTools = JSON.parse('{"__proto__": "deny", "*": "allow"}');
    const result = restateAllToolsRestrictionsLast({
      sharedPermission: { "*": allTools },
      toolTarget: "opencode",
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["*", "allow"],
      ["__proto__", "deny"],
    ]);
  });
});
