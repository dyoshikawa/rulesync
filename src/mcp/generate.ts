import { resolve } from "node:path";

import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { buildGeneratePlanFromResult, type GeneratePlan } from "../lib/generate-plan.js";
import {
  formatSourceLoadFailure,
  generate,
  inspectInputRoots,
  type GenerateResult,
} from "../lib/generate.js";
import { type RulesyncFeatures } from "../types/features.js";
import { ErrorCodes } from "../types/json-output.js";
import { type RulesyncTargets, type ToolTarget } from "../types/tool-targets.js";
import { stripControlCharactersKeepingLineFeeds } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import { WarningCollectingLogger, withFallbackLoggerTarget } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { truncateText } from "../utils/truncate.js";
import { assertPathOptionsWithinCwd, assertPathOptionWithinCwd } from "./path-options.js";
import { type McpResultCounts, type McpWarnings, warningsField } from "./types.js";

/**
 * Keeps the reasons a `.rulesync/` source would not load, so the failure this
 * tool reports can name them.
 *
 * Over stdio MCP the server's own stderr does not reach the calling agent, so
 * a failure that is only logged is a failure the agent cannot act on. Holding
 * the messages lets the tool answer with the specific reason a source could not
 * be read — which file, and what was wrong with it — rather than just the fact
 * that something was.
 *
 * Only the tagged lines are kept. Collecting every `error()` would fold in
 * whatever else the run happened to log — one line per target for an unrelated
 * tool config, say — and the agent reading the response would have to guess
 * which of them explains the failure. Warnings are the base class's job; this
 * one adds the error channel to it.
 */
class ErrorCollectingLogger extends WarningCollectingLogger {
  private readonly errors: string[] = [];
  private errorsLength = 0;
  private omittedErrors = 0;

  override error(message: string | Error, code?: string, ...args: unknown[]): void {
    if (code === ErrorCodes.SOURCE_LOAD_FAILED) {
      this.collect(message instanceof Error ? message.message : message);
    }
    super.error(message, code, ...args);
  }

