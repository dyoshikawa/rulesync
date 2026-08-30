import { Command } from "commander";

import { CLIError } from "../types/json-output.js";
import { formatError } from "../utils/error.js";
import {
  ConsoleLogger,
  fallbackLogger,
  JsonLogger,
  Logger,
  warnOnConflictingFlags,
  withFallbackLoggerTarget,
} from "../utils/logger.js";

export function createLogger({
  name,
  globalOpts,
  getVersion,
}: {
  name: string;
  globalOpts: Record<string, unknown>;
  getVersion: () => string;
}): Logger {
  return globalOpts.json
    ? new JsonLogger({ command: name, version: getVersion() })
    : new ConsoleLogger();
}

export function wrapCommand({
  name,
  errorCode,
  handler,
  getVersion,
  loggerFactory = createLogger,
}: {
  name: string;
  errorCode: string;
  handler: (
    logger: Logger,
    options: unknown,
    globalOpts: Record<string, unknown>,
    positionalArgs: unknown[],
  ) => Promise<void>;
  getVersion: () => string;
  loggerFactory?: (params: {
    name: string;
    globalOpts: Record<string, unknown>;
    getVersion: () => string;
  }) => Logger;
}) {
  return async (...args: unknown[]) => {
    // Commander passes variable args based on command signature:
    // - No positional: (options, command)
    // - With positional: (arg1, arg2, ..., options, command)
    // The last two are always (options, command)
    const command = args[args.length - 1] as Command;
    const options = args[args.length - 2] as Record<string, unknown>;
    const positionalArgs = args.slice(0, -2);
    const globalOpts = command.parent?.opts() ?? {};
    const logger = loggerFactory({ name, globalOpts, getVersion });
    // Configure from CLI flags first; commands that resolve a config file
    // re-configure via `ConfigResolver.resolve` so config-file
    // `verbose`/`silent` also apply (CLI flags still win there).
    const cliLoggerOptions = {
      verbose: Boolean(globalOpts.verbose) || Boolean(options.verbose),
      silent: Boolean(globalOpts.silent) || Boolean(options.silent),
    };
    warnOnConflictingFlags({ ...cliLoggerOptions, jsonMode: logger.jsonMode });
    logger.configure(cliLoggerOptions);
    // Also the default fallback target, which is where warnings go once the
    // adopted scope below closes — `rulesync mcp` returns from its handler
    // while the server it started keeps running, so `--silent` has to reach it.
    fallbackLogger.configure(cliLoggerOptions);

    try {
      // Adopt the shared fallback for the duration of the command, so a warning
      // raised on a path with no logger threaded through lands wherever this
      // command's other diagnostics land — inside the `--json` document rather
      // than on a stderr that a `--json` consumer never reads.
      await withFallbackLoggerTarget({
        logger,
        operation: async () => {
          await handler(logger, options, globalOpts, positionalArgs);
          logger.outputJson(true);
        },
      });
    } catch (error) {
      const code = error instanceof CLIError ? error.code : errorCode;
      const errorArg = error instanceof Error ? error : formatError(error);
      logger.error(errorArg, code);
      process.exit(error instanceof CLIError ? error.exitCode : 1);
    }
  };
}
