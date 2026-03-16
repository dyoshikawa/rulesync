import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger.js";

// Mock vitest module
vi.mock("./vitest.js", () => ({
  isEnvTest: () => false,
}));

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset logger state
    logger.configure({ verbose: false, silent: false });
    logger.setJsonMode(false, "");
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
      const consoleSpy = logger._getConsole();
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      expect(warnSpy).toHaveBeenCalledWith(
        "Both --verbose and --silent specified; --silent takes precedence",
      );

      warnSpy.mockRestore();
    });

    it("should not warn when only one flag is enabled", () => {
      const consoleSpy = logger._getConsole();
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: false });
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockClear();

      logger.configure({ verbose: false, silent: true });
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should not warn when both flags are disabled", () => {
      const consoleSpy = logger._getConsole();
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("silent mode", () => {
    it("should suppress info messages in silent mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.info("test message");

      expect(infoSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
    });

    it("should suppress success messages in silent mode", () => {
      const consoleSpy = logger._getConsole();
      const successSpy = vi.spyOn(consoleSpy, "success").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.success("test message");

      expect(successSpy).not.toHaveBeenCalled();

      successSpy.mockRestore();
    });

    it("should suppress warning messages in silent mode", () => {
      const consoleSpy = logger._getConsole();
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.warn("test message");

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should NOT suppress error messages in silent mode", () => {
      const consoleSpy = logger._getConsole();
      const errorSpy = vi.spyOn(consoleSpy, "error").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: true });
      logger.error("test error");

      expect(errorSpy).toHaveBeenCalledWith("test error");

      errorSpy.mockRestore();
    });

    it("should suppress debug messages in silent mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });
      logger.debug("test debug");

      expect(infoSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
    });
  });

  describe("verbose mode", () => {
    it("should show debug messages in verbose mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: false });
      logger.debug("test debug");

      expect(infoSpy).toHaveBeenCalledWith("test debug");

      infoSpy.mockRestore();
    });

    it("should not show debug messages when verbose is disabled", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.debug("test debug");

      expect(infoSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
    });
  });

  describe("normal mode", () => {
    it("should show info messages in normal mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.info("test message");

      expect(infoSpy).toHaveBeenCalledWith("test message");

      infoSpy.mockRestore();
    });

    it("should show success messages in normal mode", () => {
      const consoleSpy = logger._getConsole();
      const successSpy = vi.spyOn(consoleSpy, "success").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.success("test message");

      expect(successSpy).toHaveBeenCalledWith("test message");

      successSpy.mockRestore();
    });

    it("should show warning messages in normal mode", () => {
      const consoleSpy = logger._getConsole();
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.warn("test message");

      expect(warnSpy).toHaveBeenCalledWith("test message");

      warnSpy.mockRestore();
    });

    it("should show error messages in normal mode", () => {
      const consoleSpy = logger._getConsole();
      const errorSpy = vi.spyOn(consoleSpy, "error").mockImplementation(() => {});

      logger.configure({ verbose: false, silent: false });
      logger.error("test error");

      expect(errorSpy).toHaveBeenCalledWith("test error");

      errorSpy.mockRestore();
    });
  });

  describe("precedence", () => {
    it("should prioritize silent mode over verbose mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});
      const errorSpy = vi.spyOn(consoleSpy, "error").mockImplementation(() => {});

      logger.configure({ verbose: true, silent: true });

      // Debug should not show (suppressed by silent)
      logger.debug("test debug");
      expect(infoSpy).not.toHaveBeenCalled();

      // Info should not show (suppressed by silent)
      logger.info("test info");
      expect(infoSpy).not.toHaveBeenCalled();

      // Errors should still show
      logger.error("test error");
      expect(errorSpy).toHaveBeenCalledWith("test error");

      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("JSON mode", () => {
    it("should enable JSON mode", () => {
      logger.setJsonMode(true, "test");
      expect(logger.jsonMode).toBe(true);
    });

    it("should capture data in JSON mode", () => {
      logger.setJsonMode(true, "test");
      logger.captureData("key", "value");
      expect(logger.getJsonData()).toEqual({ key: "value" });
    });

    it("should suppress console output in JSON mode", () => {
      const consoleSpy = logger._getConsole();
      const infoSpy = vi.spyOn(consoleSpy, "info").mockImplementation(() => {});
      const successSpy = vi.spyOn(consoleSpy, "success").mockImplementation(() => {});
      const warnSpy = vi.spyOn(consoleSpy, "warn").mockImplementation(() => {});

      logger.setJsonMode(true, "test");
      logger.configure({ verbose: false, silent: false });

      logger.info("test message");
      logger.success("test success");
      logger.warn("test warn");

      expect(infoSpy).not.toHaveBeenCalled();
      expect(successSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      infoSpy.mockRestore();
      successSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should output JSON on success", () => {
      logger.setJsonMode(true, "test");
      logger.captureData("test", "data");

      // Mock console.log
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logger.outputJson(true);

      expect(logSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(true);
      expect(output.command).toBe("test");
      expect(output.data.test).toBe("data");
      expect(output.timestamp).toBeDefined();
      expect(output.version).toBeDefined();

      logSpy.mockRestore();
    });

    it("should output JSON on error", () => {
      logger.setJsonMode(true, "test");

      // Mock console.error
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      logger.outputJson(false, { code: "TEST_ERROR", message: "Test error" });

      expect(errorSpy).toHaveBeenCalledOnce();
      const output = JSON.parse(errorSpy.mock.calls[0]![0] as string);
      expect(output.success).toBe(false);
      expect(output.error.code).toBe("TEST_ERROR");
      expect(output.error.message).toBe("Test error");

      errorSpy.mockRestore();
    });

    it("should output JSON error with stack trace in verbose mode", () => {
      logger.setJsonMode(true, "test");
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
  });
});
