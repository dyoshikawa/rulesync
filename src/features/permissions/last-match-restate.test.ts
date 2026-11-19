import { describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { restateAllToolsRestrictionsLast } from "./last-match-restate.js";

describe("restateAllToolsRestrictionsLast", () => {
  it("puts all-tools denies after catch-all allows on last-match-wins tools", () => {
    const result = restateAllToolsRestrictionsLast({
      "*": { ".env": "deny", "private/**": "deny", "*": "allow" },
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["*", "allow"],
      [".env", "deny"],
      ["private/**", "deny"],
    ]);
  });

  it("places asks after allows and denies after asks", () => {
    const result = restateAllToolsRestrictionsLast({
      "*": { "secret/**": "deny", ".env": "ask", "*": "allow" },
      read: { "src/**": "allow" },
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
      "*": { "*": "deny", "src/**": "allow" },
    });

    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["src/**", "allow"],
      ["*", "deny"],
    ]);
  });

  it("warns only when reordering changes the authored all-tools key", () => {
    const logger = createMockLogger();
    restateAllToolsRestrictionsLast(
      { "*": { "*": "ask", "src/**": "allow" } },
      { logger, toolTarget: "opencode" },
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('opencode.permission["*"]'));
    logger.warn.mockClear();
    restateAllToolsRestrictionsLast(
      { "*": { "src/**": "allow", "*": "ask" } },
      { logger, toolTarget: "opencode" },
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("preserves a literal __proto__ deny as an own pattern", () => {
    const rules = JSON.parse('{"__proto__":"deny","*":"allow","src/**":"ask"}');
    const result = restateAllToolsRestrictionsLast({ "*": rules });
    expect(Object.entries(result["*"] ?? {})).toEqual([
      ["*", "allow"],
      ["src/**", "ask"],
      ["__proto__", "deny"],
    ]);
  });
});
