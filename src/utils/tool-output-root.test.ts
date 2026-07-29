import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveToolOutputRoot } from "./tool-output-root.js";

describe("resolveToolOutputRoot", () => {
  const originalHermesHome = process.env.HERMES_HOME;
  const originalKimiHome = process.env.KIMI_CODE_HOME;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
    if (originalKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = originalKimiHome;
  });

  it("keeps the caller's output root in project scope and for tools without an override", () => {
    process.env.HERMES_HOME = "/hermes-profile";

    expect(
      resolveToolOutputRoot({ outputRoot: "/project", toolTarget: "hermesagent", global: false }),
    ).toBe("/project");
    expect(
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "claudecode", global: true }),
    ).toBe("/home");
  });

  it("substitutes the tool home override in global scope", () => {
    process.env.HERMES_HOME = "/hermes-profile";
    process.env.KIMI_CODE_HOME = "/kimi-profile";

    expect(
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "hermesagent", global: true }),
    ).toBe(resolve("/hermes-profile"));
    expect(
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "kimi-code", global: true }),
    ).toBe(resolve("/kimi-profile"));
  });

  it("falls back to the caller's output root when the override is unset", () => {
    delete process.env.HERMES_HOME;
    delete process.env.KIMI_CODE_HOME;

    expect(
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "hermesagent", global: true }),
    ).toBe("/home");
    expect(
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "kimi-code", global: true }),
    ).toBe("/home");
  });

  it("rejects a home override that is the filesystem root, naming the variable", () => {
    // The env-derived root used to bypass validateOutputRoot entirely, so `/`
    // became the output root verbatim.
    process.env.HERMES_HOME = "/";
    expect(() =>
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "hermesagent", global: true }),
    ).toThrow("HERMES_HOME is not a usable output root");

    process.env.KIMI_CODE_HOME = "/";
    expect(() =>
      resolveToolOutputRoot({ outputRoot: "/home", toolTarget: "kimi-code", global: true }),
    ).toThrow("KIMI_CODE_HOME is not a usable output root");
  });
});
