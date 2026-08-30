import { CLIError, ErrorCodes, JsonOutput } from "../types/json-output.js";
import { isEnvTest } from "./vitest.js";
import { claimWarnOnce } from "./warned-once.js";

export type JsonErrorInfo = {
  code: string;
  message: string;
  stack?: string;
  details?: unknown;
};

/**
 * Logger interface - defines the contract for all logger implementations
 */
export type Logger = {
  configure(options: { verbose: boolean; silent: boolean }): void;
  readonly verbose: boolean;
  readonly silent: boolean;
  /**
   * True when the logger hands the warnings it is given back to its caller
   * instead of writing them somewhere. Such a logger reports even while
   * `silent`, so `warnOnceWithFallback` still spends the run's token on it.
   */
  readonly retainsWarnings?: boolean;
  readonly jsonMode: boolean;
  captureData(key: string, value: unknown): void;
  getJsonData(): Record<string, unknown>;
  outputJson(success: boolean, error?: JsonErrorInfo): void;
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

  constructor({ verbose = false, silent = false }: { verbose?: boolean; silent?: boolean } = {}) {
    this._silent = silent;
    this._verbose = verbose && !silent;
  }

  get verbose(): boolean {
    return this._verbose;
  }

  get silent(): boolean {
    return this._silent;
  }

  // Silent always wins over verbose, regardless of where each value came
  // from (CLI flag or config file). The user-facing warning about the
  // conflicting CLI flags lives in `warnOnConflictingFlags`, emitted once at
  // CLI-flag parsing time — not here, since `configure` may be called again
  // with config-file-derived values.
  configure({ verbose, silent }: { verbose: boolean; silent: boolean }): void {
    this._silent = silent;
    this._verbose = verbose && !silent;
  }
}

/**
 * ConsoleLogger - human-readable terminal output
 */
export class ConsoleLogger extends BaseLogger implements Logger {
  private isSuppressed(): boolean {
    return isEnvTest() || this._silent;
  }

  get jsonMode(): boolean {
    return false;
  }

  captureData(_key: string, _value: unknown): void {
    // No-op for console logger
  }

  getJsonData(): Record<string, unknown> {
    return {};
  }

  outputJson(_success: boolean, _error?: JsonErrorInfo): void {
    // No-op for console logger
  }

  info(message: string, ...args: unknown[]): void {
    if (this.isSuppressed()) return;
    console.log(message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    if (this.isSuppressed()) return;
    console.log(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.isSuppressed()) return;
    console.warn(message, ...args);
  }

  // Errors are always emitted, even in silent mode
  error(message: string | Error, _code?: string, ...args: unknown[]): void {
    if (isEnvTest()) return;
    const errorMessage = message instanceof Error ? message.message : message;
    console.error(errorMessage, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this._verbose || this.isSuppressed()) return;
    console.log(message, ...args);
  }
}

/**
 * JsonLogger - structured JSON output to stdout/stderr
 *
 * The console output methods (info, success, debug) are no-ops. `warn` is not:
 * a diagnostic that only reached the console would be invisible to a `--json`
 * consumer, which reads the document and nothing else, so warnings are
 * collected and emitted under `data.warnings` instead.
 */
export class JsonLogger extends BaseLogger implements Logger {
  private _jsonOutputDone = false;
  private _jsonData: Record<string, unknown> = {};
  private readonly _warnings: string[] = [];
  private readonly _commandName: string;
  private readonly _version: string;

