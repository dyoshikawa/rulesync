import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { convertFromTool, type ConvertResult } from "../lib/convert.js";
import { type RulesyncFeatures } from "../types/features.js";
import { ALL_TOOL_TARGETS, type ToolTarget, ToolTargetSchema } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { ConsoleLogger } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { type McpResultCounts } from "./types.js";

/**
 * Schema for convert options
 * Excluded parameters:
 * - baseDirs: Always use [process.cwd()] in MCP context
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 * - configPath: Always use default path from process.cwd()
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
};

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
  try {
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
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      features: (options.features ?? ["*"]) as RulesyncFeatures,
      global: options.global,
      dryRun: options.dryRun,
      // Always use default baseDirs (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true,
    });

    const logger = new ConsoleLogger({ verbose: false, silent: true });
    const convertResult = await convertFromTool({ config, fromTool, toTools, logger });

    return buildSuccessResponse({ convertResult, config, fromTool, toTools });
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    };
  }
}

function buildSuccessResponse(params: {
  convertResult: ConvertResult;
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
}): McpConvertResult {
  const { convertResult, config, fromTool, toTools } = params;

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
      totalCount,
    },
    config: {
      from: fromTool,
      to: toTools,
      features: config.getFeatures(),
      global: config.getGlobal(),
      dryRun: config.isPreviewMode(),
    },
  };
}

export const convertToolSchemas = {
  executeConvert: convertOptionsSchema,
};

export const convertTools = {
  executeConvert: {
    name: "executeConvert",
    description:
      "Execute the rulesync convert command to convert configuration files between AI tools without writing intermediate .rulesync/ files. Requires a source tool (from) and one or more destination tools (to).",
    parameters: convertToolSchemas.executeConvert,
    execute: async (options: ConvertOptions): Promise<string> => {
      const result = await executeConvert(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
