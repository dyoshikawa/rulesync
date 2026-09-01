import { describe, expect, it } from "vitest";

import { AggregatedToolCheck, type AggregatedToolCheckConfig } from "./aggregated-tool-check.js";
import { type ToolCheckSettablePaths } from "./tool-check.js";

/**
 * A subclass that forgets `getAggregatedCheckConfig`. TypeScript cannot demand
 * a static, so the base throws instead — these cover that the throw is reached
 * rather than a default silently taken.
 */
class ForgetfulCheck extends AggregatedToolCheck {
  static override getSettablePaths(): ToolCheckSettablePaths {
    return { relativeDirPath: ".forgetful", relativeFilePath: "CHECKS.md" };
  }
}

/** A subclass that names a directory but not the one file it writes. */
class UnnamedFileCheck extends AggregatedToolCheck {
  static override getSettablePaths(): ToolCheckSettablePaths {
    return { relativeDirPath: ".unnamed" };
  }

  protected static override getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    return {
      displayName: "Unnamed",
      toolTarget: "cursor",
      fallbackCheckName: "unnamed",
      handWrittenPreamble: "replace",
    };
  }
}

describe("AggregatedToolCheck", () => {
  it("refuses to build one output from one check", () => {
    expect(() =>
      UnnamedFileCheck.fromRulesyncCheck({
        relativeDirPath: ".unnamed",
        rulesyncCheck: undefined as never,
      }),
    ).toThrow("Unnamed checks are built from all checks at once");
  });

  it("tells a subclass that skipped the config to implement it", () => {
    expect(() => ForgetfulCheck.isTargetedByRulesyncCheck(undefined as never)).toThrow(
      "Please implement this method in the subclass.",
    );
  });

  it("tells a subclass that left the aggregated file unnamed to name it", async () => {
    await expect(UnnamedFileCheck.canDeleteAuxiliaryFiles({ outputRoot: "." })).rejects.toThrow(
      "UnnamedFileCheck writes one aggregated file, so getSettablePaths must name it.",
    );
  });
});
