import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import {
  formatSourceLoadFailure,
  generate,
  inspectInputRoots,
  type GenerateResult,
} from "../lib/generate.js";
import { type RulesyncFeatures } from "../types/features.js";
import { ErrorCodes } from "../types/json-output.js";
import { type RulesyncTargets } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { WarningCollectingLogger, withFallbackLoggerTarget } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { truncateText } from "../utils/truncate.js";
import { type McpResultCounts } from "./types.js";

/**
 * A logger that keeps what it reports as errors.
 *
 * Over stdio MCP the server's own stderr does not reach the calling agent, so
 * a failure that is only logged is a failure the agent cannot act on. Holding
 * the messages lets the tool answer with the specific reason a source could not
 * be read — which file, and what was wrong with it — rather than just the fact
 * that something was.
 */
/**
 * Keeps the reasons a `.rulesync/` source would not load, so the failure this
 * tool reports can name them.
 *
 * Only the tagged lines are kept. Collecting every `error()` would fold in
 * whatever else the run happened to log — one line per target for an unrelated
 * tool config, say — and the agent reading the response would have to guess
 * which of them explains the failure.
 */
class CollectingLogger extends WarningCollectingLogger {
  private readonly errors: string[] = [];
  private omittedErrors = 0;

  override error(message: string | Error, code?: string, ...args: unknown[]): void {
    if (code === ErrorCodes.SOURCE_LOAD_FAILED) {
      this.collect(message instanceof Error ? message.message : message);
    }
    super.error(message, code, ...args);
  }

  private collect(message: string): void {
    if (this.errors.length >= MAX_COLLECTED_ERRORS) {
      this.omittedErrors++;
      return;
    }
    this.errors.push(
      truncateText({
        text: message,
        maxLength: MAX_COLLECTED_ERROR_LENGTH,
        suffix: "…(truncated)",
      }),
    );
  }

  getErrors(): readonly string[] {
    if (this.omittedErrors === 0) {
      return this.errors;
    }
    return [...this.errors, `… and ${this.omittedErrors} more source(s) that could not be read`];
  }
}

/**
 * How many unreadable sources the failure names, and how much of each reason.
 *
 * These lines become the `error` of an MCP result the calling agent reads as
 * context, and each one quotes a file rulesync did not write. A `.rulesync/`
 * tree with a thousand broken sources is a plausible accident; a failure
 * message sized to it is not something an agent can act on, and the first few
 * reasons are what says which file to open.
 */
const MAX_COLLECTED_ERRORS = 20;
const MAX_COLLECTED_ERROR_LENGTH = 1_000;

/**
 * Schema for generate options
 * Excluded parameters:
 * - outputRoots: Always use [process.cwd()] in MCP context
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 * - configPath: Always use default path from process.cwd()
 */
export const generateOptionsSchema = z.object({
  targets: z.optional(z.array(z.string())),
  features: z.optional(z.array(z.string())),
  delete: z.optional(z.boolean()),
  global: z.optional(z.boolean()),
  simulateCommands: z.optional(z.boolean()),
  simulateSubagents: z.optional(z.boolean()),
  simulateSkills: z.optional(z.boolean()),
});

export type GenerateOptions = z.infer<typeof generateOptionsSchema>;

export type McpGenerateResult = {
  success: boolean;
  /**
   * Human-readable summary of the outcome. Clarifies that a `totalCount` of 0
   * means "already up to date" (success with nothing to write) rather than a
   * failure, since `generate` is idempotent and only writes changed files.
   */
  message?: string;
  result?: McpResultCounts;
  config?: {
    targets: string[];
    features: string[];
    global: boolean;
    delete: boolean;
    simulateCommands: boolean;
    simulateSubagents: boolean;
    simulateSkills: boolean;
  };
  /**
   * Diagnostics raised during the run. The MCP server writes nothing to a
   * console the caller can see, so anything worth acting on has to travel in
   * the result itself. Present on failures too, since a run that warned and
   * then failed is exactly when the warnings matter. Omitted when there is
   * nothing to report.
   */
  warnings?: string[];
  error?: string;
};

