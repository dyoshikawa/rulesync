import { describe, expect, it } from "vitest";

import { claimWarnOnce, resetRunWarningState } from "./warned-once.js";

describe("claimWarnOnce", () => {
  it("should claim a message only the first time it is seen", () => {
    expect(claimWarnOnce("first message")).toBe(true);
    expect(claimWarnOnce("first message")).toBe(false);
    expect(claimWarnOnce("second message")).toBe(true);
  });

  it("should let a message be claimed again after a reset", () => {
    // Each `generate()` resets the cache, so a long-lived process (`--watch`,
    // the MCP server) reports the same problem once per run rather than once
    // per process lifetime.
    expect(claimWarnOnce("resettable message")).toBe(true);

    resetRunWarningState();

    expect(claimWarnOnce("resettable message")).toBe(true);
  });
});
