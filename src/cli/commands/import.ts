import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { importFromTool } from "../../lib/import.js";
import { logger } from "../../utils/logger.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(options: ImportOptions): Promise<void> {
  if (!options.targets) {
    logger.error("No tools found in --targets");
    process.exit(1);
  }

  if (options.targets.length > 1) {
    logger.error("Only one tool can be imported at a time");
    process.exit(1);
  }

  const config = await ConfigResolver.resolve(options);

  // Configure logger with verbose and silent mode
  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent(),
  });

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  logger.info(`Importing files from ${tool}...`);

  const result = await importFromTool({ config, tool });

  const totalImported =
    result.rulesCount +
    result.ignoreCount +
    result.mcpCount +
    result.commandsCount +
    result.subagentsCount +
    result.skillsCount +
    result.hooksCount;

  if (totalImported === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`No files imported for enabled features: ${enabledFeatures}`);
    return;
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
