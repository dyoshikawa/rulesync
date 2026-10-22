import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { assertPathOptionsWithinCwd, assertPathOptionWithinCwd } from "./path-options.js";

describe("assertPathOptionWithinCwd", () => {
  let testDir: string;
  let projectDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    projectDir = join(testDir, "project");
    await mkdir(projectDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(projectDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it.each([".", "sub", join("sub", "dir"), "..cache"])(
    "accepts the relative path %s",
    async (path) => {
      await expect(
        assertPathOptionWithinCwd({ path, label: "outputRoots" }),
      ).resolves.toBeUndefined();
    },
  );

  it("accepts an absolute path inside cwd", async () => {
    await expect(
      assertPathOptionWithinCwd({ path: join(projectDir, "sub"), label: "outputRoots" }),
    ).resolves.toBeUndefined();
  });

  it.each(["..", join("..", "sibling"), "sub/../../x", "sub/../x"])(
    "rejects the path with a '..' segment %s",
    async (path) => {
      await expect(assertPathOptionWithinCwd({ path, label: "outputRoots" })).rejects.toThrow(
        "outputRoots must stay inside the project directory",
      );
    },
  );

  it("rejects an absolute path outside cwd", async () => {
    await expect(assertPathOptionWithinCwd({ path: testDir, label: "configPath" })).rejects.toThrow(
      "configPath must stay inside the project directory",
    );
  });

  it("rejects a path through a symbolic link that points outside cwd", async () => {
    await mkdir(join(testDir, "other-project"), { recursive: true });
    await symlink(join(testDir, "other-project"), join(projectDir, "shared"), "dir");

    await expect(
      assertPathOptionWithinCwd({ path: "shared", label: "outputRoots" }),
    ).rejects.toThrow("outputRoots must stay inside the project directory");
    await expect(
      assertPathOptionWithinCwd({
        path: join("shared", "not-yet", "created"),
        label: "outputRoots",
      }),
    ).rejects.toThrow("outputRoots must stay inside the project directory");
  });

  it("rejects a dangling symbolic link whose target would be outside cwd", async () => {
    await symlink(join(testDir, "not-created-yet"), join(projectDir, "dangling"), "dir");

    await expect(
      assertPathOptionWithinCwd({ path: "dangling", label: "outputRoots" }),
    ).rejects.toThrow("outputRoots must stay inside the project directory");
    await expect(
      assertPathOptionWithinCwd({ path: join("dangling", "nested"), label: "outputRoots" }),
    ).rejects.toThrow("outputRoots must stay inside the project directory");
  });

  it("resolves a relative dangling link target against the link's real parent", async () => {
    // `a/link` spells cwd/a/link, but `a` is cwd itself, so the OS resolves
    // `../x` against cwd and lands outside it.
    await symlink(".", join(projectDir, "a"), "dir");
    await symlink(join("..", "x"), join(projectDir, "link"), "dir");

    await expect(
      assertPathOptionWithinCwd({ path: join("a", "link"), label: "outputRoots" }),
    ).rejects.toThrow("outputRoots must stay inside the project directory");
  });

  it("accepts a dangling symbolic link whose target would be inside cwd", async () => {
    await symlink(join(projectDir, "later"), join(projectDir, "dangling"), "dir");

    await expect(
      assertPathOptionWithinCwd({ path: join("dangling", "nested"), label: "outputRoots" }),
    ).resolves.toBeUndefined();
  });

  it("accepts a path through a symbolic link that points inside cwd", async () => {
    await mkdir(join(projectDir, "real"), { recursive: true });
    await symlink(join(projectDir, "real"), join(projectDir, "alias"), "dir");

    await expect(
      assertPathOptionWithinCwd({ path: join("alias", "nested"), label: "outputRoots" }),
    ).resolves.toBeUndefined();
  });

  it("accepts paths when cwd itself is reached through a symbolic link", async () => {
    const linkedCwd = join(testDir, "linked-project");
    await symlink(projectDir, linkedCwd, "dir");
    vi.spyOn(process, "cwd").mockReturnValue(linkedCwd);

    await expect(
      assertPathOptionWithinCwd({ path: join(linkedCwd, "sub"), label: "outputRoots" }),
    ).resolves.toBeUndefined();
    await expect(
      assertPathOptionWithinCwd({ path: join(projectDir, "sub"), label: "outputRoots" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a not-yet-existing path below a symbolic link that points outside cwd", async () => {
    await mkdir(join(testDir, "outside", "target"), { recursive: true });
    await symlink(join(testDir, "outside"), join(projectDir, "escape"));

    await expect(
      assertPathOptionWithinCwd({ path: join("escape", "target", "new-dir"), label: "output" }),
    ).rejects.toThrow("output must stay inside the project directory");
  });

  it("rejects an empty string", async () => {
    await expect(assertPathOptionWithinCwd({ path: "  ", label: "inputRoot" })).rejects.toThrow(
      "inputRoot must not be an empty string",
    );
  });

  it("checks every entry of a list", async () => {
    await expect(
      assertPathOptionsWithinCwd({ paths: ["ok", "../bad"], label: "inputRoots" }),
    ).rejects.toThrow("inputRoots must stay inside the project directory");
    await expect(
      assertPathOptionsWithinCwd({ paths: undefined, label: "inputRoots" }),
    ).resolves.toBeUndefined();
  });
});
