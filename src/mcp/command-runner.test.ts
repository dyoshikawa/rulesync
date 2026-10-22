import { describe, expect, it, vi } from "vitest";

import { McpCommandLogger, runCommandForMcp } from "./command-runner.js";

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
