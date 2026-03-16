import { fetchFiles, formatFetchSummary } from "../../lib/fetch.js";
import { GitHubClientError } from "../../lib/github-client.js";
import type { FetchOptions } from "../../types/fetch.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { Logger } from "../../utils/logger.js";

export type FetchCommandOptions = FetchOptions & {
  source: string;
};

export async function fetchCommand(logger: Logger, options: FetchCommandOptions): Promise<void> {
  const { source, ...fetchOptions } = options;

  // Configure logger early for error messages
  logger.configure({
    verbose: fetchOptions.verbose ?? false,
    silent: fetchOptions.silent ?? false,
  });

  logger.debug(`Fetching files from ${source}...`);

  try {
    const summary = await fetchFiles({
      source,
      options: fetchOptions,
    });

    // Capture JSON data if in JSON mode
    if (logger.jsonMode) {
      const createdFiles = summary.files
        .filter((f) => f.status === "created")
        .map((f) => f.relativePath);
      const overwrittenFiles = summary.files
        .filter((f) => f.status === "overwritten")
        .map((f) => f.relativePath);
      const skippedFiles = summary.files
        .filter((f) => f.status === "skipped")
        .map((f) => f.relativePath);

      logger.captureData("source", source);
      logger.captureData("path", fetchOptions.path);
      logger.captureData("created", createdFiles);
      logger.captureData("overwritten", overwrittenFiles);
      logger.captureData("skipped", skippedFiles);
      logger.captureData("totalFetched", summary.created + summary.overwritten + summary.skipped);
    }

    const output = formatFetchSummary(summary);

    logger.success(output);

    // Exit with appropriate code
    if (summary.created + summary.overwritten === 0 && summary.skipped === 0) {
      logger.warn("No files were fetched.");
    }
  } catch (error) {
    if (error instanceof GitHubClientError) {
      // Include auth hints in error message for JSON mode
      const authHint =
        error.statusCode === 401 || error.statusCode === 403
          ? " Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable, or use `GITHUB_TOKEN=$(gh auth token) rulesync fetch ...`"
          : "";
      throw new CLIError(`GitHub API Error: ${error.message}.${authHint}`, ErrorCodes.FETCH_FAILED);
    }
    throw error;
  }
}
