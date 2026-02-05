import {
  checkForUpdate,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
  GitHubClientError,
  performBinaryUpdate,
} from "../../lib/update.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

/**
 * Update command options
 */
export type UpdateCommandOptions = {
  check?: boolean;
  force?: boolean;
  verbose?: boolean;
};

/**
 * Update command handler
 */
export async function updateCommand(
  currentVersion: string,
  options: UpdateCommandOptions,
): Promise<void> {
  const { check = false, force = false, verbose = false } = options;

  logger.configure({ verbose, silent: false });

  const environment = detectExecutionEnvironment();
  logger.debug(`Detected environment: ${environment}`);

  if (environment === "npm") {
    logger.info(getNpmUpgradeInstructions());
    return;
  }

  if (environment === "homebrew") {
    logger.info(getHomebrewUpgradeInstructions());
    return;
  }

  // Single-binary mode
  try {
    if (check) {
      // Check-only mode
      logger.info("Checking for updates...");
      const updateCheck = await checkForUpdate(currentVersion);

      if (updateCheck.hasUpdate) {
        logger.success(
          `Update available: ${updateCheck.currentVersion} -> ${updateCheck.latestVersion}`,
        );
      } else {
        logger.info(`Already at the latest version (${updateCheck.currentVersion})`);
      }
      return;
    }

    // Perform update
    logger.info("Checking for updates...");
    const result = await performBinaryUpdate(currentVersion, { force, verbose });

    if (result.success) {
      logger.success(result.message);
    } else {
      logger.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof GitHubClientError) {
      logger.error(`GitHub API Error: ${error.message}`);
      if (error.statusCode === 401 || error.statusCode === 403) {
        logger.info(
          "Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable for better rate limits.",
        );
      }
    } else if (error instanceof Error && error.message.includes("Permission denied")) {
      logger.error(error.message);
      logger.info("Tip: Run with elevated privileges (e.g., sudo rulesync update)");
    } else {
      logger.error(formatError(error));
    }
    process.exit(1);
  }
}
