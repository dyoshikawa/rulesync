import { consola } from "consola";

import { isEnvTest } from "./vitest.js";

// Global logger instance with configurable verbosity
class Logger {
  private _verbose = false;
  private _silent = false;
  private console = consola.withDefaults({
    tag: "rulesync",
  });

  /**
   * Configure logger with verbose and silent mode settings.
   * Handles conflicting flags where silent takes precedence.
   * @param verbose - Enable verbose logging
   * @param silent - Enable silent mode (suppresses all output except errors)
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

  setVerbose(verbose: boolean): void {
    this._verbose = verbose;
  }

  get verbose(): boolean {
    return this._verbose;
  }

  setSilent(silent: boolean): void {
    this._silent = silent;
  }

  get silent(): boolean {
    return this._silent;
  }

  info(message: string, ...args: unknown[]): void {
    if (isEnvTest || this._silent) return;
    this.console.info(message, ...args);
  }

  // Success (always shown unless silent)
  success(message: string, ...args: unknown[]): void {
    if (isEnvTest || this._silent) return;
    this.console.success(message, ...args);
  }

  // Warning (always shown unless silent)
  warn(message: string, ...args: unknown[]): void {
    if (isEnvTest || this._silent) return;
    this.console.warn(message, ...args);
  }

  // Error (always shown, even in silent mode)
  error(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    this.console.error(message, ...args);
  }

  // Debug level (shown only in verbose mode)
  debug(message: string, ...args: unknown[]): void {
    if (isEnvTest || this._silent) return;
    if (this._verbose) {
      this.console.info(message, ...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
