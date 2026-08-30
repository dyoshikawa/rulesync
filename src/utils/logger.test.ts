import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "./logger.js";
import {
  ConsoleLogger,
  fallbackLogger,
  JsonLogger,
  warnOnConflictingFlags,
  warnOnceWithFallback,
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
      logger.warn("unknown key", "foo", 42);
    });

    expect(output.data).toEqual({
      test: "data",
      warnings: ["machine-local settings were skipped", "unknown key foo 42"],
    });
  });

  it("omits the key entirely when nothing warned", () => {
    const output = captureJsonOutput((logger) => {
      logger.captureData("test", "data");
    });

    expect(output.data).toEqual({ test: "data" });
  });

  it("drops warnings under --silent, which asks for no diagnostics at all", () => {
    const output = captureJsonOutput((logger) => {
      logger.configure({ verbose: false, silent: true });
      logger.warn("machine-local settings were skipped");
    });

    expect(output.data).toEqual({});
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
