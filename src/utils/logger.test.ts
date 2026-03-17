import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleLogger, JsonLogger } from "./logger.js";

// Mock vitest module
vi.mock("./vitest.js", () => ({
  isEnvTest: () => false,
}));

describe("ConsoleLogger", () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new ConsoleLogger();
  });

  describe("configure()", () => {
    it("should set verbose and silent flags", () => {
      logger.configure({ verbose: true, silent: false });
      expect(logger.verbose).toBe(true);
      expect(logger.silent).toBe(false);

      logger.configure({ verbose: false, silent: true });
      expect(logger.verbose).toBe(false);
      expect(logger.silent).toBe(true);
    });

    it("should warn when both verbose and silent are enabled", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      expect(warnSpy).toHaveBeenCalledWith(
        "Both --verbose and --silent specified; --silent takes precedence",
      );

      warnSpy.mockRestore();
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
    it("should set verbose and silent flags", () => {
      logger.configure({ verbose: true, silent: false });
      expect(logger.verbose).toBe(true);
      expect(logger.silent).toBe(false);

      logger.configure({ verbose: false, silent: true });
      expect(logger.verbose).toBe(false);
      expect(logger.silent).toBe(true);
    });

    it("should not emit visible warning when both verbose and silent are enabled (warn is a no-op in JSON mode)", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      // No console output should be produced
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      // Silent should take precedence
      expect(logger.verbose).toBe(false);
      expect(logger.silent).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
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
