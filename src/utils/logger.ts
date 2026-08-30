import { format } from "node:util";

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
   * True when the logger still reports the warnings it is given while `silent`
   * — because it hands them back to its caller instead of writing them to a
   * console the `--silent` flag speaks for. `warnOnceWithFallback` spends the
   * run's once-per-message token only on a logger that reports.
   *
   * Required rather than optional so every implementation, and every object
   * literal that wraps one, has to answer the question; a wrapper that quietly
   * inherited `false` would drop its target's warnings.
   */
  readonly reportsWhileSilent: boolean;
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
 * Formats a log line the way `console.warn` would, so a warning that is handed
 * back to a caller reads the same as the one that reaches a terminal.
 */
function formatLogLine(message: string, args: unknown[]): string {
  return args.length === 0 ? message : format(message, ...args);
}

/**
 * How many warnings a collecting logger keeps, and how long each one may be.
 *
 * Collected warnings travel to places a console line does not — a `--json`
 * document that another program parses, an MCP result that an agent reads as
 * context — so the amount a repository's own configuration can push through
 * has to be bounded. A config with thousands of odd keys is a plausible
 * accident; either limit turns it into a short, honest report rather than a
 * multi-megabyte one.
 */
const MAX_COLLECTED_WARNINGS = 100;
const MAX_COLLECTED_WARNING_LENGTH = 2_000;

/**
 * A bounded list of warning lines.
 */
class WarningCollection {
  private readonly lines: string[] = [];
  private omitted = 0;

  add(message: string, args: unknown[]): void {
    if (this.lines.length >= MAX_COLLECTED_WARNINGS) {
      this.omitted++;
      return;
    }
    const line = formatLogLine(message, args);
    this.lines.push(
      line.length > MAX_COLLECTED_WARNING_LENGTH
        ? `${line.slice(0, MAX_COLLECTED_WARNING_LENGTH)}… (truncated)`
        : line,
    );
  }

  toArray(): string[] {
    if (this.omitted === 0) return [...this.lines];
    return [...this.lines, `… and ${this.omitted} more warning(s) not reported`];
  }
}

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

  get reportsWhileSilent(): boolean {
    return false;
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
 * collected and emitted as the document's top-level `warnings` array instead.
 * Top-level rather than inside `data` so it can never collide with a key a
 * command captured, and so it survives on the failure document too — the case
 * where a diagnostic about the input is most likely to explain the failure.
 */
export class JsonLogger extends BaseLogger implements Logger {
  private _jsonOutputDone = false;
  private _jsonData: Record<string, unknown> = {};
  private readonly _warnings = new WarningCollection();
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

    const warnings = this._warnings.toArray();
    if (warnings.length > 0) {
      output.warnings = warnings;
    }

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

  warn(message: string, ...args: unknown[]): void {
    // `--silent` asks for no diagnostics at all, which the document honors as
    // the console does; otherwise the warning is kept for `warnings`.
    if (this._silent) return;
    this._warnings.add(message, args);
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
 * Where `fallbackLogger` currently sends what it is given. Defaults to a plain
 * console logger, which is what a code path with no command logger threaded
 * through would otherwise have used.
 */
let fallbackTarget: Logger = new ConsoleLogger();

/**
 * Shared fallback logger for code paths that have no command logger threaded
 * through (module-level translators, `warnWithFallback(undefined, ...)`).
 *
 * It is a thin forwarder rather than a logger of its own so that the command
 * currently running can adopt it: `wrapCommand` points it at the command
 * logger, which is how a warning raised deep in a translator still reaches a
 * `--json` document or an MCP result instead of being written to a console
 * that nobody in those modes is reading. Modules that captured a reference to
 * `fallbackLogger` at import time follow the redirection too, which a
 * swapped-out binding would not give us.
 */
export const fallbackLogger: Logger = {
  configure(options: { verbose: boolean; silent: boolean }): void {
    fallbackTarget.configure(options);
  },
  get verbose(): boolean {
    return fallbackTarget.verbose;
  },
  get silent(): boolean {
    return fallbackTarget.silent;
  },
  get reportsWhileSilent(): boolean {
    return fallbackTarget.reportsWhileSilent;
  },
  get jsonMode(): boolean {
    return fallbackTarget.jsonMode;
  },
  captureData(key: string, value: unknown): void {
    fallbackTarget.captureData(key, value);
  },
  getJsonData(): Record<string, unknown> {
    return fallbackTarget.getJsonData();
  },
  outputJson(success: boolean, error?: JsonErrorInfo): void {
    fallbackTarget.outputJson(success, error);
  },
  info(message: string, ...args: unknown[]): void {
    fallbackTarget.info(message, ...args);
  },
  success(message: string, ...args: unknown[]): void {
    fallbackTarget.success(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    fallbackTarget.warn(message, ...args);
  },
  error(message: string | Error, code?: string, ...args: unknown[]): void {
    fallbackTarget.error(message, code, ...args);
  },
  debug(message: string, ...args: unknown[]): void {
    fallbackTarget.debug(message, ...args);
  },
};

/**
 * Run `operation` with `fallbackLogger` pointed at `logger`, so warnings raised
 * where no logger was threaded through end up in the same place as the rest of
 * that operation's diagnostics.
 *
 * The redirection is scoped rather than set once and left: the target is
 * process-global, and a long-lived process (the MCP server) that left it
 * pointing at a finished request's logger would send the next request's
 * warnings somewhere nobody reads. The previous target is restored even if the
 * operation throws.
 */
export async function withFallbackLoggerTarget<T>({
  logger,
  operation,
}: {
  logger: Logger;
  operation: () => Promise<T>;
}): Promise<T> {
  const previous = fallbackTarget;
  // Forwarding the forwarder to itself would recurse forever; a caller that
  // passes it can only have meant "leave the fallback alone".
  fallbackTarget = logger === fallbackLogger ? previous : logger;
  try {
    return await operation();
  } finally {
    fallbackTarget = previous;
  }
}

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
  if (destination.silent && !destination.reportsWhileSilent) {
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
  private readonly warnings = new WarningCollection();

  override get reportsWhileSilent(): boolean {
    return true;
  }

  override warn(message: string, ...args: unknown[]): void {
    this.warnings.add(message, args);
    super.warn(message, ...args);
  }

  getWarnings(): string[] {
    return this.warnings.toArray();
  }
}
