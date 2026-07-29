import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { toPosixPath } from "./file.js";
import {
  getHermesagentGlobalDir,
  getHermesagentHome,
  getHermesagentRelativeDirPath,
  getHermesagentRelativeFilePath,
  getHermesagentConfigSharedFileKey,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
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
      join(getHermesagentGlobalDir(), "skills"),
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

  it("rejects paths outside .hermes when stripping the global profile prefix", () => {
    process.env.HERMES_HOME = "/custom-hermes";

    expect(() =>
      getHermesagentRelativeDirPath({ global: true, relativeDirPath: "outside" }),
    ).toThrow("Hermes Agent global path must be within .hermes");
    expect(() =>
      getHermesagentRelativeFilePath({ global: true, relativeFilePath: "config.yaml" }),
    ).toThrow("Hermes Agent global path must be within .hermes");
    // A `..` segment that does not escape `.hermes` on its own is still
    // rejected, matching the codebase-standard checkPathTraversal semantics.
    expect(() =>
      getHermesagentRelativeDirPath({
        global: true,
        relativeDirPath: ".hermes/skills/../../.hermes/plugins",
      }),
    ).toThrow("Hermes Agent global path must be within .hermes");
  });

  it("follows the platform default profile directory when HERMES_HOME is unset", () => {
    delete process.env.HERMES_HOME;

    // Upstream defaults to %LOCALAPPDATA%\hermes on win32 and ~/.hermes elsewhere.
    expect(getHermesagentGlobalDir()).toBe(
      process.platform === "win32" ? join("AppData", "Local", "hermes") : ".hermes",
    );
    expect(
      getHermesagentRelativeFilePath({ global: true, relativeFilePath: ".hermes/config.yaml" }),
    ).toBe(join(getHermesagentGlobalDir(), "config.yaml"));
  });

  it("declares every config.yaml spelling regardless of platform and HERMES_HOME", () => {
    // The shared-write derivation runs at module load, so the declared set must
    // not depend on the ambient environment or the drift guards go blind.
    const declared = getHermesagentSharedConfigWritePaths().map((path) => path.relativeDirPath);
    process.env.HERMES_HOME = "/custom-hermes";

    expect(declared).toEqual([".hermes", join("AppData", "Local", "hermes"), "."]);
    expect(getHermesagentSharedConfigWritePaths().map((path) => path.relativeDirPath)).toEqual(
      declared,
    );
    expect(
      declared.includes(
        getHermesagentRelativeDirPath({ global: true, relativeDirPath: ".hermes" }),
      ),
    ).toBe(true);
  });

  it("keys the shared config by the file the current scope actually writes", () => {
    // The key must name the file being written, not a fixed spelling: with
    // HERMES_HOME set the config sits at the profile root, and on win32 it sits
    // under the platform default directory.
    delete process.env.HERMES_HOME;
    expect(getHermesagentConfigSharedFileKey({ global: true })).toBe(
      `${toPosixPath(getHermesagentGlobalDir())}/config.yaml`,
    );
    expect(getHermesagentConfigSharedFileKey({ global: false })).toBe(".hermes/config.yaml");

    process.env.HERMES_HOME = "/custom-hermes";
    expect(getHermesagentConfigSharedFileKey({ global: true })).toBe("config.yaml");

    // Whatever it resolves to must be one of the declared write paths, or the
    // gateway would reject the write for an undeclared key.
    const declaredKeys = getHermesagentSharedConfigWritePaths().map(
      (path) =>
        `${path.relativeDirPath === "." ? "" : `${toPosixPath(path.relativeDirPath)}/`}config.yaml`,
    );
    expect(declaredKeys).toContain(getHermesagentConfigSharedFileKey({ global: true }));
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
