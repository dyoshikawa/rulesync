import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { CLIError } from "../types/json-output.js";
import { Logger } from "../utils/logger.js";
import { createLogger, wrapCommand } from "./wrap-command.js";

function createMockLoggerInstance(): Logger {
  return {
    configure: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: false,
    silent: false,
    jsonMode: false,
    captureData: vi.fn(),
    getJsonData: vi.fn().mockReturnValue({}),
    outputJson: vi.fn(),
  } satisfies Logger;
}

function createMockCommand(globalOpts: Record<string, unknown> = {}): Command {
  const parent = { opts: () => globalOpts } as unknown as Command;
  return { parent } as unknown as Command;
}

const getVersion = () => "1.0.0";

describe("wrapCommand", () => {
  let mockLogger: Logger;
  let mockLoggerFactory: Mock;
  let processExitSpy: Mock;

  beforeEach(() => {
    mockLogger = createMockLoggerInstance();
    mockLoggerFactory = vi.fn().mockReturnValue(mockLogger);
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("logger creation", () => {
    it("should pass correct params to loggerFactory without json", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion,
        loggerFactory: mockLoggerFactory,
      });

      const options = {};
      const command = createMockCommand({});
      await wrapped(options, command);

      expect(mockLoggerFactory).toHaveBeenCalledWith({
        name: "test",
        globalOpts: {},
        getVersion,
      });
    });

    it("should pass json global option to loggerFactory", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion,
        loggerFactory: mockLoggerFactory,
      });

      const options = {};
      const command = createMockCommand({ json: true });
      await wrapped(options, command);

      expect(mockLoggerFactory).toHaveBeenCalledWith({
        name: "test",
        globalOpts: { json: true },
        getVersion,
      });
    });
  });

  describe("logger configuration", () => {
    it("should configure verbose from global options", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({ verbose: true }));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure verbose from command options", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({ verbose: true }, createMockCommand({}));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure silent from global options", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({ silent: true }));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });

    it("should configure silent from command options", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({ silent: true }, createMockCommand({}));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });
  });

  describe("positional arguments", () => {
    it("should pass positional arguments to handler", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      const options = { key: "value" };
      const command = createMockCommand({});
      await wrapped("arg1", "arg2", options, command);

      expect(handler).toHaveBeenCalledWith(mockLogger, options, {}, ["arg1", "arg2"]);
    });

    it("should pass empty positional args when none provided", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      const options = {};
      const command = createMockCommand({});
      await wrapped(options, command);

      expect(handler).toHaveBeenCalledWith(mockLogger, options, {}, []);
    });
  });

  describe("success path", () => {
    it("should call outputJson on success", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.outputJson).toHaveBeenCalledWith(true);
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle CLIError with custom exit code", async () => {
      const cliError = new CLIError("Config not found", "CONFIG_NOT_FOUND", 2);
      const handler = vi.fn().mockRejectedValue(cliError);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(cliError, "CONFIG_NOT_FOUND");
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should handle CLIError with default exit code", async () => {
      const cliError = new CLIError("Something failed", "UNKNOWN_ERROR");
      const handler = vi.fn().mockRejectedValue(cliError);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(cliError, "UNKNOWN_ERROR");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle generic Error with provided errorCode", async () => {
      const error = new Error("Network error");
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = wrapCommand({
        name: "fetch",
        errorCode: "FETCH_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(error, "FETCH_FAILED");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle non-Error thrown values", async () => {
      const handler = vi.fn().mockRejectedValue("string error");
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith("string error", "TEST_FAILED");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("global options fallback", () => {
    it("should default globalOpts to empty object when command has no parent", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommand({
        name: "test",
        errorCode: "TEST_FAILED",
        handler,
        getVersion: () => "1.0.0",
        loggerFactory: mockLoggerFactory,
      });

      const commandWithoutParent = {} as unknown as Command;
      await wrapped({}, commandWithoutParent);

      expect(handler).toHaveBeenCalledWith(mockLogger, {}, {}, []);
    });
  });
});

describe("createLogger", () => {
  it("should create ConsoleLogger when json is not set", () => {
    const logger = createLogger({
      name: "test",
      globalOpts: {},
      getVersion: () => "1.0.0",
    });

    expect(logger.jsonMode).toBe(false);
  });

  it("should create JsonLogger when json is set", () => {
    const logger = createLogger({
      name: "test",
      globalOpts: { json: true },
      getVersion: () => "1.0.0",
    });

    expect(logger.jsonMode).toBe(true);
  });
});
