import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  let consoleSpy: {
    info: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock consola methods
    consoleSpy = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
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
    it("should call info method with correct arguments", () => {
      const message = "Test info message";
      const args = ["arg1", 42, { key: "value" }];

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
    it("should not call info when verbose is false", () => {
      logger.setVerbose(false);
      const message = "Debug message";
      const initialInfoCalls = consoleSpy.info.mock.calls.length;

      logger.debug(message);

      expect(consoleSpy.info).toHaveBeenCalledTimes(initialInfoCalls);
    });

    it("should call info when verbose is true", () => {
      logger.setVerbose(true);
      const message = "Debug message";
      const args = ["debug", "args"];
      const initialInfoCalls = consoleSpy.info.mock.calls.length;

      logger.debug(message, ...args);

      expect(consoleSpy.info).toHaveBeenCalledWith(message, ...args);
      expect(consoleSpy.info).toHaveBeenCalledTimes(initialInfoCalls + 1);
    });

    it("should respect verbose mode changes", () => {
      const message = "Debug message";

      // First call with verbose false
      logger.setVerbose(false);
      const initialInfoCalls = consoleSpy.info.mock.calls.length;
      logger.debug(message);
      expect(consoleSpy.info).toHaveBeenCalledTimes(initialInfoCalls);

      // Second call with verbose true
      logger.setVerbose(true);
      logger.debug(message);
      expect(consoleSpy.info).toHaveBeenCalledWith(message);
      expect(consoleSpy.info).toHaveBeenCalledTimes(initialInfoCalls + 1);

      // Third call with verbose back to false
      logger.setVerbose(false);
      logger.debug(message);
      expect(consoleSpy.info).toHaveBeenCalledTimes(initialInfoCalls + 1); // Still only called once more
    });
  });

  describe("method chaining and state", () => {
    it("should maintain state across multiple calls", () => {
      logger.setVerbose(true);

      logger.info("message 1");
      logger.debug("message 2");
      logger.warn("message 3");
      logger.error("message 4");
      logger.success("message 5");

      // info is called twice: once by info() and once by debug() since debug uses info internally
      expect(consoleSpy.info).toHaveBeenCalledTimes(2);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.success).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle undefined arguments", () => {
      logger.info("message", undefined);
      logger.success("message", undefined);
      logger.warn("message", undefined);
      logger.error("message", undefined);

      expect(consoleSpy.info).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.success).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.warn).toHaveBeenCalledWith("message", undefined);
      expect(consoleSpy.error).toHaveBeenCalledWith("message", undefined);
    });

    it("should handle null arguments", () => {
      logger.info("message", null);
      expect(consoleSpy.info).toHaveBeenCalledWith("message", null);
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
      logger.info("");
      logger.debug("");

      expect(consoleSpy.info).toHaveBeenCalledWith("");
      // debug doesn't call info when verbose is false by default
      expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    });

    it("should handle messages with no additional arguments", () => {
      logger.info("Just a message");
      logger.success("Just a message");
      logger.warn("Just a message");
      logger.error("Just a message");

      expect(consoleSpy.info).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.success).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.warn).toHaveBeenCalledWith("Just a message");
      expect(consoleSpy.error).toHaveBeenCalledWith("Just a message");
    });
  });
});
