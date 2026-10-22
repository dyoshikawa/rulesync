import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir } from "../utils/file.js";
import { assertPathInsideCwd, McpCommandLogger, runCommandForMcp } from "./command-runner.js";

describe("McpCommandLogger", () => {
  it("reports JSON mode and keeps captured data and success lines", () => {
    const logger = new McpCommandLogger();
    logger.captureData("created", ["a.md"]);
    logger.success("Created %s", "a.md");
    logger.success("Done");

    expect(logger.jsonMode).toBe(true);
    expect(logger.silent).toBe(true);
    expect(logger.getJsonData()).toEqual({ created: ["a.md"] });
    expect(logger.getMessage()).toBe("Created a.md\nDone");
  });

  it("returns no message when nothing succeeded", () => {
    expect(new McpCommandLogger().getMessage()).toBeUndefined();
  });
});

describe("runCommandForMcp", () => {
  it("returns captured data, returned data and warnings on success", async () => {
    const result = await runCommandForMcp({
      run: async (logger) => {
        logger.captureData("count", 1);
        logger.warn("careful");
        logger.success("ok");
        return { extra: true };
      },
      extraResult: { passed: true },
    });

    expect(result).toEqual({
      success: true,
      message: "ok",
      result: { count: 1, extra: true, passed: true },
      warnings: ["careful"],
    });
  });

  it("returns the error and the warnings raised before it", async () => {
    const result = await runCommandForMcp({
      run: async (logger) => {
        logger.warn("before");
        throw new Error("boom");
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
    expect(result.warnings).toEqual(["before"]);
  });

  it("lets recover turn an error into a report", async () => {
    const result = await runCommandForMcp({
      run: async () => {
        throw new Error("report");
      },
      recover: ({ error }) => ({
        success: true,
        result: { recovered: error instanceof Error ? error.message : "" },
      }),
    });

    expect(result).toEqual({ success: true, result: { recovered: "report" } });
  });

  it("does not write to stdout", async () => {
    const write = vi.spyOn(process.stdout, "write");
    try {
      await runCommandForMcp({
        run: async (logger) => {
          logger.info("info");
          logger.success("success");
          logger.debug("debug");
        },
      });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});

describe("assertPathInsideCwd", () => {
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

  it("accepts relative and absolute paths inside the project", async () => {
    await expect(assertPathInsideCwd({ path: "a/b", label: "output" })).resolves.toBeUndefined();
    await expect(
      assertPathInsideCwd({ path: join(testDir, "a"), label: "output" }),
    ).resolves.toBeUndefined();
  });

  it("rejects paths that leave the project", async () => {
    await expect(assertPathInsideCwd({ path: "../outside", label: "output" })).rejects.toThrow(
      /output must stay inside the project directory/,
    );
    await expect(
      assertPathInsideCwd({ path: join(testDir, "..", "elsewhere"), label: "configPath" }),
    ).rejects.toThrow(/configPath must stay inside the project directory/);
  });

  it("rejects paths that leave the project through a symbolic link", async () => {
    const outside = await setupTestDirectory();
    try {
      await ensureDir(join(outside.testDir, "target"));
      await symlink(outside.testDir, join(testDir, "link"));

      await expect(assertPathInsideCwd({ path: "link", label: "output" })).rejects.toThrow(
        /output must stay inside the project directory/,
      );
      await expect(
        assertPathInsideCwd({ path: join("link", "target", "new-dir"), label: "output" }),
      ).rejects.toThrow(/output must stay inside the project directory/);
    } finally {
      await outside.cleanup();
    }
  });

  it("accepts a symbolic link that stays inside the project", async () => {
    await ensureDir(join(testDir, "real"));
    await symlink(join(testDir, "real"), join(testDir, "inner-link"));

    await expect(
      assertPathInsideCwd({ path: join("inner-link", "x"), label: "output" }),
    ).resolves.toBeUndefined();
  });
});
