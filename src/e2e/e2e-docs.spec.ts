import { describe, expect, it } from "vitest";

import { execFileAsync, rulesyncArgs, rulesyncCmd } from "./e2e-helper.js";

describe("E2E: docs", () => {
  it("should list every bundled document identifier", async () => {
    const { stdout } = await execFileAsync(rulesyncCmd, [...rulesyncArgs, "docs"]);

    expect(stdout).toContain("faq");
    expect(stdout).toContain("guide/configuration");
    expect(stdout).toContain("reference/cli-commands");
  });

  it("should print a top-level document", async () => {
    const { stdout } = await execFileAsync(rulesyncCmd, [...rulesyncArgs, "docs", "faq"]);

    expect(stdout).toContain("# FAQ");
  });

  it("should print a nested document without the docs/ prefix or .md extension", async () => {
    const { stdout } = await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "docs",
      "guide/configuration",
    ]);

    expect(stdout).toContain("# Configuration");
  });

  it("should search the bundled documentation and print ranked matches", async () => {
    const { stdout } = await execFileAsync(rulesyncCmd, [
      ...rulesyncArgs,
      "docs",
      "--search",
      "global mode",
    ]);

    expect(stdout).toContain("guide/global-mode");
  });

  it("should fail for a missing document", async () => {
    await expect(
      execFileAsync(rulesyncCmd, [...rulesyncArgs, "docs", "no-such-document"]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("should reject unsafe document identifiers", async () => {
    await expect(
      execFileAsync(rulesyncCmd, [...rulesyncArgs, "docs", "../package.json"]),
    ).rejects.toMatchObject({ code: 1 });
  });
});
