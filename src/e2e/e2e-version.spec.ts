import { describe, expect, it } from "vitest";

import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

describe("E2E: version", () => {
  useTestDirectory();

  it("should display version with --version", async () => {
    const { stdout } = await execFileAsync(rulesyncCmd, [...rulesyncArgs, "--version"]);

    // Should output a version number (e.g., "3.16.0")
    // Use regex to extract version number to handle potential debug output
    const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    expect(versionMatch).toBeTruthy();
    expect(versionMatch?.[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
