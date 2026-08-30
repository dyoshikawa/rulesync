import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { createMockLogger, type MockLogger } from "../test-utils/mock-logger.js";
import { CLIError } from "../types/json-output.js";
import { JsonLogger, Logger, warnWithFallback } from "../utils/logger.js";
import { createLogger, wrapCommand } from "./wrap-command.js";

type CommandHandler = (
  logger: Logger,
  options: unknown,
  globalOpts: Record<string, unknown>,
  positionalArgs: unknown[],
) => Promise<void>;

type LoggerFactory = (params: {
  name: string;
  globalOpts: Record<string, unknown>;
  getVersion: () => string;
}) => Logger;

function createMockCommand(globalOpts: Record<string, unknown> = {}): Command {
  const parent = { opts: () => globalOpts } as unknown as Command;
  return { parent } as unknown as Command;
}

const getVersion = () => "1.0.0";

function createWrappedCommand(
  overrides: {
    handler?: CommandHandler;
    name?: string;
    errorCode?: string;
  } = {},
  mockLoggerFactory: LoggerFactory,
) {
  const handler =
    overrides.handler ?? (vi.fn().mockResolvedValue(undefined) as unknown as CommandHandler);
  return {
    handler,
    wrapped: wrapCommand({
      name: overrides.name ?? "test",
      errorCode: overrides.errorCode ?? "TEST_FAILED",
      handler,
      getVersion,
      loggerFactory: mockLoggerFactory,
    }),
  };
}

describe("wrapCommand", () => {
  let mockLogger: MockLogger;
  let mockLoggerFactory: LoggerFactory;
  let processExitSpy: MockInstance;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockLoggerFactory = vi.fn().mockReturnValue(mockLogger) as unknown as LoggerFactory;
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("logger creation", () => {
    it("should pass correct params to loggerFactory without json", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({}, createMockCommand({}));

      expect(mockLoggerFactory).toHaveBeenCalledWith({
        name: "test",
        globalOpts: {},
        getVersion,
      });
    });

    it("should pass json global option to loggerFactory", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({}, createMockCommand({ json: true }));

      expect(mockLoggerFactory).toHaveBeenCalledWith({
        name: "test",
        globalOpts: { json: true },
        getVersion,
      });
    });
  });

  describe("logger configuration", () => {
    it("should configure verbose from global options", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({}, createMockCommand({ verbose: true }));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure verbose from command options", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({ verbose: true }, createMockCommand({}));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: true,
        silent: false,
      });
    });

    it("should configure silent from global options", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({}, createMockCommand({ silent: true }));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });

    it("should configure silent from command options", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({ silent: true }, createMockCommand({}));

      expect(mockLogger.configure).toHaveBeenCalledWith({
        verbose: false,
        silent: true,
      });
    });
  });

  describe("shared fallback logger", () => {
    it("routes a warning raised without a logger into the --json document", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const jsonLogger = new JsonLogger({ command: "test", version: "1.0.0" });
      const { wrapped } = createWrappedCommand(
        {
          handler: vi.fn().mockImplementation(async () => {
            // A module-level translator deep in the run, with no logger of its
            // own. On stderr this line would be invisible to a `--json`
            // consumer, which reads the document and nothing else.
            warnWithFallback(undefined, "machine-local settings were skipped");
          }) as unknown as CommandHandler,
        },
        (() => jsonLogger) as unknown as LoggerFactory,
      );

      await wrapped({}, createMockCommand({ json: true }));

      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);

      expect(output.warnings).toEqual(["machine-local settings were skipped"]);
    });

    it("honors --silent on that path as well", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const jsonLogger = new JsonLogger({ command: "test", version: "1.0.0" });
      const { wrapped } = createWrappedCommand(
        {
          handler: vi.fn().mockImplementation(async () => {
            warnWithFallback(undefined, "machine-local settings were skipped");
          }) as unknown as CommandHandler,
        },
        (() => jsonLogger) as unknown as LoggerFactory,
      );

      await wrapped({}, createMockCommand({ json: true, silent: true }));

      const output = JSON.parse(logSpy.mock.calls[0]![0] as string);

      expect(output.warnings).toBeUndefined();
    });
  });

  describe("positional arguments", () => {
    it("should pass positional arguments to handler", async () => {
      const { handler, wrapped } = createWrappedCommand({}, mockLoggerFactory);

      const options = { key: "value" };
      await wrapped("arg1", "arg2", options, createMockCommand({}));

      expect(handler).toHaveBeenCalledWith(mockLogger, options, {}, ["arg1", "arg2"]);
    });

    it("should pass empty positional args when none provided", async () => {
      const { handler, wrapped } = createWrappedCommand({}, mockLoggerFactory);

      const options = {};
      await wrapped(options, createMockCommand({}));

      expect(handler).toHaveBeenCalledWith(mockLogger, options, {}, []);
    });
  });

  describe("success path", () => {
    it("should call outputJson on success", async () => {
      const { wrapped } = createWrappedCommand({}, mockLoggerFactory);

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.outputJson).toHaveBeenCalledWith(true);
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle CLIError with custom exit code", async () => {
      const cliError = new CLIError("Config not found", "CONFIG_NOT_FOUND", 2);
      const { wrapped } = createWrappedCommand(
        { handler: vi.fn().mockRejectedValue(cliError) as unknown as CommandHandler },
        mockLoggerFactory,
      );

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(cliError, "CONFIG_NOT_FOUND");
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it("should handle CLIError with default exit code", async () => {
      const cliError = new CLIError("Something failed", "UNKNOWN_ERROR");
      const { wrapped } = createWrappedCommand(
        { handler: vi.fn().mockRejectedValue(cliError) as unknown as CommandHandler },
        mockLoggerFactory,
      );

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(cliError, "UNKNOWN_ERROR");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle generic Error with provided errorCode", async () => {
      const error = new Error("Network error");
      const { wrapped } = createWrappedCommand(
        {
          name: "fetch",
          errorCode: "FETCH_FAILED",
          handler: vi.fn().mockRejectedValue(error) as unknown as CommandHandler,
        },
        mockLoggerFactory,
      );

      await wrapped({}, createMockCommand({}));

      expect(mockLogger.error).toHaveBeenCalledWith(error, "FETCH_FAILED");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle non-Error thrown values via formatError", async () => {
      const thrownValue = { code: 42, detail: "unexpected" };
      const { wrapped } = createWrappedCommand(
        { handler: vi.fn().mockRejectedValue(thrownValue) as unknown as CommandHandler },
        mockLoggerFactory,
      );

      await wrapped({}, createMockCommand({}));

      // formatError converts non-Error values via String(), producing "[object Object]"
      expect(mockLogger.error).toHaveBeenCalledWith("[object Object]", "TEST_FAILED");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("global options fallback", () => {
    it("should default globalOpts to empty object when command has no parent", async () => {
      const { handler, wrapped } = createWrappedCommand({}, mockLoggerFactory);

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
