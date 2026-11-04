import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { importFromTool } from "../../lib/import.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";
import {
  buildFeatureCountSummaryParts,
  calculateTotalCount,
  featureCountsByFeature,
} from "../../utils/result.js";

// `inputRoot` and `inputRoots` are intentionally excluded: they only affect
// where source files are *read from* during `generate`, and `import` does not
// consume them. Keeping either in the option type would be misleading. This
// avoids surfacing the "Ignoring `global: true`" warning on direct callers;
// config-file root settings can still produce that actionable warning because
// `ConfigResolver.resolve` reads them independently of this type.
export type ImportOptions = Omit<
  ConfigResolverResolveParams,
  "delete" | "inputRoot" | "inputRoots"
>;

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

  const config = await ConfigResolver.resolve(options, { logger });

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
    logger.captureData("features", featureCountsByFeature(result));
    logger.captureData("totalFiles", totalImported);
  }

  const parts = buildFeatureCountSummaryParts(result);

  logger.success(`Imported ${totalImported} file(s) total (${parts.join(" + ")})`);
}
