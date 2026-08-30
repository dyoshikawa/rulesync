import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";

import { CLIError, ErrorCodes, JsonOutput } from "../types/json-output.js";
import { stripControlCharacters } from "./control-characters.js";
import { truncateText } from "./truncate.js";
import { isEnvTest } from "./vitest.js";
import { claimWarnOnce, withWarnOnceScope } from "./warned-once.js";

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
  /**
   * Must complete synchronously. `fallbackLogger` guards against a target that
   * forwards back to it with a module-level flag, and a `warn` that awaited
   * would hold that flag across the yield — sending a concurrent MCP request's
   * warning to the console instead of to the logger that request adopted.
   */
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, code?: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
};

/**
 * Formats a log line the way `console.warn` would, so a warning that is handed
 * back to a caller reads the same as the one that reaches a terminal.
 */
function formatLogLine({ message, args }: { message: string; args: unknown[] }): string {
  return args.length === 0 ? message : format(message, ...args);
}

/**
 * How much a collecting logger keeps: at most this many warnings, each at most
 * this long, and no more than this in total.
 *
 * Collected warnings travel to places a console line does not — a `--json`
 * document that another program parses, an MCP result that an agent reads as
 * context — and their text quotes files rulesync did not write. So the amount a
 * repository can push through has to be bounded twice over: a config with
 * thousands of odd keys is a plausible accident, and a report sized in hundreds
 * of kilobytes is a generous budget for text aimed at whoever reads it next.
 * The total is the binding limit; the per-line and per-count limits keep one
 * enormous warning, or one enormous number of them, from being the whole of it.
 */
const MAX_COLLECTED_WARNINGS = 100;
const MAX_COLLECTED_WARNING_LENGTH = 1_000;
const MAX_COLLECTED_TOTAL_LENGTH = 8_000;

/**
 * How many distinct warnings the de-duplication remembers.
 *
 * The record has to outlive the reported lines — a line dropped for want of
 * budget must not be counted again the next time the same diagnostic repeats —
 * so it grows with the number of distinct warnings a run raises rather than
 * with the number reported. Bounded for the same reason everything else here
 * is: past this many, later repeats are counted rather than recognized, which
 * inflates the trailing count but cannot grow the record without end.
 */
const MAX_DEDUPLICATED_WARNINGS = MAX_COLLECTED_WARNINGS * 10;

/**
 * A bounded list of warning lines.
 */
class WarningCollection {
  private readonly lines: string[] = [];
  private readonly seen = new Set<string>();
  private totalLength = 0;
  private omitted = 0;

