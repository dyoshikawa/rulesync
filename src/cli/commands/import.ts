import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { importFromTool } from "../../lib/import.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(logger: Logger, options: ImportOptions): Promise<void> {
  if (!options.targets) {
    throw new CLIError("No tools found in --targets", ErrorCodes.IMPORT_FAILED);
  }

  // The CLI only provides the array form for --targets; the object form is
  // config-file-only. Defend with a runtime check so TS can narrow safely.
  if (!Array.isArray(options.targets)) {
    throw new CLIError(
      "--targets object form is not supported on the command line",
      ErrorCodes.IMPORT_FAILED,
    );
  }

  if (options.targets.length > 1) {
    throw new CLIError("Only one tool can be imported at a time", ErrorCodes.IMPORT_FAILED);
  }

  const config = await ConfigResolver.resolve(options);

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  logger.debug(`Importing files from ${tool}...`);

  const result = await importFromTool({ config, tool, logger });

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
      scheduledTasks: { count: result.scheduledTasksCount },
      hooks: { count: result.hooksCount },
      permissions: { count: result.permissionsCount },
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
  if (result.scheduledTasksCount > 0) parts.push(`${result.scheduledTasksCount} scheduled tasks`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);
  if (result.permissionsCount > 0) parts.push(`${result.permissionsCount} permissions`);

  logger.success(`Imported ${totalImported} file(s) total (${parts.join(" + ")})`);
}
