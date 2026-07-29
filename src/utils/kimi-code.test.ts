import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getKimiCodeConfigSharedFileKey,
  getKimiCodeHome,
  getKimiCodeRelativeDirPath,
  getKimiCodeSharedConfigWritePaths,
} from "./kimi-code.js";

describe("Kimi Code profile paths", () => {
  const originalKimiHome = process.env.KIMI_CODE_HOME;

  afterEach(() => {
    if (originalKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = originalKimiHome;
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
});
