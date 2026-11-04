import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { convertFromTool, type ConvertResult } from "../lib/convert.js";
import { type RulesyncFeatures } from "../types/features.js";
import { ALL_TOOL_TARGETS, type ToolTarget, ToolTargetSchema } from "../types/tool-targets.js";
import { WarningCollectingLogger } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { runMcpOperation } from "./command-runner.js";
import { type McpResultCounts, type McpWarnings, warningsField } from "./types.js";

/**
 * Schema for convert options, mirroring every CLI `convert` flag (`--from`,
 * `--to`, `--features`, `--global`, `--dry-run`).
 * Excluded parameters:
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 * The CLI has no output-root or config-path flag for convert, so neither does
 * this schema: conversion always reads and writes under process.cwd() (or the
 * home directory with `global`).
 */
export const convertOptionsSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  features: z.optional(z.array(z.string())),
  global: z.optional(z.boolean()),
  dryRun: z.optional(z.boolean()),
});

export type ConvertOptions = z.infer<typeof convertOptionsSchema>;

export type McpConvertResult = {
  success: boolean;
  result?: McpResultCounts;
  config?: {
    from: string;
    to: string[];
    features: string[];
    global: boolean;
    dryRun: boolean;
  };
  error?: string;
} & McpWarnings;

function parseToolTarget(value: string, label: string): ToolTarget {
  const result = ToolTargetSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid ${label} tool '${value}'. Must be one of: ${ALL_TOOL_TARGETS.join(", ")}`,
    );
  }
  return result.data;
}

/**
 * Execute the rulesync convert command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeConvert(options: ConvertOptions): Promise<McpConvertResult> {
  // Declared before the run so a run that warns and then fails still reports
  // what it warned about.
  const logger = new WarningCollectingLogger({ verbose: false, silent: true });

  return await runMcpOperation({
    logger,
    operation: async () => {
      // Validate from
      if (!options.from) {
        return {
          success: false,
          error: "from is required. Please specify a source tool to convert from.",
        };
      }

      // Validate to
      if (!options.to || options.to.length === 0) {
        return {
          success: false,
          error: "to is required and must not be empty. Please specify destination tools.",
        };
      }

      const fromTool = parseToolTarget(options.from, "source");
      const toToolsRaw = options.to.map((t) => parseToolTarget(t, "destination"));
      const toTools = Array.from(new Set(toToolsRaw));

      if (toTools.includes(fromTool)) {
        return {
          success: false,
          error:
            `Destination tools must not include the source tool '${fromTool}'. ` +
            `Converting a tool onto itself is likely a mistake and may cause lossy round-trips.`,
        };
      }

      // Resolve config with MCP parameters taking precedence
      // ConfigResolver handles: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
      // In MCP context, options act as CLI options (highest priority)
      // Pass both source and destinations as `targets` so per-target feature maps
      // in `rulesync.jsonc` are honored for every tool involved. Default features
      // to `*` so every feature that both tools support is attempted.
      const config = await ConfigResolver.resolve({
        targets: [fromTool, ...toTools],
        features: (options.features ?? ["*"]) as RulesyncFeatures,
        global: options.global,
        dryRun: options.dryRun,
        // Always use default outputRoots (process.cwd()) and configPath
        // verbose and silent are meaningless in MCP context
        verbose: false,
        silent: true,
      });

      const convertResult = await convertFromTool({ config, fromTool, toTools, logger });

      return buildSuccessResponse({ convertResult, config, fromTool, toTools, logger });
    },
  });
}

function buildSuccessResponse(params: {
  convertResult: ConvertResult;
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: WarningCollectingLogger;
}): McpConvertResult {
  const { convertResult, config, fromTool, toTools, logger } = params;

  const totalCount = calculateTotalCount(convertResult);

  return {
    success: true,
    result: {
      rulesCount: convertResult.rulesCount,
      ignoreCount: convertResult.ignoreCount,
      mcpCount: convertResult.mcpCount,
      commandsCount: convertResult.commandsCount,
      subagentsCount: convertResult.subagentsCount,
      skillsCount: convertResult.skillsCount,
      hooksCount: convertResult.hooksCount,
      permissionsCount: convertResult.permissionsCount,
      checksCount: convertResult.checksCount,
      totalCount,
    },
    config: {
      from: fromTool,
      to: toTools,
      features: config.getFeatures(),
      global: config.getGlobal(),
      dryRun: config.isPreviewMode(),
    },
    ...warningsField(logger),
  };
}

export const convertTools = {
  executeConvert: {
    execute: async (options: ConvertOptions): Promise<string> => {
      const result = await executeConvert(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
