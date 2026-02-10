import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { checkRulesyncDirExists, generate, type GenerateResult } from "../lib/generate.js";
import { type RulesyncFeatures } from "../types/features.js";
import { type RulesyncTargets } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { calculateTotalCount } from "../utils/result.js";
import { type McpResultCounts } from "./types.js";

/**
 * Schema for generate options
 * Excluded parameters:
 * - baseDirs: Always use [process.cwd()] in MCP context
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
    const exists = await checkRulesyncDirExists({ baseDir: process.cwd() });
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
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      targets: options.targets as RulesyncTargets | undefined,
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      features: options.features as RulesyncFeatures | undefined,
      delete: options.delete,
      global: options.global,
      simulateCommands: options.simulateCommands,
      simulateSubagents: options.simulateSubagents,
      simulateSkills: options.simulateSkills,
      // Always use default baseDirs (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true,
    });

    const generateResult = await generate({ config });

    return buildSuccessResponse({ generateResult, config });
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

function buildSuccessResponse(params: {
  generateResult: GenerateResult;
  config: Config;
}): McpGenerateResult {
  const { generateResult, config } = params;

  const totalCount = calculateTotalCount(generateResult);

  return {
    success: true,
    result: {
      rulesCount: generateResult.rulesCount,
      ignoreCount: generateResult.ignoreCount,
      mcpCount: generateResult.mcpCount,
      commandsCount: generateResult.commandsCount,
      subagentsCount: generateResult.subagentsCount,
      skillsCount: generateResult.skillsCount,
      hooksCount: generateResult.hooksCount,
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
      "Execute the rulesync generate command to create output files for AI tools. Uses rulesync.jsonc settings by default, but options can override them.",
    parameters: generateToolSchemas.executeGenerate,
    execute: async (options: GenerateOptions = {}): Promise<string> => {
      const result = await executeGenerate(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