  constructor({
    command,
    version,
    verbose = false,
    silent = false,
  }: {
    command: string;
    version: string;
    verbose?: boolean;
    silent?: boolean;
  }) {
    super({ verbose, silent });
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

  outputJson(success: boolean, error?: JsonErrorInfo): void {
    if (this._jsonOutputDone) return;
    this._jsonOutputDone = true;

    const output: JsonOutput = {
      success,
      timestamp: new Date().toISOString(),
      command: this._commandName,
      version: this._version,
    };

    if (success) {
      // `warnings` is the logger's own key rather than a captured one, so a
      // command that captures data of its own never has to know about it.
      output.data =
        this._warnings.length > 0
          ? { ...this._jsonData, warnings: [...this._warnings] }
          : this._jsonData;
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

  warn(message: string, ...args: unknown[]): void {
    // `--silent` asks for no diagnostics at all, which the document honors as
    // the console does; otherwise the warning is kept for `data.warnings`.
    if (this._silent) return;
    this._warnings.push([message, ...args.map((arg) => String(arg))].join(" "));
  }

  error(message: string | Error, code?: string, ..._args: unknown[]): void {
    if (isEnvTest()) return;

    const errorMessage = message instanceof Error ? message.message : message;
    const errorInfo: JsonErrorInfo = {
      code: code || ErrorCodes.UNKNOWN_ERROR,
      message: errorMessage,
    };

    if (this._verbose && message instanceof Error && message.stack) {
      errorInfo.stack = message.stack;
    }

    if (message instanceof CLIError && message.details !== undefined) {
      errorInfo.details = message.details;
    }

    this.outputJson(false, errorInfo);
  }

  debug(_message: string, ..._args: unknown[]): void {
    // Suppress console output in JSON mode
  }
}

/**
 * Warn once when both `--verbose` and `--silent` were passed on the command
 * line. Called at CLI-flag parsing time only (`wrapCommand`), so re-configuring
 * a logger from config-file values never re-triggers it. Suppressed in JSON
 * mode to keep non-JSON text off stderr, matching the former JsonLogger
 * behavior.
 */
export function warnOnConflictingFlags({
  verbose,
  silent,
  jsonMode,
}: {
  verbose: boolean;
  silent: boolean;
  jsonMode: boolean;
}): void {
  if (!verbose || !silent || jsonMode || isEnvTest()) return;
  // oxlint-disable-next-line no-console
  console.warn("Both --verbose and --silent specified; --silent takes precedence");
}

/**
 * Shared fallback logger for code paths that have no command logger threaded
 * through (module-level translators, `warnWithFallback(undefined, ...)`).
 * `wrapCommand` configures it from CLI flags and `ConfigResolver.resolve`
 * re-configures it from the resolved config, so `silent`/`verbose` settings
 * are honored even on paths where the command logger is not available.
 */
export const fallbackLogger: Logger = new ConsoleLogger();

/**
 * Emit a warning through `logger.warn` if a logger is supplied, otherwise
 * fall through to the shared `fallbackLogger`. Centralizes the "logger may
 * be optional" pattern so call sites stay terse and the fallback honors the
 * configured `silent` mode.
 */
export function warnWithFallback(logger: Logger | undefined, message: string): void {
  (logger ?? fallbackLogger).warn(message);
}

/**
 * Emit a warning at most once per run. A single `generate` reads the same source
 * file once per enabled tool target, so a warning that describes the source
 * rather than the target would otherwise be printed a dozen identical times.
 * Diagnostics that name the file they are about qualify; anything whose text
 * varies with what the user should do next does not.
 */
export function warnOnceWithFallback(logger: Logger | undefined, message: string): void {
  const destination = logger ?? fallbackLogger;
  // A silent logger reports nothing, so claiming the token for it would spend a
  // once-per-run warning on a run nobody saw. That matters in a long-lived
  // process — an MCP server reads with a silent logger — where the next read,
  // through a logger that does report, would otherwise stay quiet about the
  // same file.
  if (destination.silent && destination.retainsWarnings !== true) {
    return;
  }
  if (!claimWarnOnce(message)) {
    return;
  }
  destination.warn(message);
}

/**
 * A `ConsoleLogger` that keeps the warnings it is given.
 *
 * A caller with no console to write to — an MCP tool answering over stdio, where
 * the server's stderr never reaches the agent — can hand this in and put what
 * was reported into its own result, so a diagnostic about the files it just read
 * is something the agent can act on rather than something it never hears.
 */
export class WarningCollectingLogger extends ConsoleLogger {
  readonly retainsWarnings = true;

  private readonly warnings: string[] = [];

  override warn(message: string, ...args: unknown[]): void {
    this.warnings.push([message, ...args.map((arg) => String(arg))].join(" "));
    super.warn(message, ...args);
  }

  getWarnings(): readonly string[] {
    return this.warnings;
  }
}
