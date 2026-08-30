import { describe, expect, it } from "vitest";

import { quoteValueForWarning } from "./quote-value.js";

describe("quoteValueForWarning", () => {
  it("should quote a string so it cannot be mistaken for the surrounding sentence", () => {
    expect(quoteValueForWarning("git *")).toBe('"git *"');
  });

  it("should render a non-string value rather than dropping it", () => {
    expect(quoteValueForWarning(42)).toBe("42");
    expect(quoteValueForWarning(["a", "b"])).toBe('["a","b"]');
  });

  it("should name a value JSON cannot serialize instead of returning nothing", () => {
    expect(quoteValueForWarning(undefined)).toBe("undefined");
  });

  it("should strip the control characters JSON.stringify leaves intact", () => {
    // `‮` reorders whatever follows it, so a value carrying one can make a
    // warning read as something other than what it says.
    expect(quoteValueForWarning("a‮b")).toBe('"ab"');
  });

  it("should truncate a long value, since it now travels into JSON and MCP results", () => {
    const quoted = quoteValueForWarning("x".repeat(200));

    expect(quoted).toHaveLength(60 + "…(truncated)".length);
    expect(quoted).toMatch(/…\(truncated\)$/);
  });
});