  private collect(message: string): void {
    // Stripped here as well as in `formatError`, which is where most of these
    // messages have already been through: a raw `logger.error` call tagged with
    // the same code has not, and these lines are read by an agent rather than
    // printed.
    const kept = truncateText({
      text: stripControlCharactersKeepingLineFeeds(message),
      maxLength: MAX_COLLECTED_ERROR_LENGTH,
      suffix: "…(truncated)",
    });
    if (
      this.errors.length >= MAX_COLLECTED_ERRORS ||
      this.errorsLength + kept.length > MAX_COLLECTED_ERRORS_TOTAL_LENGTH
    ) {
      this.omittedErrors++;
      return;
    }
    this.errors.push(kept);
    this.errorsLength += kept.length;
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
 * The binding limit, as it is for the collected warnings: the joined lines
 * become one `Error` message, and `formatError` bounds that in turn. Keeping
 * the sum under its bound is what makes the trailing "and N more" line survive
 * the join rather than being the part that gets truncated away.
 */
const MAX_COLLECTED_ERRORS_TOTAL_LENGTH = 4_000;

/**
 * Schema for generate options, mirroring the CLI's `generate` flags.
 *
 * Path options (`outputRoots`, `inputRoots`, `inputRoot`, `configPath`) must
 * stay inside the project (`process.cwd()`); see `assertPathOptionWithinCwd`.
 *
 * Excluded parameters:
 * - watch: Long-running; an MCP call must return a single result
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 */
export const generateOptionsSchema = z.object({
  targets: z.optional(z.array(z.string())),
  features: z.optional(z.array(z.string())),
  delete: z.optional(z.boolean()),
  global: z.optional(z.boolean()),
  simulateCommands: z.optional(z.boolean()),
  simulateSubagents: z.optional(z.boolean()),
  simulateSkills: z.optional(z.boolean()),
  /** Preview the run without writing or deleting anything (CLI: `--dry-run`). */
  dryRun: z.optional(z.boolean()),
  /**
   * Report whether the outputs are up to date without writing anything
   * (CLI: `--check`). The result's `upToDate` carries the answer; the call
   * itself still succeeds either way.
   */
  check: z.optional(z.boolean()),
  /**
   * Tools the project no longer uses; deletes the outputs rulesync manages for
   * them (CLI: `--retire-targets`). Requires `features` and cannot be combined
   * with `targets`.
   */
  retireTargets: z.optional(z.array(z.string())),
  /** Output root directories, inside the project (CLI: `--output-roots`). */
  outputRoots: z.optional(z.array(z.string())),
  /** Ordered rulesync source trees, inside the project (CLI: `--input-roots`). */
  inputRoots: z.optional(z.array(z.string())),
  /**
   * Deprecated: parent directory of a `.rulesync/` source tree (CLI:
   * `--input-root`). Prefer `inputRoots`. Cannot be combined with `inputRoots`.
   */
  inputRoot: z.optional(z.string()),
  /** Path to the configuration file, inside the project (CLI: `--config`). */
  configPath: z.optional(z.string()),
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
    dryRun: boolean;
    check: boolean;
    retireTargets: string[];
    outputRoots: string[];
    inputRoots: string[];
  };
  /**
   * Present only for a `check` or `dryRun` run: whether the outputs already
   * match the sources, i.e. whether a real run would change nothing. Deletions
   * count as changes, so this can be `false` while `totalCount` is 0.
   */
  upToDate?: boolean;
  /**
   * Present only for a `check` or `dryRun` run: the writes and deletions a real
   * run would perform, in the same shape as `rulesync generate --json`'s plan.
   */
  plan?: GeneratePlan;
  error?: string;
} & McpWarnings;

/**
 * Execute the rulesync generate command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeGenerate(options: GenerateOptions = {}): Promise<McpGenerateResult> {
  // Declared outside the `try` because the source-load failure below is
  // reported by throwing, and a run that warns and then fails is exactly when
  // the caller needs to hear what it warned about.
  const logger = new ErrorCollectingLogger({ verbose: false, silent: true });

  try {
    // The whole run adopts the shared fallback, config resolution included:
    // warnings raised on paths that never received a logger would otherwise go
    // to a stderr the calling agent cannot read. Resolution is inside rather
    // than before it because that is where a config file's own contradictions
    // are reported — `global: true` quietly downgraded to project scope
    // changes where the run writes.
    return await withFallbackLoggerTarget({
      logger,
      operation: async () => {
        // Resolve config with MCP parameters taking precedence
        // ConfigResolver handles: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
        // In MCP context, options act as CLI options (highest priority)
        await assertGeneratePathOptionsWithinCwd(options);

        // The resolver enforces the same rules the CLI does: `inputRoot` and
        // `inputRoots` are mutually exclusive, and `retireTargets` requires an
        // explicit `features` list and cannot be combined with `targets`.
        const config = await ConfigResolver.resolve({
          targets: options.targets as RulesyncTargets | undefined,
          features: options.features as RulesyncFeatures | undefined,
          delete: options.delete,
          global: options.global,
          simulateCommands: options.simulateCommands,
          simulateSubagents: options.simulateSubagents,
          simulateSkills: options.simulateSkills,
          dryRun: options.dryRun,
          check: options.check,
          retireTargets: options.retireTargets as ToolTarget[] | undefined,
          outputRoots: options.outputRoots,
          inputRoots: options.inputRoots,
          inputRoot: options.inputRoot,
          configPath: options.configPath,
          // verbose and silent are meaningless in MCP context
          verbose: false,
          silent: true,
        });

        await assertResolvedRootsWithinCwd({ options, config });

        const inputRoots = config.getInputRoots();
        const inputRootInspection = await inspectInputRoots(inputRoots);

        if (inputRootInspection.message !== undefined) {
          throw new Error(inputRootInspection.message);
        }

        const generateResult = await generate({ config, logger });

        // A source that could not be read writes nothing, and every count in
        // the result reads zero for it — the same shape as a run that had
        // nothing to do. Reporting that as success would tell the agent its
        // edit was applied.
        const sourceLoadFailureMessage = formatSourceLoadFailure(generateResult);
        if (sourceLoadFailureMessage !== undefined) {
          throw new Error([sourceLoadFailureMessage, ...logger.getErrors()].join("\n"));
        }

        return buildSuccessResponse({ generateResult, config, logger });
      },
    });
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      ...warningsField(logger),
    };
  }
}

/**
 * Path options an MCP caller passes must stay inside the project. The resolver
 * only rejects traversal patterns and accepts any normalized absolute path,
 * which is right for a person at a shell but would let an agent write into
 * (or read sources from) any directory on the machine.
 */
async function assertGeneratePathOptionsWithinCwd(options: GenerateOptions): Promise<void> {
  await assertPathOptionsWithinCwd({ paths: options.outputRoots, label: "outputRoots" });
  await assertPathOptionsWithinCwd({ paths: options.inputRoots, label: "inputRoots" });
  if (options.inputRoot !== undefined) {
    await assertPathOptionWithinCwd({ path: options.inputRoot, label: "inputRoot" });
  }
  if (options.configPath !== undefined) {
    // The resolver reads `configPath` relative to `inputRoot` when one is
    // given, so judge the path it will actually read.
    await assertPathOptionWithinCwd({
      path:
        options.inputRoot !== undefined
          ? resolve(options.inputRoot, options.configPath)
          : options.configPath,
      label: "configPath",
    });
  }
}

/**
 * When the caller chose which configuration file is loaded (`configPath`, or
 * `inputRoot`, which anchors the configuration lookup), the roots that file
 * declares are effectively caller-supplied too: a file the agent points at —
 * one inside `node_modules`, say — could otherwise carry absolute
 * `outputRoots`/`inputRoots` anywhere on the machine. Confine the resolved
 * roots the same way as the arguments. The project's own default
 * configuration is the user's, and keeps working as it does on the CLI.
 * Under `global`, the resolver replaces the output roots with the home
 * directory, which is not the caller's choice and is left alone.
 */
async function assertResolvedRootsWithinCwd({
  options,
  config,
}: {
  options: GenerateOptions;
  config: Config;
}): Promise<void> {
  if (options.configPath === undefined && options.inputRoot === undefined) {
    return;
  }
  await assertPathOptionWithinCwd({
    path: config.getConfigFilePath(),
    label: "configPath (as resolved)",
  });
  if (!config.getGlobal()) {
    await assertPathOptionsWithinCwd({
      paths: config.getOutputRoots(),
      label: "outputRoots (as resolved from the configuration file)",
    });
  }
  await assertPathOptionsWithinCwd({
    paths: config.getInputRoots(),
    label: "inputRoots (as resolved from the configuration file)",
  });
}

/**
 * Build a human-readable summary of a successful generation.
 *
 * `generate` is idempotent: `totalCount` reflects only files whose content
 * actually changed on disk, so a count of 0 is a normal "nothing to update"
 * outcome — not a failure. The message makes that explicit so MCP callers do
 * not misread a zero count as a broken generate.
 */
function buildGenerateMessage(params: {
  totalCount: number;
  hasDiff: boolean;
  config: Config;
}): string {
  const { totalCount, hasDiff, config } = params;
  const targets = config.getTargets().join(", ");
  const features = config.getFeatures().join(", ");

  if (config.getCheck()) {
    return hasDiff
      ? `Files are not up to date for targets [${targets}] and features [${features}]. ` +
          `Run generate without 'check' to update them; 'plan' lists the pending changes.`
      : `All files are up to date for targets [${targets}] and features [${features}].`;
  }

  if (config.getDryRun()) {
    return hasDiff
      ? `[DRY RUN] Would write ${totalCount} file(s) for targets [${targets}] and features ` +
          `[${features}]. Nothing was written; 'plan' lists the pending changes.`
      : `[DRY RUN] No changes needed for targets [${targets}] and features [${features}]; ` +
          `the outputs are already up to date.`;
  }

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
  logger: ErrorCollectingLogger;
}): McpGenerateResult {
  const { generateResult, config, logger } = params;

  const totalCount = calculateTotalCount(generateResult);
  const isPreview = config.isPreviewMode();

  return {
    success: true,
    message: buildGenerateMessage({ totalCount, hasDiff: generateResult.hasDiff, config }),
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
      pluginManifestCount: generateResult.pluginManifestCount,
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
      dryRun: config.getDryRun(),
      check: config.getCheck(),
      retireTargets: config.getRetireTargets(),
      outputRoots: config.getOutputRoots(),
      inputRoots: [...config.getInputRoots()],
    },
    ...(isPreview
      ? {
          upToDate: !generateResult.hasDiff,
          plan: buildGeneratePlanFromResult(generateResult),
        }
      : {}),
    ...warningsField(logger),
  };
}

const generateToolSchemas = {
  executeGenerate: generateOptionsSchema,
};

export const generateTools = {
  executeGenerate: {
    name: "executeGenerate",
    description:
      "Execute the rulesync generate command to create output files for AI tools. Uses rulesync.jsonc settings by default, but options can override them. Accepts the CLI's options (dryRun, check, retireTargets, outputRoots, inputRoots, inputRoot, configPath, ...) except watch/verbose/silent; path options must stay inside the project directory. With check or dryRun nothing is written, and 'upToDate' plus 'plan' report what a real run would change. Idempotent: only files whose content changed are written, so a totalCount of 0 means the outputs are already up to date (a successful no-op), not a failure. See the 'message' field for a human-readable summary. A 'warnings' array of strings is present, on success and on failure alike, when the run had something worth acting on to report.",
    parameters: generateToolSchemas.executeGenerate,
    execute: async (options: GenerateOptions = {}): Promise<string> => {
      const result = await executeGenerate(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
