import { GitHubClientError } from "../../lib/github-client.js";
import {
  UpdatePermissionError,
  checkForUpdate,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
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
  silent?: boolean;
  token?: string;
};

/**
 * Update command handler
 */
export async function updateCommand(
  currentVersion: string,
  options: UpdateCommandOptions,
): Promise<void> {
  const { check = false, force = false, verbose = false, silent = false, token } = options;

  logger.configure({ verbose, silent });

  try {
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
    if (check) {
      // Check-only mode
      logger.info("Checking for updates...");
      const updateCheck = await checkForUpdate(currentVersion, token);

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
    const message = await performBinaryUpdate(currentVersion, { force, token });
    logger.success(message);
  } catch (error) {
    if (error instanceof GitHubClientError) {
      logger.error(`GitHub API Error: ${error.message}`);
      if (error.statusCode === 401 || error.statusCode === 403) {
        logger.info(
          "Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable for better rate limits.",
        );
      }
    } else if (error instanceof UpdatePermissionError) {
      logger.error(error.message);
      logger.info("Tip: Run with elevated privileges (e.g., sudo rulesync update)");
    } else {
      logger.error(formatError(error));
    }
    process.exit(1);
  }
}
