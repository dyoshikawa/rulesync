import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { checkRulesyncDirExists, generate, type GenerateResult } from "../lib/generate.js";
import { type RulesyncFeatures } from "../types/features.js";
import { type RulesyncTargets } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { ConsoleLogger } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { type McpResultCounts } from "./types.js";

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
  error?: string;
};

/**
 * Execute the rulesync generate command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeGenerate(options: GenerateOptions = {}): Promise<McpGenerateResult> {
  try {
    // Check if .rulesync directory exists
    const exists = await checkRulesyncDirExists({ inputRoot: process.cwd() });
    if (!exists) {
      return {
        success: false,
        error:
          ".rulesync directory does not exist. Please run 'rulesync init' first or create the directory manually.",
      };
    }

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

    const logger = new ConsoleLogger({ verbose: false, silent: true });
    const generateResult = await generate({ config, logger });

    return buildSuccessResponse({ generateResult, config });
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
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
}): McpGenerateResult {
  const { generateResult, config } = params;

  const totalCount = calculateTotalCount(generateResult);

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
  };
}

export const generateToolSchemas = {
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
