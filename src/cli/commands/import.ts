import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { importFromTool } from "../../lib/import.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(logger: Logger, options: ImportOptions): Promise<void> {
  if (!options.targets) {
    throw new CLIError("No tools found in --targets", ErrorCodes.IMPORT_FAILED);
  }

  if (options.targets.length > 1) {
    throw new CLIError("Only one tool can be imported at a time", ErrorCodes.IMPORT_FAILED);
  }

  const config = await ConfigResolver.resolve(options);

  // Configure logger with verbose and silent mode
  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent(),
  });

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  logger.debug(`Importing files from ${tool}...`);

  const result = await importFromTool({ config, tool });

  const totalImported = calculateTotalCount(result);

  if (totalImported === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`No files imported for enabled features: ${enabledFeatures}`);
    return;
  }

  // Capture JSON data if in JSON mode
  if (logger.jsonMode) {
    logger.captureData("tool", tool);
    logger.captureData("features", {
      rules: { count: result.rulesCount },
      ignore: { count: result.ignoreCount },
      mcp: { count: result.mcpCount },
      commands: { count: result.commandsCount },
      subagents: { count: result.subagentsCount },
      skills: { count: result.skillsCount },
      hooks: { count: result.hooksCount },
    });
    logger.captureData("totalFiles", totalImported);
  }

  const parts = [];
  if (result.rulesCount > 0) parts.push(`${result.rulesCount} rules`);
  if (result.ignoreCount > 0) parts.push(`${result.ignoreCount} ignore files`);
  if (result.mcpCount > 0) parts.push(`${result.mcpCount} MCP files`);
  if (result.commandsCount > 0) parts.push(`${result.commandsCount} commands`);
  if (result.subagentsCount > 0) parts.push(`${result.subagentsCount} subagents`);
  if (result.skillsCount > 0) parts.push(`${result.skillsCount} skills`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);

  logger.success(`Imported ${totalImported} file(s) total (${parts.join(" + ")})`);
}
