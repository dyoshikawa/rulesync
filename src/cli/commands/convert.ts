import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { convertFromTool } from "../../lib/convert.js";
import type { RulesyncFeatures } from "../../types/features.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { ALL_TOOL_TARGETS, type ToolTarget, ToolTargetSchema } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type ConvertOptions = Omit<
  ConfigResolverResolveParams,
  "delete" | "baseDirs" | "targets"
> & {
  from?: string;
  to?: string[];
  features?: RulesyncFeatures;
};

function parseToolTarget(value: string, label: string): ToolTarget {
  const result = ToolTargetSchema.safeParse(value);
  if (!result.success) {
    throw new CLIError(
      `Invalid ${label} tool '${value}'. Must be one of: ${ALL_TOOL_TARGETS.join(", ")}`,
      ErrorCodes.CONVERT_FAILED,
    );
  }
  return result.data;
}

export async function convertCommand(logger: Logger, options: ConvertOptions): Promise<void> {
  // `--from` and `--to` presence is enforced by commander's `requiredOption`
  // in `src/cli/index.ts`; here we only need to validate the tool names.
  const fromTool = parseToolTarget(options.from ?? "", "source");
  const toToolsRaw = (options.to ?? []).map((t) => parseToolTarget(t, "destination"));
  const toTools = Array.from(new Set(toToolsRaw));

  if (toTools.includes(fromTool)) {
    throw new CLIError(
      `Destination tools must not include the source tool '${fromTool}'. ` +
        `Converting a tool onto itself is likely a mistake and may cause lossy round-trips.`,
      ErrorCodes.CONVERT_FAILED,
    );
  }

  // Pass both source and destinations as `targets` so per-target feature maps
  // in `rulesync.jsonc` are honored for every tool involved. Default features
  // to `*` so every feature that both tools support is attempted.
  const config = await ConfigResolver.resolve({
    ...options,
    targets: [fromTool, ...toTools],
    features: options.features ?? ["*"],
  });

  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[DRY RUN] " : "";

  logger.debug(`Converting files from ${fromTool} to ${toTools.join(", ")}...`);

  const result = await convertFromTool({ config, fromTool, toTools, logger });

  const totalConverted = calculateTotalCount(result);

  if (totalConverted === 0) {
    const enabledFeatures = config.getFeatures(fromTool).join(", ");
    logger.warn(`No files converted for enabled features: ${enabledFeatures}`);
    return;
  }

  if (logger.jsonMode) {
    logger.captureData("from", fromTool);
    logger.captureData("to", toTools);
    logger.captureData("dryRun", isPreview);
    logger.captureData("features", {
      rules: { count: result.rulesCount },
      ignore: { count: result.ignoreCount },
      mcp: { count: result.mcpCount },
      commands: { count: result.commandsCount },
      subagents: { count: result.subagentsCount },
      skills: { count: result.skillsCount },
      hooks: { count: result.hooksCount },
      permissions: { count: result.permissionsCount },
    });
    logger.captureData("totalFiles", totalConverted);
  }

  const parts: string[] = [];
  if (result.rulesCount > 0) parts.push(`${result.rulesCount} rules`);
  if (result.ignoreCount > 0) parts.push(`${result.ignoreCount} ignore files`);
  if (result.mcpCount > 0) parts.push(`${result.mcpCount} MCP files`);
  if (result.commandsCount > 0) parts.push(`${result.commandsCount} commands`);
  if (result.subagentsCount > 0) parts.push(`${result.subagentsCount} subagents`);
  if (result.skillsCount > 0) parts.push(`${result.skillsCount} skills`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);
  if (result.permissionsCount > 0) parts.push(`${result.permissionsCount} permissions`);

  const verbPhrase = isPreview ? "Would convert" : "Converted";
  const summary = `${modePrefix}${verbPhrase} ${totalConverted} file(s) total from ${fromTool} to ${toTools.join(", ")} (${parts.join(" + ")})`;

  if (isPreview) {
    logger.info(summary);
  } else {
    logger.success(summary);
  }
}
