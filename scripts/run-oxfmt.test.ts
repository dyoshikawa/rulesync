import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { repoRoot, runOxfmt } from "./run-oxfmt.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const execFileSyncMock = vi.mocked(execFileSync);

describe("runOxfmt", () => {
  afterEach(() => {
    execFileSyncMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("does not spawn oxfmt when no paths are given, so it cannot format the whole repo", () => {
    runOxfmt([]);

    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("passes repo-root-relative paths and runs from the repo root", () => {
    runOxfmt([
      join(repoRoot, "README.md"),
      join(repoRoot, "docs", "reference", "supported-tools.md"),
    ]);

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = execFileSyncMock.mock.calls[0]!;
    expect(command).toBe("npx");
    expect(args).toEqual([
      "--no-install",
      "oxfmt",
      "README.md",
      join("docs", "reference", "supported-tools.md"),
    ]);
    expect(options?.cwd).toBe(repoRoot);
  });

  it("resolves npx through a shell only on Windows", () => {
    const platform = process.platform;

    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      runOxfmt([join(repoRoot, "README.md")]);
    } finally {
      Object.defineProperty(process, "platform", { value: platform, configurable: true });
    }
    expect(execFileSyncMock.mock.calls[0]?.[2]?.shell).toBe(true);

    runOxfmt([join(repoRoot, "README.md")]);
    expect(execFileSyncMock.mock.calls[1]?.[2]?.shell).toBe(false);
  });
});
