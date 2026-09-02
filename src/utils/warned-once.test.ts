import { describe, expect, it } from "vitest";

import {
  claimWarnOnce,
  hasIncompleteCarriedFiles,
  recordIncompleteCarriedFiles,
  resetRunWarningState,
  withWarnOnceScope,
} from "./warned-once.js";

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

describe("recordIncompleteCarriedFiles", () => {
  it("should be cleared by a reset", () => {
    // A flag that survived a reset would stand the orphan sweep down for the
    // rest of a `--watch` or MCP process, long after the run that set it.
    recordIncompleteCarriedFiles();
    expect(hasIncompleteCarriedFiles()).toBe(true);

    resetRunWarningState();

    expect(hasIncompleteCarriedFiles()).toBe(false);
  });

  it("should not reach a run that opened its own scope", async () => {
    // The MCP server does not serialize its requests. One run that could not
    // read a source must not stop another run's sweep, nor go unnoticed by its
    // own because a concurrent run reset it.
    recordIncompleteCarriedFiles();

    await withWarnOnceScope(async () => {
      expect(hasIncompleteCarriedFiles()).toBe(false);
      recordIncompleteCarriedFiles();
      expect(hasIncompleteCarriedFiles()).toBe(true);
      resetRunWarningState();
    });

    expect(hasIncompleteCarriedFiles()).toBe(true);
  });
});
