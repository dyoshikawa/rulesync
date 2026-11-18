import { describe, expect, it } from "vite-plus/test";

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
});