  add({ message, args }: { message: string; args: unknown[] }): void {
    // `JSON.stringify` escapes C0 only, so a value quoted into a warning can
    // still carry a bidirectional override or a C1 introducer that reorders or
    // forges the line when whatever reads the document prints it.
    const line = stripControlCharacters(formatLogLine({ message, args }));
    const kept = truncateText({
      text: line,
      maxLength: MAX_COLLECTED_WARNING_LENGTH,
      suffix: "…(truncated)",
    });

    // A plain `warn` repeats per tool target, so without this the budget below
    // could be spent entirely on copies of one line while every distinct later
    // diagnostic is reported only as a count.
    if (this.seen.has(kept)) {
      return;
    }
    if (
      this.lines.length >= MAX_COLLECTED_WARNINGS ||
      this.totalLength + kept.length > MAX_COLLECTED_TOTAL_LENGTH
    ) {
      // Recorded as seen even though it was dropped, so the count below stays a
      // count of distinct diagnostics. A line that repeats per tool target
      // would otherwise be counted once per copy, and "and 300 more" would
      // describe twelve.
      if (this.seen.size < MAX_DEDUPLICATED_WARNINGS) {
        this.seen.add(kept);
      }
      this.omitted++;
      return;
    }
    this.seen.add(kept);
    this.lines.push(kept);
    this.totalLength += kept.length;
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
    this._warnings.add({ message, args });
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
 * Where `fallbackLogger` sends what it is given, scoped to the operation that
 * adopted it.
 *
 * An `AsyncLocalStorage` rather than a plain variable because the target is
 * per-operation, not per-process: a long-lived MCP server can have two requests
 * in flight at once, and a save/restore pair would let the first one to finish
 * hand the still-running request's warnings back to a console nobody reads.
 * Each operation sees only its own store.
 */
const fallbackTargetStorage = new AsyncLocalStorage<Logger>();

/**
 * Where warnings go outside any adopted scope: a plain console logger, which is
 * what a code path with no logger threaded through would otherwise have used.
 */
const defaultFallbackTarget: Logger = new ConsoleLogger();

function currentFallbackTarget(): Logger {
  return fallbackTargetStorage.getStore() ?? defaultFallbackTarget;
}

/**
 * True while the forwarder is inside a call it is forwarding.
 *
 * The adopted target is supposed to be something other than the forwarder, but
 * a wrapper *around* it — `hooks-processor.ts` returns one that prefixes the
 * tool target onto every warning — passes the identity check in
 * {@link withFallbackLoggerTarget} and would forward straight back here. A
 * plain module-level flag is enough because the forwarding is synchronous: the
 * call returns before anything else can run.
 */
let forwarding = false;

/**
 * Reads from, or writes to, whichever logger the running operation adopted,
 * with the wrapper case above cut off at one hop.
 *
 * Every member of the forwarder goes through here, not just the two that write:
 * `warnOnceWithFallback` reads `silent` and `reportsWhileSilent` before it ever
 * calls `warn`, so a guard on the writing side alone would still be reached
 * through a getter that never returns.
 */
function throughFallbackTarget<T>(use: (target: Logger) => T): T {
  if (forwarding) {
    // The adopted target leads back here, so this call would never terminate.
    // The console it would have reached without an adoption is what answers.
    return use(defaultFallbackTarget);
  }
  forwarding = true;
  try {
    return use(currentFallbackTarget());
  } finally {
    forwarding = false;
  }
}

/**
 * Shared fallback logger for code paths that have no command logger threaded
 * through (module-level translators, `warnWithFallback(undefined, ...)`).
 *
 * It is a thin forwarder rather than a logger of its own so that the operation
 * currently running can adopt it: `wrapCommand` points it at the command
 * logger, which is how a warning raised deep in a translator still reaches a
 * `--json` document or an MCP result instead of being written to a console that
 * nobody in those modes is reading. Modules that captured a reference to
 * `fallbackLogger` at import time follow the redirection too, which a
 * swapped-out binding would not give us.
 */
export const fallbackLogger: Logger = {
  // Configures the default target rather than an adopted one. An adopted logger
  // belongs to the operation that handed it over and is configured by it; what
  // `wrapCommand` and `ConfigResolver` are keeping in sync here is where
  // warnings go when nothing has been adopted — which is what `rulesync mcp
  // --silent` leaves in place for the lifetime of the server.
  configure(options: { verbose: boolean; silent: boolean }): void {
    defaultFallbackTarget.configure(options);
  },
  get verbose(): boolean {
    return throughFallbackTarget((target) => target.verbose);
  },
  get silent(): boolean {
    return throughFallbackTarget((target) => target.silent);
  },
  get reportsWhileSilent(): boolean {
    return throughFallbackTarget((target) => target.reportsWhileSilent);
  },
  get jsonMode(): boolean {
    return throughFallbackTarget((target) => target.jsonMode);
  },
  // The forwarder carries diagnostics, not a command's result. Forwarding these
  // would let a call from a path that has no logger of its own decide the shape
  // of someone else's `--json` document — `outputJson` in particular is
  // once-only, so a stray call would suppress the real one for good.
  captureData(_key: string, _value: unknown): void {},
  getJsonData(): Record<string, unknown> {
    return {};
  },
  outputJson(_success: boolean, _error?: JsonErrorInfo): void {},
  // `info`, `success` and `debug` all write to stdout, which is the one stream
  // an MCP server speaking JSON-RPC over stdio cannot have anything else
  // written to. Nothing calls any of them through the forwarder, and a path
  // with no logger of its own has no progress to narrate — only diagnostics,
  // which `warn` carries. `debug` is silent today merely because the `mcp`
  // subcommand registers no `--verbose`; that is a coincidence to be relied on,
  // not a design.
  info(_message: string, ..._args: unknown[]): void {},
  success(_message: string, ..._args: unknown[]): void {},
  warn(message: string, ...args: unknown[]): void {
    throughFallbackTarget((target) => {
      target.warn(message, ...args);
    });
  },
  // Errors go to the console rather than to an adopted logger, for the same
  // reason: `JsonLogger.error` writes the failure document.
  error(message: string | Error, code?: string, ...args: unknown[]): void {
    defaultFallbackTarget.error(message, code, ...args);
  },
  debug(_message: string, ..._args: unknown[]): void {},
};

/**
 * Run `operation` with `fallbackLogger` pointed at `logger`, so warnings raised
 * where no logger was threaded through end up in the same place as the rest of
 * that operation's diagnostics.
 *
 * The redirection lasts exactly as long as the operation and is invisible to
 * anything running beside it.
 */
export async function withFallbackLoggerTarget<T>({
  logger,
  operation,
}: {
  logger: Logger;
  operation: () => Promise<T>;
}): Promise<T> {
  // Forwarding the forwarder to itself would recurse forever; a caller that
  // passes it can only have meant "leave the fallback where it is". A wrapper
  // *around* `fallbackLogger` does not match here, so the forwarder guards
  // against coming back to itself as well (see `throughFallbackTarget`) —
  // this check only saves the scope that would otherwise be entered for a
  // target that changes nothing.
  if (logger === fallbackLogger) {
    return await operation();
  }
  // An operation with its own logger also gets its own once-per-run
  // bookkeeping: two MCP requests in flight at once must not spend each
  // other's tokens, or one result would go silent about a diagnostic that
  // applies to it too.
  return await fallbackTargetStorage.run(logger, () => withWarnOnceScope(operation));
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
    this.warnings.add({ message, args });
    super.warn(message, ...args);
  }

  getWarnings(): string[] {
    return this.warnings.toArray();
  }
}
