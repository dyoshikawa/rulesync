import { describe, expect, it, vi } from "vitest";
import {
  combineErrors,
  createErrorResult,
  createSuccessResult,
  type ErrorResult,
  formatCliError,
  formatCliSuccess,
  formatErrorWithContext,
  getErrorMessage,
  isErrorResult,
  isSuccessResult,
  logError,
  logSuccess,
  type SuccessResult,
  safeAsyncOperation,
  safeSyncOperation,
} from "./error.js";

// Test helper functions moved to outer scope for consistent-function-scoping
const asyncSuccessOperation = async () => "success";
const asyncFailOperation = async () => {
  throw new Error("operation failed");
};
const stringErrorOperation = async () => {
  throw "string error";
};
const syncSuccessOperation = () => "success";
const syncFailOperation = () => {
  throw new Error("operation failed");
};

describe("error utilities", () => {
  describe("getErrorMessage", () => {
    it("should extract message from Error instance", () => {
      const error = new Error("test error");
      expect(getErrorMessage(error)).toBe("test error");
    });

    it("should convert non-Error values to string", () => {
      expect(getErrorMessage("string error")).toBe("string error");
      expect(getErrorMessage(123)).toBe("123");
      expect(getErrorMessage(null)).toBe("null");
      expect(getErrorMessage(undefined)).toBe("undefined");
      expect(getErrorMessage({ message: "object" })).toBe("[object Object]");
    });
  });

  describe("formatErrorWithContext", () => {
    it("should format error with context prefix", () => {
      const error = new Error("test error");
      expect(formatErrorWithContext(error, "Test context")).toBe("Test context: test error");
    });

    it("should format non-Error values with context", () => {
      expect(formatErrorWithContext("simple error", "Context")).toBe("Context: simple error");
    });
  });

  describe("createErrorResult", () => {
    it("should create error result with message", () => {
      const error = new Error("test error");
      const result = createErrorResult(error);

      expect(result).toEqual({
        success: false,
        error: "test error",
      });
    });

    it("should create error result with context", () => {
      const error = new Error("test error");
      const result = createErrorResult(error, "Test context");

      expect(result).toEqual({
        success: false,
        error: "Test context: test error",
      });
    });

    it("should handle non-Error values", () => {
      const result = createErrorResult("string error", "Context");

      expect(result).toEqual({
        success: false,
        error: "Context: string error",
      });
    });
  });

  describe("createSuccessResult", () => {
    it("should create success result with data", () => {
      const data = { test: "value" };
      const result = createSuccessResult(data);

      expect(result).toEqual({
        success: true,
        result: data,
      });
    });

    it("should handle different data types", () => {
      expect(createSuccessResult("string")).toEqual({
        success: true,
        result: "string",
      });

      expect(createSuccessResult(123)).toEqual({
        success: true,
        result: 123,
      });

      expect(createSuccessResult(null)).toEqual({
        success: true,
        result: null,
      });
    });
  });

  describe("safeAsyncOperation", () => {
    it("should return success result for successful operations", async () => {
      const result = await safeAsyncOperation(asyncSuccessOperation);

      expect(result).toEqual({
        success: true,
        result: "success",
      });
    });

    it("should return error result for failed operations", async () => {
      const result = await safeAsyncOperation(asyncFailOperation);

      expect(result).toEqual({
        success: false,
        error: "operation failed",
      });
    });

    it("should include context in error result", async () => {
      const result = await safeAsyncOperation(asyncFailOperation, "Test context");

      expect(result).toEqual({
        success: false,
        error: "Test context: operation failed",
      });
    });

    it("should handle non-Error exceptions", async () => {
      const result = await safeAsyncOperation(stringErrorOperation);

      expect(result).toEqual({
        success: false,
        error: "string error",
      });
    });
  });

  describe("safeSyncOperation", () => {
    it("should return success result for successful operations", () => {
      const result = safeSyncOperation(syncSuccessOperation);

      expect(result).toEqual({
        success: true,
        result: "success",
      });
    });

    it("should return error result for failed operations", () => {
      const result = safeSyncOperation(syncFailOperation);

      expect(result).toEqual({
        success: false,
        error: "operation failed",
      });
    });

    it("should include context in error result", () => {
      const result = safeSyncOperation(syncFailOperation, "Test context");

      expect(result).toEqual({
        success: false,
        error: "Test context: operation failed",
      });
    });
  });

  describe("formatCliError", () => {
    it("should format error with default prefix", () => {
      const error = new Error("test error");
      const result = formatCliError(error);

      expect(result).toBe("❌ test error");
    });

    it("should format error with context", () => {
      const error = new Error("test error");
      const result = formatCliError(error, "Test context");

      expect(result).toBe("❌ Test context: test error");
    });

    it("should use custom prefix", () => {
      const error = new Error("test error");
      const result = formatCliError(error, undefined, { prefix: "🚨" });

      expect(result).toBe("🚨 test error");
    });

    it("should use custom emoji", () => {
      const error = new Error("test error");
      const result = formatCliError(error, undefined, { emoji: "🔥" });

      expect(result).toBe("🔥 test error");
    });

    it("should prefer emoji over prefix", () => {
      const error = new Error("test error");
      const result = formatCliError(error, undefined, { prefix: "🚨", emoji: "🔥" });

      expect(result).toBe("🔥 test error");
    });
  });

  describe("formatCliSuccess", () => {
    it("should format success message with default emoji", () => {
      const result = formatCliSuccess("Success message");
      expect(result).toBe("✅ Success message");
    });

    it("should format success message with custom emoji", () => {
      const result = formatCliSuccess("Success message", "🎉");
      expect(result).toBe("🎉 Success message");
    });
  });

  describe("combineErrors", () => {
    it("should combine multiple errors with default separator", () => {
      const errors = ["Error 1", "Error 2", "Error 3"];
      const result = combineErrors(errors);

      expect(result).toBe("Error 1; Error 2; Error 3");
    });

    it("should combine errors with custom separator", () => {
      const errors = ["Error 1", "Error 2"];
      const result = combineErrors(errors, " | ");

      expect(result).toBe("Error 1 | Error 2");
    });

    it("should filter out empty errors", () => {
      const errors = ["Error 1", "", "Error 2", "", ""];
      const result = combineErrors(errors);

      expect(result).toBe("Error 1; Error 2");
    });

    it("should handle empty array", () => {
      const result = combineErrors([]);
      expect(result).toBe("");
    });
  });

  describe("logError", () => {
    it("should log formatted error to logger.error", async () => {
      const { logger } = await import("./logger.js");
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const error = new Error("test error");
      logError(error);

      expect(loggerSpy).toHaveBeenCalledWith("❌ test error");
      loggerSpy.mockRestore();
    });

    it("should log error with context", async () => {
      const { logger } = await import("./logger.js");
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const error = new Error("test error");
      logError(error, "Test context");

      expect(loggerSpy).toHaveBeenCalledWith("❌ Test context: test error");
      loggerSpy.mockRestore();
    });
  });

  describe("logSuccess", () => {
    it("should log formatted success to logger.success", async () => {
      const { logger } = await import("./logger.js");
      const loggerSpy = vi.spyOn(logger, "success").mockImplementation(() => {});

      logSuccess("Success message");

      expect(loggerSpy).toHaveBeenCalledWith("✅ Success message");
      loggerSpy.mockRestore();
    });
  });

  describe("type guards", () => {
    describe("isErrorResult", () => {
      it("should return true for error results", () => {
        const errorResult: ErrorResult = { success: false, error: "test error" };
        expect(isErrorResult(errorResult)).toBe(true);
      });

      it("should return false for success results", () => {
        const successResult: SuccessResult<string> = { success: true, result: "test" };
        expect(isErrorResult(successResult)).toBe(false);
      });
    });

    describe("isSuccessResult", () => {
      it("should return true for success results", () => {
        const successResult: SuccessResult<string> = { success: true, result: "test" };
        expect(isSuccessResult(successResult)).toBe(true);
      });

      it("should return false for error results", () => {
        const errorResult: ErrorResult = { success: false, error: "test error" };
        expect(isSuccessResult(errorResult)).toBe(false);
      });
    });
  });
});
