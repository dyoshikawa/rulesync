import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getHermesagentHome,
  getHermesagentRelativeDirPath,
  getHermesagentRelativeFilePath,
  getHermesagentRulesyncOutputRoot,
  resolveHermesagentOutputRoot,
} from "./hermesagent.js";

describe("Hermes Agent profile paths", () => {
  const originalHermesHome = process.env.HERMES_HOME;
  const originalHomeDir = process.env.HOME_DIR;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
    if (originalHomeDir === undefined) delete process.env.HOME_DIR;
    else process.env.HOME_DIR = originalHomeDir;
  });

  it("falls back to the caller root when HERMES_HOME is unset or blank", () => {
    delete process.env.HERMES_HOME;
    expect(getHermesagentHome()).toBeUndefined();
    expect(resolveHermesagentOutputRoot({ outputRoot: "/default-home", global: true })).toBe(
      "/default-home",
    );
    expect(getHermesagentRelativeDirPath({ global: true, relativeDirPath: ".hermes/skills" })).toBe(
      join(".hermes", "skills"),
    );

    process.env.HERMES_HOME = "   ";
    expect(getHermesagentHome()).toBeUndefined();
  });

  it("uses HERMES_HOME as the global profile root without appending .hermes", () => {
    process.env.HERMES_HOME = " ./custom-hermes ";

    expect(getHermesagentHome()).toBe(resolve("custom-hermes"));
    expect(resolveHermesagentOutputRoot({ outputRoot: "/default-home", global: true })).toBe(
      resolve("custom-hermes"),
    );
    expect(getHermesagentRelativeDirPath({ global: true, relativeDirPath: ".hermes/skills" })).toBe(
      "skills",
    );
    expect(
      getHermesagentRelativeFilePath({
        global: true,
        relativeFilePath: ".hermes/config.yaml",
      }),
    ).toBe("config.yaml");
  });

  it("keeps project paths and the global RuleSync source root separate", () => {
    process.env.HERMES_HOME = "/custom-hermes";
    process.env.HOME_DIR = "/rulesync-home";

    expect(resolveHermesagentOutputRoot({ outputRoot: "/project", global: false })).toBe(
      "/project",
    );
    expect(
      getHermesagentRelativeDirPath({ global: false, relativeDirPath: ".hermes/plugins" }),
    ).toBe(join(".hermes", "plugins"));
    expect(
      getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: "/custom-hermes",
        global: true,
      }),
    ).toBe("/rulesync-home");
    expect(getHermesagentRulesyncOutputRoot({ nativeOutputRoot: "/project", global: false })).toBe(
      "/project",
    );
  });
});
