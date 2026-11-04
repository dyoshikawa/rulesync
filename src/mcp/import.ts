import { z } from "zod/mini";

import { ConfigResolver } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { importFromTool, type ImportResult } from "../lib/import.js";
import { type RulesyncFeatures } from "../types/features.js";
import { type RulesyncTargets, type ToolTarget } from "../types/tool-targets.js";
import { WarningCollectingLogger } from "../utils/logger.js";
import { calculateTotalCount } from "../utils/result.js";
import { runMcpOperation } from "./command-runner.js";
import { assertOptionalPathOptionWithinCwd } from "./path-options.js";
import { type McpResultCounts, type McpWarnings, warningsField } from "./types.js";

/**
 * Schema for import options, mirroring the CLI's `import` flags.
 *
 * Import reads from exactly one tool. `targets` mirrors the CLI's `--targets`
 * (a list that must hold exactly one tool); `target` is the older single-value
 * form and keeps working. Pass one of them, not both.
 *
 * Excluded parameters:
 * - verbose: Meaningless in MCP (no console output)
 * - silent: Meaningless in MCP
 */
export const importOptionsSchema = z.object({
  target: z.optional(z.string()),
  targets: z.optional(z.array(z.string())),
  features: z.optional(z.array(z.string())),
  global: z.optional(z.boolean()),
  /**
   * Root directory containing the tool configuration to import, inside the
   * project (CLI: `--output-root`). Defaults to the project directory.
   */
  outputRoot: z.optional(z.string()),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;

export type McpImportResult = {
  success: boolean;
  result?: McpResultCounts;
  config?: {
    target: string;
    features: string[];
    global: boolean;
    outputRoots: string[];
  };
  error?: string;
} & McpWarnings;

/**
 * Execute the rulesync import command via MCP
 * Configuration priority: MCP Parameters > rulesync.local.jsonc > rulesync.jsonc > Default values
 */
export async function executeImport(options: ImportOptions): Promise<McpImportResult> {
  // Declared before the run so a run that warns and then fails still reports
  // what it warned about.
  const logger = new WarningCollectingLogger({ verbose: false, silent: true });

  return await runMcpOperation({
    logger,
    operation: async () => {
      const targetResult = resolveImportTarget(options);
      if ("error" in targetResult) {
        return { success: false, error: targetResult.error };
      }

      await assertOptionalPathOptionWithinCwd({ path: options.outputRoot, label: "outputRoot" });

      // Resolve config with MCP parameters taking precedence
      // ConfigResolver handles: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
      // In MCP context, options act as CLI options (highest priority)
      const config = await ConfigResolver.resolve({
        targets: [targetResult.target] as RulesyncTargets,
        features: options.features as RulesyncFeatures | undefined,
        global: options.global,
        outputRoots: options.outputRoot !== undefined ? [options.outputRoot] : undefined,
        // verbose and silent are meaningless in MCP context
        verbose: false,
        silent: true,
      });

      const tool = config.getTargets()[0] as ToolTarget;

      const importResult = await importFromTool({ config, tool, logger });

      return buildSuccessResponse({ importResult, config, tool, logger });
    },
  });
}

/**
 * Picks the single tool to import from out of `target` (legacy) or `targets`
 * (CLI parity), applying the CLI's rule that only one tool is imported at a time.
 */
function resolveImportTarget(options: ImportOptions): { target: string } | { error: string } {
  if (options.target !== undefined && options.targets !== undefined) {
    return { error: "Specify either target or targets, not both." };
  }

  if (options.targets !== undefined) {
    if (options.targets.length > 1) {
      return { error: "Only one tool can be imported at a time; targets must hold exactly one." };
    }
    const [target] = options.targets;
    if (target) {
      return { target };
    }
  } else if (options.target) {
    return { target: options.target };
  }

  return { error: "target is required. Please specify a tool to import from." };
}

function buildSuccessResponse(params: {
  importResult: ImportResult;
  config: Config;
  tool: ToolTarget;
  logger: WarningCollectingLogger;
}): McpImportResult {
  const { importResult, config, tool, logger } = params;

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
      permissionsCount: importResult.permissionsCount,
      checksCount: importResult.checksCount,
      totalCount,
    },
    config: {
      target: tool,
      features: config.getFeatures(),
      global: config.getGlobal(),
      outputRoots: config.getOutputRoots(),
    },
    ...warningsField(logger),
  };
}

export const importTools = {
  executeImport: {
    execute: async (options: ImportOptions): Promise<string> => {
      const result = await executeImport(options);
      return JSON.stringify(result, null, 2);
    },
  },
};
