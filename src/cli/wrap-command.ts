import { Command } from "commander";

import { CLIError } from "../types/json-output.js";
import { formatError } from "../utils/error.js";
import { ConsoleLogger, JsonLogger, Logger } from "../utils/logger.js";

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
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const command = args[args.length - 1] as Command;
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const options = args[args.length - 2] as Record<string, unknown>;
    const positionalArgs = args.slice(0, -2);
    const globalOpts = command.parent?.opts() ?? {};
    const logger = loggerFactory({ name, globalOpts, getVersion });
    logger.configure({
      verbose: Boolean(globalOpts.verbose) || Boolean(options.verbose),
      silent: Boolean(globalOpts.silent) || Boolean(options.silent),
    });

    try {
      await handler(logger, options, globalOpts, positionalArgs);
      logger.outputJson(true);
    } catch (error) {
      const code = error instanceof CLIError ? error.code : errorCode;
      const errorArg = error instanceof Error ? error : formatError(error);
      logger.error(errorArg, code);
      process.exit(error instanceof CLIError ? error.exitCode : 1);
    }
  };
}
