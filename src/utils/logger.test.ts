import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock consola methods
    consoleSpy = {
      log: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Replace the logger's console with our mocked version
    (logger as any).console = consoleSpy;

    // Reset verbose state
    logger.setVerbose(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("verbose mode", () => {
    it("should set and get verbose mode correctly", () => {
      expect(logger.verbose).toBe(false);

      logger.setVerbose(true);
      expect(logger.verbose).toBe(true);

      logger.setVerbose(false);
      expect(logger.verbose).toBe(false);
    });
  });

  describe("logging methods", () => {
    it("should call log method with correct arguments", () => {
      const message = "Test log message";
      const args = ["arg1", 42, { key: "value" }];

      logger.log(message, ...args);

      expect(consoleSpy.log).toHaveBeenCalledWith(message, ...args);
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    });

    it("should call info method with correct arguments", () => {
      const message = "Test info message";
      const args = ["arg1", 42];

      logger.info(message, ...args);

      expect(consoleSpy.info).toHaveBeenCalledWith(message, ...args);
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });

    it("should call success method with correct arguments", () => {
      const message = "Test success message";

      logger.success(message);

      expect(consoleSpy.success).toHaveBeenCalledWith(message);
      expect(consoleSpy.success).toHaveBeenCalledTimes(1);
    });

    it("should call warn method with correct arguments", () => {
      const message = "Test warning message";
      const errorObj = new Error("test error");

      logger.warn(message, errorObj);

      expect(consoleSpy.warn).toHaveBeenCalledWith(message, errorObj);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });

    it("should call error method with correct arguments", () => {
      const message = "Test error message";
      const errorObj = new Error("test error");

      logger.error(message, errorObj);

      expect(consoleSpy.error).toHaveBeenCalledWith(message, errorObj);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("debug method", () => {
    it("should not call debug when verbose is false", () => {
      logger.setVerbose(false);
      const message = "Debug message";

      logger.debug(message);

      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it("should call debug when verbose is true", () => {
      logger.setVerbose(true);
      const message = "Debug message";
      const args = ["debug", "args"];

      logger.debug(message, ...args);

      expect(consoleSpy.debug).toHaveBeenCalledWith(message, ...args);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    });

    it("should respect verbose mode changes", () => {
      const message = "Debug message";

      // First call with verbose false
      logger.setVerbose(false);
      logger.debug(message);
      expect(consoleSpy.debug).not.toHaveBeenCalled();

      // Second call with verbose true
      logger.setVerbose(true);
      logger.debug(message);
      expect(consoleSpy.debug).toHaveBeenCalledWith(message);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);

      // Third call with verbose back to false
      logger.setVerbose(false);
      logger.debug(message);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1); // Still only called once
    });
  });

  describe("method chaining and state", () => {
    it("should maintain state across multiple calls", () => {
      logger.setVerbose(true);

      logger.log("message 1");
      logger.info("message 2");
      logger.debug("message 3");
      logger.warn("message 4");
      logger.error("message 5");
      logger.success("message 6");

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.success).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle undefined arguments", () => {
      logger.log("message", undefined);
      logger.info("message", undefined);
      logger.success("message", undefined);
      logger.warn("message", undefined);
      logger.error("message", undefined);

      expect(consoleSpy.log).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.info).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.success).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.warn).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.error).toHaveBeenCalledWith("message", undefined);
    });

    it("should handle null arguments", () => {
      logger.log("message", null);
      expect(consoleSpy.log).toHaveBeenCalledWith("message", null);
    });

    it("should handle complex objects", () => {
      const complexObj = {
        nested: { deep: { value: "test" } },
        array: [1, 2, { inner: "object" }],
        fn: () => "function",
      };

      logger.info("Complex object", complexObj);
      expect(consoleSpy.info).toHaveBeenCalledWith("Complex object", complexObj);
    });

    it("should handle empty messages", () => {
      logger.log("");
      logger.debug("");

      expect(consoleSpy.log).toHaveBeenCalledWith("");
      expect(consoleSpy.debug).not.toHaveBeenCalled(); // verbose is false by default
    });

    it("should handle messages with no additional arguments", () => {
      logger.log("Just a message");
      logger.info("Just a message");
      logger.success("Just a message");
      logger.warn("Just a message");
      logger.error("Just a message");

      expect(consoleSpy.log).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.info).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.success).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.warn).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.error).toHaveBeenCalledWith("Just a message");
    });
  });
});