/**
 * Execute the rulesync generate command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeGenerate(options: GenerateOptions = {}): Promise<McpGenerateResult> {
  // Declared outside the `try` because the source-load failure below is
  // reported by throwing, and a run that warns and then fails is exactly when
  // the caller needs to hear what it warned about.
  const logger = new CollectingLogger({ verbose: false, silent: true });

  try {
    // Resolve config with MCP parameters taking precedence
    // ConfigResolver handles: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
    // In MCP context, options act as CLI options (highest priority)
    const config = await ConfigResolver.resolve({
      targets: options.targets as RulesyncTargets | undefined,
      features: options.features as RulesyncFeatures | undefined,
      delete: options.delete,
      global: options.global,
      simulateCommands: options.simulateCommands,
      simulateSubagents: options.simulateSubagents,
      simulateSkills: options.simulateSkills,
      // Always use default outputRoots (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true,
    });

    const inputRoots = config.getInputRoots();
    const inputRootInspection = await inspectInputRoots(inputRoots);

    if (inputRootInspection.message !== undefined) {
      throw new Error(inputRootInspection.message);
    }

    // Adopt the shared fallback too: warnings raised on paths that never
    // received a logger would otherwise go to a stderr the calling agent
    // cannot read.
    const generateResult = await withFallbackLoggerTarget({
      logger,
      operation: () => generate({ config, logger }),
    });

    // A source that could not be read writes nothing, and every count in the
    // result reads zero for it — the same shape as a run that had nothing to
    // do. Reporting that as success would tell the agent its edit was applied.
    const sourceLoadFailureMessage = formatSourceLoadFailure(generateResult);
    if (sourceLoadFailureMessage !== undefined) {
      throw new Error([sourceLoadFailureMessage, ...logger.getErrors()].join("\n"));
    }

    return buildSuccessResponse({ generateResult, config, logger });
  } catch (error) {
    const warnings = logger.getWarnings();
    return {
      success: false,
      error: formatError(error),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

/**
 * Build a human-readable summary of a successful generation.
 *
 * `generate` is idempotent: `totalCount` reflects only files whose content
 * actually changed on disk, so a count of 0 is a normal "nothing to update"
 * outcome — not a failure. The message makes that explicit so MCP callers do
 * not misread a zero count as a broken generate.
 */
function buildGenerateMessage(params: { totalCount: number; config: Config }): string {
  const { totalCount, config } = params;
  const targets = config.getTargets().join(", ");
  const features = config.getFeatures().join(", ");

  if (totalCount > 0) {
    return `Generated ${totalCount} file(s) for targets [${targets}] and features [${features}].`;
  }

  return (
    `No files needed updating for targets [${targets}] and features [${features}]. ` +
    `'generate' only writes files whose content changed, so a totalCount of 0 means the ` +
    `outputs are already up to date — this is a successful no-op, not a failure.`
  );
}

function buildSuccessResponse(params: {
  generateResult: GenerateResult;
  config: Config;
  logger: CollectingLogger;
}): McpGenerateResult {
  const { generateResult, config, logger } = params;

  const totalCount = calculateTotalCount(generateResult);
  const warnings = logger.getWarnings();

  return {
    success: true,
    message: buildGenerateMessage({ totalCount, config }),
    result: {
      rulesCount: generateResult.rulesCount,
      ignoreCount: generateResult.ignoreCount,
      mcpCount: generateResult.mcpCount,
      commandsCount: generateResult.commandsCount,
      subagentsCount: generateResult.subagentsCount,
      skillsCount: generateResult.skillsCount,
      hooksCount: generateResult.hooksCount,
      permissionsCount: generateResult.permissionsCount,
      checksCount: generateResult.checksCount,
      activationCount: generateResult.activationCount,
      totalCount,
    },
    config: {
      targets: config.getTargets(),
      features: config.getFeatures(),
      global: config.getGlobal(),
      delete: config.getDelete(),
      simulateCommands: config.getSimulateCommands(),
      simulateSubagents: config.getSimulateSubagents(),
      simulateSkills: config.getSimulateSkills(),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

const generateToolSchemas = {
  executeGenerate: generateOptionsSchema,
};

export const generateTools = {
  executeGenerate: {
    name: "executeGenerate",
    description:
      "Execute the rulesync generate command to create output files for AI tools. Uses rulesync.jsonc settings by default, but options can override them. Idempotent: only files whose content changed are written, so a totalCount of 0 means the outputs are already up to date (a successful no-op), not a failure. See the 'message' field for a human-readable summary.",
    parameters: generateToolSchemas.executeGenerate,
    execute: async (options: GenerateOptions = {}): Promise<string> => {
      const result = await executeGenerate(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
