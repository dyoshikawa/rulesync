import { GitHubClientError } from "../../lib/github-client.js";
import {
  UpdatePermissionError,
  checkForUpdate,
  detectExecutionEnvironment,
  getHomebrewUpgradeInstructions,
  getNpmUpgradeInstructions,
  performBinaryUpdate,
} from "../../lib/update.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { Logger } from "../../utils/logger.js";

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
  logger: Logger,
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

      // Capture JSON data if in JSON mode
      if (logger.jsonMode) {
        logger.captureData("currentVersion", updateCheck.currentVersion);
        logger.captureData("latestVersion", updateCheck.latestVersion);
        logger.captureData("updateAvailable", updateCheck.hasUpdate);
        logger.captureData(
          "message",
          updateCheck.hasUpdate
            ? `Update available: ${updateCheck.currentVersion} -> ${updateCheck.latestVersion}`
            : `Already at the latest version (${updateCheck.currentVersion})`,
        );
      }

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
      // Include auth hints in error message for JSON mode
      const authHint =
        error.statusCode === 401 || error.statusCode === 403
          ? " Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable, or use `GITHUB_TOKEN=$(gh auth token) rulesync update ...`"
          : "";
      throw new CLIError(
        `GitHub API Error: ${error.message}.${authHint}`,
        ErrorCodes.UPDATE_FAILED,
      );
    } else if (error instanceof UpdatePermissionError) {
      throw new CLIError(
        `${error.message} Tip: Run with elevated privileges (e.g., sudo rulesync update)`,
        ErrorCodes.UPDATE_FAILED,
      );
    }
    throw error;
  }
}
