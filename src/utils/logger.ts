import { consola } from "consola";

import { isEnvTest } from "./vitest.js";

// Global logger instance with configurable verbosity
class Logger {
  private _verbose = false;
  private console = consola.withDefaults({
    tag: "rulesync",
  });

  setVerbose(verbose: boolean): void {
    this._verbose = verbose;
  }

  get verbose(): boolean {
    return this._verbose;
  }

  info(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    this.console.info(message, ...args);
  }

  // Success (always shown)
  success(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    this.console.success(message, ...args);
  }

  // Warning (always shown)
  warn(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    this.console.warn(message, ...args);
  }

  // Error (always shown)
  error(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    this.console.error(message, ...args);
  }

  // Debug level (shown only in verbose mode)
  debug(message: string, ...args: unknown[]): void {
    if (isEnvTest) return;
    if (this._verbose) {
      this.console.info(message, ...args);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
