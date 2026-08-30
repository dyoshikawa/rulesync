import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "./logger.js";
import {
  ConsoleLogger,
  fallbackLogger,
  JsonLogger,
  warnOnConflictingFlags,
  warnOnceWithFallback,
  withFallbackLoggerTarget,
  WarningCollectingLogger,
  warnWithFallback,
} from "./logger.js";

// Mock vitest module
vi.mock("./vitest.js", () => ({
  isEnvTest: () => false,
}));

describe.each([
  { name: "ConsoleLogger", createLogger: () => new ConsoleLogger() as Logger },
  {
    name: "JsonLogger",
    createLogger: () => new JsonLogger({ command: "test", version: "1.0.0" }) as Logger,
  },
])("$name configure()", ({ createLogger }) => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
  });

  it("should set verbose and silent flags", () => {
    logger.configure({ verbose: true, silent: false });
    expect(logger.verbose).toBe(true);
    expect(logger.silent).toBe(false);

    logger.configure({ verbose: false, silent: true });
    expect(logger.verbose).toBe(false);
    expect(logger.silent).toBe(true);
  });

  it("should not warn when only one flag is enabled", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.configure({ verbose: true, silent: false });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockClear();

    logger.configure({ verbose: false, silent: true });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("should not warn when both flags are disabled", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.configure({ verbose: false, silent: false });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("ConsoleLogger", () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new ConsoleLogger();
  });

  describe("configure()", () => {
    it("should not warn when both verbose and silent are enabled (warning lives in warnOnConflictingFlags)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(logger.silent).toBe(true);
      expect(logger.verbose).toBe(false);

      warnSpy.mockRestore();
    });
  });

  describe("jsonMode", () => {
    it("should always return false", () => {
      expect(logger.jsonMode).toBe(false);
    });
  });

  describe("silent mode", () => {
    it("should suppress info messages in silent mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.info("test message");

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it("should suppress success messages in silent mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.success("test message");

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it("should suppress warning messages in silent mode", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.warn("test message");

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should NOT suppress error messages in silent mode", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.error("test error");

      expect(errorSpy).toHaveBeenCalledWith("test error");

      errorSpy.mockRestore();
    });

    it("should suppress debug messages in silent mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });
      logger.debug("test debug");

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe("verbose mode", () => {
    it("should show debug messages in verbose mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: false });
      logger.debug("test debug");

      expect(logSpy).toHaveBeenCalledWith("test debug");

      logSpy.mockRestore();
    });

    it("should not show debug messages when verbose is disabled", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.debug("test debug");

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe("normal mode", () => {
    it("should show info messages in normal mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.info("test message");

      expect(logSpy).toHaveBeenCalledWith("test message");

      logSpy.mockRestore();
    });

    it("should show success messages in normal mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.success("test message");

      expect(logSpy).toHaveBeenCalledWith("test message");

      logSpy.mockRestore();
    });

    it("should show warning messages in normal mode", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.warn("test message");

      expect(warnSpy).toHaveBeenCalledWith("test message");

      warnSpy.mockRestore();
    });

    it("should show error messages in normal mode", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.error("test error");

      expect(errorSpy).toHaveBeenCalledWith("test error");

      errorSpy.mockRestore();
    });

    it("should extract message from Error objects", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.error(new Error("error object message"));

      expect(errorSpy).toHaveBeenCalledWith("error object message");

      errorSpy.mockRestore();
    });
  });

  describe("precedence", () => {
    it("should prioritize silent mode over verbose mode", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      // Debug should not show (suppressed by silent)
      logger.debug("test debug");
      expect(logSpy).not.toHaveBeenCalled();

      // Info should not show (suppressed by silent)
      logger.info("test info");
      expect(logSpy).not.toHaveBeenCalled();

      // Errors should still show
      logger.error("test error");
      expect(errorSpy).toHaveBeenCalledWith("test error");

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("captureData and outputJson", () => {
    it("captureData should be a no-op", () => {
      logger.captureData("key", "value");
      expect(logger.getJsonData()).toEqual({});
    });

    it("outputJson should be a no-op", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.outputJson(true);
      logger.outputJson(false, { code: "ERR", message: "fail" });

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});

describe("JsonLogger", () => {
  let logger: JsonLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new JsonLogger({ command: "test", version: "1.0.0" });
  });

  describe("configure()", () => {
    it("should NOT warn when both verbose and silent are enabled (JSON mode suppresses warning)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      expect(warnSpy).not.toHaveBeenCalled();

      // Silent should take precedence
      expect(logger.verbose).toBe(false);
      expect(logger.silent).toBe(true);

      warnSpy.mockRestore();
    });
  });

  describe("jsonMode", () => {
    it("should always return true", () => {
      expect(logger.jsonMode).toBe(true);
    });
  });

  describe("captureData", () => {
    it("should capture data", () => {
      logger.captureData("key", "value");
      expect(logger.getJsonData()).toEqual({ key: "value" });
    });
  });

  describe("console output suppression", () => {
    it("should suppress info, success, warn, and debug messages", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.info("test message");
      logger.success("test success");
      logger.warn("test warn");
      logger.debug("test debug");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe("outputJson", () => {
    it("should output JSON on success", () => {
      logger.captureData("test", "data");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.outputJson(true);

      expect(logSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(true);
      expect(output.command).toBe("test");
      expect(output.data.test).toBe("data");
      expect(output.timestamp).toBeDefined();
      expect(output.version).toBe("1.0.0");

      logSpy.mockRestore();
    });

    it("should output JSON on error", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.outputJson(false, { code: "TEST_ERROR", message: "Test error" });

      expect(errorSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(errorSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(false);
      expect(output.error.code).toBe("TEST_ERROR");
      expect(output.error.message).toBe("Test error");

      errorSpy.mockRestore();
    });

    it("should only output once (guard against duplicate output)", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.outputJson(true);
      logger.outputJson(true);

      expect(logSpy).toHaveBeenCalledOnce();

      logSpy.mockRestore();
    });
  });

  describe("error", () => {
    it("should output JSON error with stack trace in verbose mode", () => {
      logger.configure({ verbose: true, silent: false });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const error = new Error("Test error with stack");
      logger.error(error, "TEST_ERROR");

      expect(errorSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(errorSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(false);
      expect(output.error.stack).toBeDefined();

      errorSpy.mockRestore();
    });

    it("should output JSON error without stack trace when not verbose", () => {
      logger.configure({ verbose: false, silent: false });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const error = new Error("Test error");
      logger.error(error, "TEST_ERROR");

      expect(errorSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(errorSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(false);
      expect(output.error.stack).toBeUndefined();

      errorSpy.mockRestore();
    });
  });
});

const captureJsonOutput = (act: (logger: JsonLogger) => void): Record<string, unknown> => {
  const logger = new JsonLogger({ command: "test", version: "1.0.0" });
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    act(logger);
    logger.outputJson(true);

    return JSON.parse(logSpy.mock.calls[0]![0] as string);
  } finally {
    logSpy.mockRestore();
  }
};

describe("JsonLogger warnings", () => {
  it("carries warnings into the document, since a --json consumer reads nothing else", () => {
    const output = captureJsonOutput((logger) => {
      logger.captureData("test", "data");
      logger.warn("machine-local settings were skipped");
      logger.warn("unknown key %s (%d)", "foo", 42);
    });

    expect(output.warnings).toEqual([
      "machine-local settings were skipped",
      "unknown key foo (42)",
    ]);
    // Beside `data`, never inside it: a command that captures a `warnings` key
    // of its own must not be able to collide with the logger's.
    expect(output.data).toEqual({ test: "data" });
  });

  it("does not let a captured `warnings` key and the logger's own overwrite each other", () => {
    const output = captureJsonOutput((logger) => {
      logger.captureData("warnings", ["captured by the command"]);
      logger.warn("raised by the logger");
    });

    expect(output.data).toEqual({ warnings: ["captured by the command"] });
    expect(output.warnings).toEqual(["raised by the logger"]);
  });

  it("omits the key entirely when nothing warned", () => {
    const output = captureJsonOutput((logger) => {
      logger.captureData("test", "data");
    });

    expect(output.warnings).toBeUndefined();
    expect(output.data).toEqual({ test: "data" });
  });

  it("drops warnings under --silent, which asks for no diagnostics at all", () => {
    const output = captureJsonOutput((logger) => {
      logger.configure({ verbose: false, silent: true });
      logger.warn("machine-local settings were skipped");
    });

    expect(output.warnings).toBeUndefined();
    expect(output.data).toEqual({});
  });

  it("reports warnings on the failure document too, where they often explain the failure", () => {
    const logger = new JsonLogger({ command: "test", version: "1.0.0" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      logger.warn("machine-local settings were skipped");
      logger.outputJson(false, { code: "IMPORT_FAILED", message: "boom" });

      const output = JSON.parse(errorSpy.mock.calls[0]![0] as string);

      expect(output.success).toBe(false);
      expect(output.warnings).toEqual(["machine-local settings were skipped"]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("bounds what a single run can push into the document", () => {
    const output = captureJsonOutput((logger) => {
      for (let index = 0; index < 105; index++) {
        logger.warn(`warning ${index}`);
      }
      logger.warn("x".repeat(3000));
    });

    const warnings = output.warnings as string[];

    expect(warnings).toHaveLength(101);
    expect(warnings[99]).toBe("warning 99");
    // The over-long line never made it in, so its own length is not what grew
    // the document; only the count of what was dropped is reported.
    expect(warnings[100]).toBe("… and 6 more warning(s) not reported");
  });

  it("truncates a single over-long warning rather than carrying it whole", () => {
    const output = captureJsonOutput((logger) => {
      logger.warn("x".repeat(3000));
    });

    const warnings = output.warnings as string[];

    expect(warnings[0]).toHaveLength(1000 + "…(truncated)".length);
    expect(warnings[0]).toMatch(/…\(truncated\)$/);
  });

  it("stops once the warnings add up to the total budget, well before the count limit", () => {
    const output = captureJsonOutput((logger) => {
      for (let i = 0; i < 20; i++) {
        logger.warn(`${i} ${"y".repeat(900)}`);
      }
    });

    const warnings = output.warnings as string[];
    const reported = warnings.slice(0, -1);

    // Eight 902-character lines fit under 8,000; the ninth is what would cross
    // it, so the budget is a ceiling rather than a line the last entry steps
    // over.
    expect(reported).toHaveLength(8);
    expect(reported.join("").length).toBeLessThanOrEqual(8_000);
    expect(warnings.at(-1)).toBe("… and 12 more warning(s) not reported");
  });

  it("counts what it dropped in distinct diagnostics, not in copies of one", () => {
    const output = captureJsonOutput((logger) => {
      for (let i = 0; i < 20; i++) {
        logger.warn(`${i} ${"y".repeat(900)}`);
      }
      // The same line 50 times over, the way a warning repeated per tool target
      // arrives. Counting each copy would say "and 62 more" for 13 diagnostics.
      for (let i = 0; i < 50; i++) {
        logger.warn(`dropped, and dropped again ${"z".repeat(900)}`);
      }
    });

    const warnings = output.warnings as string[];

    expect(warnings.at(-1)).toBe("… and 13 more warning(s) not reported");
  });

  it("keeps one copy of a line a run repeats per tool target", () => {
    const output = captureJsonOutput((logger) => {
      logger.warn("the same diagnostic");
      logger.warn("the same diagnostic");
      logger.warn("a different one");
    });

    // Without this, a warning repeated once per target could spend the whole
    // budget and leave every distinct later diagnostic to a bare count.
    expect(output.warnings).toEqual(["the same diagnostic", "a different one"]);
  });

  it("strips control characters from a warning, so a quoted value cannot forge lines", () => {
    const output = captureJsonOutput((logger) => {
      logger.warn("read %s from it", '"\u202eevil\u0007"');
    });

    const warnings = output.warnings as string[];

    expect(warnings[0]).toBe('read "evil" from it');
  });
});

describe("WarningCollectingLogger", () => {
  it("keeps what it is told even while silent, and prints nothing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const logger = new WarningCollectingLogger({ verbose: false, silent: true });

      logger.warn("machine-local settings were skipped");
      logger.warn("unknown key", "foo");

      expect(logger.getWarnings()).toEqual([
        "machine-local settings were skipped",
        "unknown key foo",
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("still writes to the console when it is not silent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      new WarningCollectingLogger().warn("visible warning");

      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/** A promise paired with the function that settles it, to order two operations. */
function createGate(): { reached: Promise<void>; release: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { reached: promise, release: resolve };
}

/** Raise the same once-per-run warning inside an operation of its own. */
function runInScope(logger: WarningCollectingLogger): Promise<void> {
  return withFallbackLoggerTarget({
    logger,
    operation: async () => {
      warnOnceWithFallback(undefined, "read a machine-local overrides file");
    },
  });
}

describe("withFallbackLoggerTarget", () => {
  it("routes a warning raised without a logger to the adopted logger", async () => {
    const collector = new WarningCollectingLogger({ verbose: false, silent: true });

    await withFallbackLoggerTarget({
      logger: collector,
      operation: async () => {
        warnWithFallback(undefined, "raised deep in the run");
      },
    });

    expect(collector.getWarnings()).toEqual(["raised deep in the run"]);
  });

  it("keeps two overlapping operations from stealing each other's warnings", async () => {
    // A save-and-restore implementation would pass the simple case above and
    // fail here: the operation that finishes first would restore the target
    // out from under the one still running.
    const first = new WarningCollectingLogger({ verbose: false, silent: true });
    const second = new WarningCollectingLogger({ verbose: false, silent: true });
    const firstGate = createGate();
    const secondGate = createGate();

    // Both operations are open at once, and the one that started first is also
    // the one that finishes first — the interleaving a save-and-restore pair
    // gets wrong, because its "previous" target is the state from before
    // either began.
    const firstRun = withFallbackLoggerTarget({
      logger: first,
      operation: async () => {
        await firstGate.reached;
        warnWithFallback(undefined, "from the first operation");
      },
    });
    const secondRun = withFallbackLoggerTarget({
      logger: second,
      operation: async () => {
        await secondGate.reached;
        warnWithFallback(undefined, "from the second operation");
      },
    });
    firstGate.release();
    await firstRun;
    secondGate.release();
    await secondRun;

    expect(first.getWarnings()).toEqual(["from the first operation"]);
    expect(second.getWarnings()).toEqual(["from the second operation"]);
  });

  it("restores the console once the operation is over, including when it throws", async () => {
    const collector = new WarningCollectingLogger({ verbose: false, silent: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        withFallbackLoggerTarget({
          logger: collector,
          operation: async () => {
            throw new Error("boom");
          },
        }),
      ).rejects.toThrow("boom");

      warnWithFallback(undefined, "after the operation");

      expect(collector.getWarnings()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("after the operation");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("treats the forwarder itself as 'leave the fallback where it is'", async () => {
    const collector = new WarningCollectingLogger({ verbose: false, silent: true });

    await withFallbackLoggerTarget({
      logger: collector,
      operation: () =>
        withFallbackLoggerTarget({
          logger: fallbackLogger,
          operation: async () => {
            warnWithFallback(undefined, "still the outer target");
          },
        }),
    });

    expect(collector.getWarnings()).toEqual(["still the outer target"]);
  });

  it("does not recurse when the adopted target forwards back to the forwarder", async () => {
    // What `hooks-processor.ts` builds: a wrapper that prefixes the tool target
    // and hands the rest to the logger it was given. Given the forwarder, it is
    // an adopted target that leads straight back here, and the identity check
    // above does not see it.
    const wrapper: Logger = {
      ...fallbackLogger,
      warn: (message: string, ...args: unknown[]) =>
        fallbackLogger.warn(`For claudecode: ${message}`, ...args),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await withFallbackLoggerTarget({
        logger: wrapper,
        operation: async () => {
          warnWithFallback(undefined, "a diagnostic");
        },
      });

      // Once, on the console the warning would have reached with nothing
      // adopted — rather than a stack overflow.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain("For claudecode: a diagnostic");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("gives each operation its own once-per-run bookkeeping", async () => {
    const first = new WarningCollectingLogger({ verbose: false, silent: true });
    const second = new WarningCollectingLogger({ verbose: false, silent: true });
    await Promise.all([runInScope(first), runInScope(second)]);

    // Sharing one set would leave whichever ran second silent about a
    // diagnostic that applies to its own run just as much.
    expect(first.getWarnings()).toEqual(["read a machine-local overrides file"]);
    expect(second.getWarnings()).toEqual(["read a machine-local overrides file"]);
  });

  it("configures the default target, not whichever logger is adopted", async () => {
    const collector = new WarningCollectingLogger({ verbose: false, silent: true });

    await withFallbackLoggerTarget({
      logger: collector,
      operation: async () => {
        fallbackLogger.configure({ verbose: true, silent: true });
      },
    });

    // The adopted logger belongs to the operation that handed it over; only the
    // console the forwarder falls back to is `wrapCommand`'s to silence.
    expect(collector.verbose).toBe(false);
    expect(fallbackLogger.silent).toBe(true);

    fallbackLogger.configure({ verbose: false, silent: false });
  });

  it("carries diagnostics only, leaving the adopted logger's JSON document alone", async () => {
    const jsonLogger = new JsonLogger({ command: "test", version: "1.0.0" });
    const outputSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await withFallbackLoggerTarget({
        logger: jsonLogger,
        operation: async () => {
          // `outputJson` is once-only, so forwarding it would let a call from a
          // path with no logger of its own suppress the command's real output.
          fallbackLogger.captureData("stolen", true);
          fallbackLogger.outputJson(true);
        },
      });

      expect(outputSpy).not.toHaveBeenCalled();
      expect(fallbackLogger.getJsonData()).toEqual({});
      expect(jsonLogger.getJsonData()).toEqual({});
    } finally {
      outputSpy.mockRestore();
    }
  });

  it("does not narrate progress, which stdio MCP cannot have written to stdout", async () => {
    const collector = new WarningCollectingLogger({ verbose: true, silent: false });
    const infoSpy = vi.spyOn(collector, "info");
    const successSpy = vi.spyOn(collector, "success");

    await withFallbackLoggerTarget({
      logger: collector,
      operation: async () => {
        fallbackLogger.info("progress");
        fallbackLogger.success("done");
        fallbackLogger.warn("a diagnostic still travels");
      },
    });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
    expect(collector.getWarnings()).toEqual(["a diagnostic still travels"]);
  });
});

describe("warnOnceWithFallback", () => {
  it("reports a repeated message only once within a run", () => {
    const logger = { warn: vi.fn() } as unknown as Logger;

    warnOnceWithFallback(logger, "repeated message");
    warnOnceWithFallback(logger, "repeated message");
    warnOnceWithFallback(logger, "another message");

    expect(logger.warn).toHaveBeenNthCalledWith(1, "repeated message");
    expect(logger.warn).toHaveBeenNthCalledWith(2, "another message");
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("leaves the token unspent for a silent logger, so a later run still reports", () => {
    const silent = new ConsoleLogger({ verbose: false, silent: true });
    const silentWarnSpy = vi.spyOn(silent, "warn");
    const listening = { warn: vi.fn() } as unknown as Logger;

    warnOnceWithFallback(silent, "skipped by a silent run");
    warnOnceWithFallback(listening, "skipped by a silent run");

    expect(silentWarnSpy).not.toHaveBeenCalled();
    expect(listening.warn).toHaveBeenCalledWith("skipped by a silent run");
  });

  it("spends the token on a silent logger that hands its warnings back", () => {
    const logger = new WarningCollectingLogger({ verbose: false, silent: true });

    warnOnceWithFallback(logger, "kept by a collecting run");
    warnOnceWithFallback(logger, "kept by a collecting run");

    expect(logger.getWarnings()).toEqual(["kept by a collecting run"]);
  });

  it("falls back to the shared logger like warnWithFallback", () => {
    const fallbackWarnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

    try {
      warnOnceWithFallback(undefined, "message without a logger");

      expect(fallbackWarnSpy).toHaveBeenCalledWith("message without a logger");
    } finally {
      fallbackWarnSpy.mockRestore();
    }
  });
});

describe("warnWithFallback", () => {
  it("routes to the supplied logger when one is given", () => {
    const logger = { warn: vi.fn() } as unknown as Logger;
    const fallbackWarnSpy = vi.spyOn(fallbackLogger, "warn");

    try {
      warnWithFallback(logger, "message via logger");

      expect(logger.warn).toHaveBeenCalledWith("message via logger");
      expect(fallbackWarnSpy).not.toHaveBeenCalled();
    } finally {
      fallbackWarnSpy.mockRestore();
    }
  });

  it("routes to the shared fallbackLogger when no logger is given", () => {
    const fallbackWarnSpy = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});

    try {
      warnWithFallback(undefined, "message via fallback");

      expect(fallbackWarnSpy).toHaveBeenCalledWith("message via fallback");
    } finally {
      fallbackWarnSpy.mockRestore();
    }
  });

  it("fallbackLogger honors silent configuration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      fallbackLogger.configure({ verbose: false, silent: true });
      warnWithFallback(undefined, "suppressed message");

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      fallbackLogger.configure({ verbose: false, silent: false });
      warnSpy.mockRestore();
    }
  });
});

describe("warnOnConflictingFlags", () => {
  it("warns once when both flags are set outside JSON mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      warnOnConflictingFlags({ verbose: true, silent: true, jsonMode: false });

      expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
        "Both --verbose and --silent specified; --silent takes precedence",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn in JSON mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      warnOnConflictingFlags({ verbose: true, silent: true, jsonMode: true });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when only one flag is set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      warnOnConflictingFlags({ verbose: true, silent: false, jsonMode: false });
      warnOnConflictingFlags({ verbose: false, silent: true, jsonMode: false });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
