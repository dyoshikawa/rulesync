import type { Config } from "../../config/config.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Warn when deprecated config patterns are detected.
 */
export const warnDeprecatedConfigPatterns = (params: { config: Config; logger: Logger }): void => {
  const { config, logger } = params;
  const hasPerTargetFeatures =
    "hasPerTargetFeatures" in config &&
    typeof config.hasPerTargetFeatures === "function" &&
    config.hasPerTargetFeatures();

  if (!hasPerTargetFeatures) {
    return;
  }

  logger.warn(
    "Deprecated: root.features object format is deprecated. For fine-grained per-target settings, use root.targets instead.",
  );
};
