import { ErrorCodes, JsonOutput } from "../types/json-output.js";
import { isEnvTest } from "./vitest.js";

/**
 * Logger interface - defines the contract for all logger implementations
 */
export type Logger = {
  configure(options: { verbose: boolean; silent: boolean }): void;
  readonly verbose: boolean;
  readonly silent: boolean;
  readonly jsonMode: boolean;
  captureData(key: string, value: unknown): void;
  getJsonData(): Record<string, unknown>;
  outputJson(
    success: boolean,
    error?: { code: string; message: string; stack?: string; details?: unknown },
  ): void;
  info(message: string, ...args: unknown[]): void;
  success(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, code?: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
};

/**
 * Base class for shared verbose/silent state and configuration logic
 */
abstract class BaseLogger {
  protected _verbose = false;
  protected _silent = false;

  get verbose(): boolean {
    return this._verbose;
  }

  get silent(): boolean {
    return this._silent;
  }

  configure({ verbose, silent }: { verbose: boolean; silent: boolean }): void {
    if (verbose && silent) {
      this._silent = false;
      this.warn("Both --verbose and --silent specified; --silent takes precedence");
    }
    this._silent = silent;
    this._verbose = verbose && !silent;
  }

  abstract warn(message: string, ...args: unknown[]): void;
}

/**
 * ConsoleLogger - human-readable terminal output
 */
export class ConsoleLogger extends BaseLogger implements Logger {
  get jsonMode(): boolean {
    return false;
  }

  captureData(_key: string, _value: unknown): void {
    // No-op for console logger
  }

  getJsonData(): Record<string, unknown> {
    return {};
  }

  outputJson(
    _success: boolean,
    _error?: { code: string; message: string; stack?: string; details?: unknown },
  ): void {
    // No-op for console logger
  }

  info(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    console.log(message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    console.log(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    console.warn(message, ...args);
  }

  error(message: string | Error, _code?: string, ...args: unknown[]): void {
    if (isEnvTest()) return;
    const errorMessage = message instanceof Error ? message.message : message;
    console.error(errorMessage, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    if (this._verbose) {
      console.log(message, ...args);
    }
  }
}

/**
 * JsonLogger - structured JSON output to stdout/stderr
 *
 * All console output methods (info, success, warn, debug) are no-ops.
 * The warn method in BaseLogger.configure() is also a no-op here,
 * so conflicting --verbose/--silent flags produce no visible warning in JSON mode.
 */
export class JsonLogger extends BaseLogger implements Logger {
  private _jsonOutputDone = false;
  private _jsonData: Record<string, unknown> = {};
  private _commandName: string;
  private _version: string;

  constructor({ command, version }: { command: string; version: string }) {
    super();
    this._commandName = command;
    this._version = version;
  }

  get jsonMode(): boolean {
    return true;
  }

  captureData(key: string, value: unknown): void {
    this._jsonData[key] = value;
  }

  getJsonData(): Record<string, unknown> {
    return { ...this._jsonData };
  }

  outputJson(
    success: boolean,
    error?: { code: string; message: string; stack?: string; details?: unknown },
  ): void {
    if (this._jsonOutputDone) return;
    this._jsonOutputDone = true;

    const output: JsonOutput = {
      success,
      timestamp: new Date().toISOString(),
      command: this._commandName,
      version: this._version,
    };

    if (success) {
      output.data = this._jsonData;
    } else if (error) {
      output.error = {
        code: error.code,
        message: error.message,
      };
      if (error.details) {
        output.error.details = error.details;
      }
      if (error.stack) {
        output.error.stack = error.stack;
      }
    }

    const jsonStr = JSON.stringify(output, null, 2);

    if (success) {
      console.log(jsonStr);
    } else {
      console.error(jsonStr);
    }
  }

  info(_message: string, ..._args: unknown[]): void {
    // Suppress console output in JSON mode
  }

  success(_message: string, ..._args: unknown[]): void {
    // Suppress console output in JSON mode
  }

  warn(_message: string, ..._args: unknown[]): void {
    // Suppress console output in JSON mode
  }

  error(message: string | Error, code?: string, ..._args: unknown[]): void {
    if (isEnvTest()) return;

    const errorMessage = message instanceof Error ? message.message : message;
    const errorInfo: { code: string; message: string; stack?: string } = {
      code: code || ErrorCodes.UNKNOWN_ERROR,
      message: errorMessage,
    };

    if (this._verbose && message instanceof Error && message.stack) {
      errorInfo.stack = message.stack;
    }

    this.outputJson(false, errorInfo);
  }

  debug(_message: string, ..._args: unknown[]): void {
    // Suppress console output in JSON mode
  }
}

// Factory functions
export function createConsoleLogger(): ConsoleLogger {
  return new ConsoleLogger();
}

export function createJsonLogger({
  command,
  version,
}: {
  command: string;
  version: string;
}): JsonLogger {
  return new JsonLogger({ command, version });
}

/** @deprecated Use createConsoleLogger() or createJsonLogger() for new code */
export const logger: Logger = new ConsoleLogger();
