import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { importFromTool, type ImportResult } from "../lib/import.js";
import { type RulesyncFeatures } from "../types/features.js";
import { type RulesyncTargets, type ToolTarget } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { calculateTotalCount } from "../utils/result.js";

/**
 * Schema for import options
 * Note: Import requires exactly one target tool
 * Excluded parameters:
 * - baseDirs: Always use [process.cwd()] in MCP context
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 * - configPath: Always use default path from process.cwd()
 * - delete: Not applicable to import
 * - simulateCommands/simulateSubagents/simulateSkills: Not applicable to import
 * - modularMcp: Not applicable to import
 * - global: Import uses tool's default locations
 */
export const importOptionsSchema = z.object({
  target: z.string(),
  features: z.optional(z.array(z.string())),
  global: z.optional(z.boolean()),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;

export type McpImportResult = {
  success: boolean;
  result?: {
    rulesCount: number;
    ignoreCount: number;
    mcpCount: number;
    commandsCount: number;
    subagentsCount: number;
    skillsCount: number;
    hooksCount: number;
    totalCount: number;
  };
  config?: {
    target: string;
    features: string[];
    global: boolean;
  };
  error?: string;
};

/**
 * Execute the rulesync import command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeImport(options: ImportOptions): Promise<McpImportResult> {
  try {
    // Validate target
    if (!options.target) {
      return {
        success: false,
        error: "target is required. Please specify a tool to import from.",
      };
    }

    // Resolve config with MCP parameters taking precedence
    // ConfigResolver handles: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
    // In MCP context, options act as CLI options (highest priority)
    const config = await ConfigResolver.resolve({
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      targets: [options.target] as RulesyncTargets,
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      features: options.features as RulesyncFeatures | undefined,
      global: options.global,
      // Always use default baseDirs (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true,
    });

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const tool = config.getTargets()[0] as ToolTarget;

    const importResult = await importFromTool({ config, tool });

    return buildSuccessResponse({ importResult, config, tool });
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

function buildSuccessResponse(params: {
  importResult: ImportResult;
  config: Config;
  tool: ToolTarget;
}): McpImportResult {
  const { importResult, config, tool } = params;

  const totalCount = calculateTotalCount(importResult);

  return {
    success: true,
    result: {
      rulesCount: importResult.rulesCount,
      ignoreCount: importResult.ignoreCount,
      mcpCount: importResult.mcpCount,
      commandsCount: importResult.commandsCount,
      subagentsCount: importResult.subagentsCount,
      skillsCount: importResult.skillsCount,
      hooksCount: importResult.hooksCount,
      totalCount,
    },
    config: {
      target: tool,
      features: config.getFeatures(),
      global: config.getGlobal(),
    },
  };
}

export const importToolSchemas = {
  executeImport: importOptionsSchema,
};

export const importTools = {
  executeImport: {
    name: "executeImport",
    description:
      "Execute the rulesync import command to import configuration files from an AI tool into .rulesync directory. Requires exactly one target tool to import from.",
    parameters: importToolSchemas.executeImport,
    execute: async (options: ImportOptions): Promise<string> => {
      const result = await executeImport(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
