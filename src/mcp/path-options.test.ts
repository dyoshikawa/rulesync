import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { assertPathOptionsWithinCwd, assertPathOptionWithinCwd } from "./path-options.js";

describe("assertPathOptionWithinCwd", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it.each([".", "sub", join("sub", "dir")])("accepts the relative path %s", (path) => {
    expect(() => assertPathOptionWithinCwd({ path, label: "outputRoots" })).not.toThrow();
  });

  it("accepts an absolute path inside cwd", () => {
    expect(() =>
      assertPathOptionWithinCwd({ path: join(testDir, "sub"), label: "outputRoots" }),
    ).not.toThrow();
  });

  it.each(["..", join("..", "sibling"), join("sub", "..", "..", "x")])(
    "rejects the escaping path %s",
    (path) => {
      expect(() => assertPathOptionWithinCwd({ path, label: "outputRoots" })).toThrow(
        "outputRoots must stay inside the project directory",
      );
    },
  );

  it("rejects an absolute path outside cwd", () => {
    expect(() => assertPathOptionWithinCwd({ path: "/etc", label: "configPath" })).toThrow(
      "configPath must stay inside the project directory",
    );
  });

  it("rejects an empty string", () => {
    expect(() => assertPathOptionWithinCwd({ path: "  ", label: "inputRoot" })).toThrow(
      "inputRoot must not be an empty string",
    );
  });

  it("checks every entry of a list", () => {
    expect(() =>
      assertPathOptionsWithinCwd({ paths: ["ok", "../bad"], label: "inputRoots" }),
    ).toThrow("inputRoots must stay inside the project directory");
    expect(() =>
      assertPathOptionsWithinCwd({ paths: undefined, label: "inputRoots" }),
    ).not.toThrow();
  });
});
