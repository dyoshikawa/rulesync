import { consola } from "consola";

import { ErrorCodes, JsonOutput } from "../types/json-output.js";
import { isEnvTest } from "./vitest.js";

// Logger class - create instances per context instead of singleton
export class Logger {
  private _verbose = false;
  private _silent = false;
  private _jsonMode = false;
  private _commandName = "";
  private _jsonData: Record<string, unknown> = {};
  private console = consola.withDefaults({
    tag: "rulesync",
  });

  /**
   * Create a new Logger instance
   */
  constructor(private _version: string = "0.0.0") {}

  /**
   * Configure logger with verbose and silent mode settings.
   * Handles conflicting flags where silent takes precedence.
   */
  configure({ verbose, silent }: { verbose: boolean; silent: boolean }): void {
    if (verbose && silent) {
      // Temporarily disable silent to show this warning
      this._silent = false;
      this.warn("Both --verbose and --silent specified; --silent takes precedence");
    }
    this._silent = silent;
    this._verbose = verbose && !silent;
  }

  get verbose(): boolean {
    return this._verbose;
  }

  get silent(): boolean {
    return this._silent;
  }

  /**
   * Enable JSON output mode
   */
  setJsonMode(enabled: boolean, command: string): void {
    this._jsonMode = enabled;
    this._commandName = command;
    if (enabled) {
      this._jsonData = {};
    }
  }

  /**
   * Check if JSON mode is enabled
   */
  get jsonMode(): boolean {
    return this._jsonMode;
  }

  /**
   * Capture data for JSON output
   */
  captureData(key: string, value: unknown): void {
    if (this._jsonMode) {
      this._jsonData[key] = value;
    }
  }

  /**
   * Get captured JSON data
   */
  getJsonData(): Record<string, unknown> {
    return { ...this._jsonData };
  }

  /**
   * Output final JSON result
   */
  outputJson(
    success: boolean,
    error?: { code: string; message: string; stack?: string; details?: unknown },
  ): void {
    if (!this._jsonMode) return;

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

  info(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    if (this._jsonMode) return;
    this.console.info(message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    if (this._jsonMode) return;
    this.console.success(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    if (this._jsonMode) return;
    this.console.warn(message, ...args);
  }

  error(message: string | Error, code?: string, ...args: unknown[]): void {
    if (isEnvTest()) return;

    const errorMessage = message instanceof Error ? message.message : message;

    if (this._jsonMode) {
      const errorInfo: { code: string; message: string; stack?: string } = {
        code: code || ErrorCodes.UNKNOWN_ERROR,
        message: errorMessage,
      };

      if (this._verbose && message instanceof Error && message.stack) {
        errorInfo.stack = message.stack;
      }

      this.outputJson(false, errorInfo);
    } else {
      this.console.error(errorMessage, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (isEnvTest() || this._silent) return;
    if (this._jsonMode) return;
    if (this._verbose) {
      this.console.info(message, ...args);
    }
  }

  /**
   * Get the internal console instance (for testing only)
   * @internal
   */
  _getConsole(): typeof consola {
    return this.console;
  }
}

// Factory function to create loggers - use this instead of singleton
export function createLogger(version: string): Logger {
  return new Logger(version);
}

// Backwards-compatible singleton instance
// @deprecated Use createLogger() for new code
export const logger = new Logger("0.0.0");
