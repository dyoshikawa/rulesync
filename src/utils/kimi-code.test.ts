import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getKimiCodeConfigSharedFileKey,
  getKimiCodeHome,
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
  getKimiCodeSharedConfigWritePaths,
} from "./kimi-code.js";

describe("Kimi Code profile paths", () => {
  const originalKimiHome = process.env.KIMI_CODE_HOME;
  const originalHomeDir = process.env.HOME_DIR;

  afterEach(() => {
    if (originalKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = originalKimiHome;
    if (originalHomeDir === undefined) delete process.env.HOME_DIR;
    else process.env.HOME_DIR = originalHomeDir;
  });

  it("treats KIMI_CODE_HOME as the profile root itself", () => {
    delete process.env.KIMI_CODE_HOME;
    expect(getKimiCodeHome()).toBeUndefined();
    expect(getKimiCodeRelativeDirPath({ global: true })).toBe(join(".kimi-code", "."));

    process.env.KIMI_CODE_HOME = "  /custom-kimi  ";
    expect(getKimiCodeHome()).toBe("/custom-kimi");
    expect(getKimiCodeRelativeDirPath({ global: true })).toBe(".");
  });

  it("declares both config.toml spellings regardless of KIMI_CODE_HOME", () => {
    // The shared-write derivation runs at module load, so the declared set must
    // not depend on the ambient environment or the drift guards go blind.
    const declared = getKimiCodeSharedConfigWritePaths().map((path) => path.relativeDirPath);
    process.env.KIMI_CODE_HOME = "/custom-kimi";

    expect(declared).toEqual([".kimi-code", "."]);
    expect(getKimiCodeSharedConfigWritePaths().map((path) => path.relativeDirPath)).toEqual(
      declared,
    );
  });

  it("keys the shared config by the file the current scope actually writes", () => {
    delete process.env.KIMI_CODE_HOME;
    expect(getKimiCodeConfigSharedFileKey({ global: true })).toBe(".kimi-code/config.toml");

    process.env.KIMI_CODE_HOME = "/custom-kimi";
    expect(getKimiCodeConfigSharedFileKey({ global: true })).toBe("config.toml");
  });

  it("keeps the rulesync source root under the rulesync home when the override is set", () => {
    // KIMI_CODE_HOME redirects Kimi's own output, but the `.rulesync/` sources
    // imported back out of it belong to the project, not the Kimi profile.
    process.env.HOME_DIR = "/rulesync-home";
    process.env.KIMI_CODE_HOME = "/custom-kimi";
    expect(getKimiCodeRulesyncOutputRoot({ nativeOutputRoot: "/custom-kimi", global: true })).toBe(
      "/rulesync-home",
    );
    expect(getKimiCodeRulesyncOutputRoot({ nativeOutputRoot: "/project", global: false })).toBe(
      "/project",
    );

    delete process.env.KIMI_CODE_HOME;
    expect(getKimiCodeRulesyncOutputRoot({ nativeOutputRoot: "/home", global: true })).toBe(
      "/home",
    );
  });
});
