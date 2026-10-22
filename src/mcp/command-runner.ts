import { resolve } from "node:path";
import { format } from "node:util";

import { GitHubClientError } from "../lib/github-client.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import { assertPathResolvesInsideRoot, checkPathTraversal } from "../utils/file.js";
import { WarningCollectingLogger, withFallbackLoggerTarget } from "../utils/logger.js";
import { truncateText } from "../utils/truncate.js";
import { type McpWarnings, warningsField } from "./types.js";

/**
 * How much of the commands' own success lines a result carries. They become
 * the `message` an agent reads as context, and some of them (the fetch
 * summary, say) list one line per file.
 */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_TOTAL_LENGTH = 4_000;

/**
 * A logger that lets the MCP server run a CLI command implementation as is and
 * hand its outcome back as data.
 *
 * It reports itself as being in JSON mode, which is the switch every command
 * already honors to capture its result through `captureData` instead of
 * narrating it — and to keep anything off stdout, which is the JSON-RPC
 * transport here. Console output stays suppressed (`silent`); warnings are
 * collected by the base class, and success lines are kept for the result's
 * `message`.
 */
export class McpCommandLogger extends WarningCollectingLogger {
  private readonly data: Record<string, unknown> = {};
  private readonly messages: string[] = [];
  private messagesLength = 0;

  constructor() {
    super({ verbose: false, silent: true });
  }

  override get jsonMode(): boolean {
    return true;
  }

  override captureData(key: string, value: unknown): void {
    this.data[key] = value;
  }

  override getJsonData(): Record<string, unknown> {
    return { ...this.data };
  }

  override success(message: string, ...args: unknown[]): void {
    const line = truncateText({
      text: stripControlCharacters(args.length === 0 ? message : format(message, ...args)),
      maxLength: MAX_MESSAGE_TOTAL_LENGTH,
      suffix: "…(truncated)",
    });
    if (
      this.messages.length >= MAX_MESSAGES ||
      this.messagesLength + line.length > MAX_MESSAGE_TOTAL_LENGTH
    ) {
      return;
    }
    this.messages.push(line);
    this.messagesLength += line.length;
    super.success(message, ...args);
  }

  getMessage(): string | undefined {
    return this.messages.length > 0 ? this.messages.join("\n") : undefined;
  }
}

export type McpCommandResult = {
  success: boolean;
  /** The command's own success summary, when it printed one. */
  message?: string;
  /** What the command captured for `--json`, plus any MCP-specific fields. */
  result?: Record<string, unknown>;
  error?: string;
} & McpWarnings;

/**
 * Run a CLI command implementation for an MCP caller and turn its outcome into
 * a structured result.
 *
 * `recover` lets a command whose CLI form reports through a failing exit code
 * (`doctor` finding problems, `install --outdated` finding stale sources) turn
 * that error back into a successful report instead of a failure.
 */
export async function runCommandForMcp({
  run,
  recover,
  extraResult,
}: {
  /** May return fields to add to `result`, for a command that returns data instead of capturing it. */
  run: (logger: McpCommandLogger) => Promise<Record<string, unknown> | void>;
  recover?: (params: { error: unknown; logger: McpCommandLogger }) => McpCommandResult | undefined;
  extraResult?: Record<string, unknown>;
}): Promise<McpCommandResult> {
  const logger = new McpCommandLogger();
  try {
    const returned = await withFallbackLoggerTarget({
      logger,
      operation: async () => await run(logger),
    });
    const message = logger.getMessage();
    return {
      success: true,
      ...(message !== undefined ? { message } : {}),
      result: { ...logger.getJsonData(), ...extraResult, ...returned },
      ...warningsField(logger),
    };
  } catch (error) {
    const recovered = recover?.({ error, logger });
    if (recovered !== undefined) {
      return { ...recovered, ...warningsField(logger) };
    }
    return {
      success: false,
      error: formatError(error),
      ...warningsField(logger),
    };
  }
}

/**
 * Refuse a path option that leads outside the project (`process.cwd()`),
 * textually (`..`, an absolute path elsewhere) or through a symbolic link.
 */
export async function assertPathInsideCwd({
  path,
  label,
}: {
  path: string;
  label: string;
}): Promise<void> {
  const cwd = process.cwd();
  try {
    checkPathTraversal({ relativePath: path, intendedRootDir: cwd });
    await assertPathResolvesInsideRoot({ rootPath: cwd, targetPath: resolve(cwd, path) });
  } catch (error) {
    throw new Error(`${label} must stay inside the project directory: ${formatError(error)}`, {
      cause: error,
    });
  }
}

/** Point an authentication failure at the environment variables the server reads. */
export function withGitHubAuthHint(error: unknown): unknown {
  if (!(error instanceof GitHubClientError)) {
    return error;
  }
  const hint =
    error.statusCode === 401 || error.statusCode === 403
      ? " Set GITHUB_TOKEN or GH_TOKEN in the MCP server's environment."
      : "";
  return new Error(`GitHub API Error: ${error.message}.${hint}`, { cause: error });
}

export function stringifyResult(result: McpCommandResult): string {
  return JSON.stringify(result, null, 2);
}
