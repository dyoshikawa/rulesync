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
