import { describe, expect, it } from "vitest";

import { TOOL_DISPLAY } from "./tool-display.js";
import { ALL_TOOL_TARGETS } from "./tool-targets.js";

describe("TOOL_DISPLAY", () => {
  it("covers exactly the non-legacy tool targets", () => {
    const displayed = new Set(TOOL_DISPLAY.map((e) => e.key));
    const expected = ALL_TOOL_TARGETS.filter((t) => !t.endsWith("-legacy"));
    const missing = expected.filter((t) => !displayed.has(t));
    const extra = [...displayed].filter((t) => !expected.includes(t));
    expect(missing, "tools missing a display entry").toEqual([]);
    expect(extra, "display entries for unknown tools").toEqual([]);
  });

  it("has unique keys", () => {
    const keys = TOOL_DISPLAY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has a non-empty label for every entry", () => {
    for (const entry of TOOL_DISPLAY) {
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});
