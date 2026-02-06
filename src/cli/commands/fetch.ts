import type { FetchOptions } from "../../types/fetch.js";

import { fetchFiles, formatFetchSummary } from "../../lib/fetch.js";
import { GitHubClientError } from "../../lib/github-client.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";

export type FetchCommandOptions = FetchOptions & {
  source: string;
};

export async function fetchCommand(options: FetchCommandOptions): Promise<void> {
  const { source, ...fetchOptions } = options;

  // Configure logger early for error messages
  logger.configure({
    verbose: fetchOptions.verbose ?? false,
    silent: fetchOptions.silent ?? false,
  });

  logger.info(`Fetching files from ${source}...`);

  try {
    const summary = await fetchFiles({
      source,
      options: fetchOptions,
    });

    const output = formatFetchSummary(summary);

    logger.success(output);

    // Exit with appropriate code
    if (summary.created + summary.overwritten === 0 && summary.skipped === 0) {
      logger.warn("No files were fetched.");
    }
  } catch (error) {
    if (error instanceof GitHubClientError) {
      logger.error(`GitHub API Error: ${error.message}`);
      if (error.statusCode === 401 || error.statusCode === 403) {
        logger.info(
          "Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable for private repositories.",
        );
        logger.info(
          "Tip: If you use GitHub CLI, you can use `GITHUB_TOKEN=$(gh auth token) rulesync fetch ...`",
        );
      }
    } else {
      logger.error(formatError(error));
    }
    process.exit(1);
  }
}
